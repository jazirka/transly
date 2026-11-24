//! `speakers.ts`: хто говорить. Назва мовця з початку повідомлення, відображення перекладача, обличчя, позначка розробника, подія.

use crate::collate::locale_compare;
use crate::project::FileView;
use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};
use std::sync::LazyLock;

/// Відображення мовців перекладача: ключі `hdr:`, `face:`, `note:`, `event:` → `{name, mt}`.
pub type SpeakerMap<'a> = Option<&'a Map<String, Value>>;

/// Деякі ігри друкують ім'я мовця першим рядком повідомлення, з першою літерою як іконка:
/// `\>\i[73]\}ANITOR\{\<` показує «JANITOR» (іконка 73 — це J). Іконки 64… — літери A… (без U).
/// Повертає повне ім'я або '', коли такого рядка нема чи іконка не з цього набору.
const ICON_LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTVWXYZ";
static HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:\\>)?\\i\[([0-9]+)\]\\\}([^\\\n]+?)\\\{\\<").unwrap());

pub fn header_name(source: Option<&str>) -> String {
    let Some(m) = source.and_then(|s| HEADER.captures(s)) else { return String::new() };
    let n: i64 = m[1].parse().unwrap_or(i64::MAX);
    let letter = n.checked_sub(64).filter(|&i| i >= 0).and_then(|i| ICON_LETTERS.chars().nth(i as usize));
    match letter {
        Some(l) => format!("{l}{}", crate::js::trim(&m[2])),
        None => String::new(),
    }
}

/// Дані рядка, потрібні, щоб визначити мовця.
#[derive(Clone, Debug, Default)]
pub struct SpeakerRow<'a> {
    pub speaker: &'a str,
    pub face: Option<&'a str>,
    pub event: Option<&'a str>,
    pub note: Option<&'a str>,
    pub source: Option<&'a str>,
}

fn mapped(map: &Map<String, Value>, key: &str) -> String {
    map.get(key).and_then(|v| v.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string()
}

/// Хто говорить: спершу власне ім'я з гри, потім відображення надрукованого імені, обличчя, позначки розробника й події;
/// саме надруковане ім'я — наостанок.
pub fn speaker_of(u: &SpeakerRow, map: SpeakerMap) -> String {
    if !u.speaker.is_empty() {
        return u.speaker.to_string();
    }
    let hdr = header_name(u.source);
    let mut found = String::new();
    if let Some(map) = map {
        let tries = [(!hdr.is_empty()).then(|| format!("hdr:{hdr}")), u.face.filter(|f| !f.is_empty()).map(|f| format!("face:{f}")), u.note.filter(|f| !f.is_empty()).map(|f| format!("note:{f}")), u.event.filter(|f| !f.is_empty()).map(|f| format!("event:{f}"))];
        for k in tries.into_iter().flatten() {
            let n = mapped(map, &k);
            if !n.is_empty() {
                found = n;
                break;
            }
        }
    }
    if found.is_empty() { hdr } else { found }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CandKind {
    Hdr,
    Face,
    Note,
    Event,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SpeakerCandidate {
    /// Ключ у відображенні мовців.
    pub key: String,
    pub kind: CandKind,
    pub label: String,
    pub count: usize,
    pub sample: String,
}

/// Те, що зазвичай ідентифікує мовця, найкорисніше першим: імена, надруковані в тексті, обличчя (одне обличчя — один персонаж),
/// власні позначки розробника в коментарях (`MARCOH`) і події з багатьма повідомленнями. Рядки, що вже мають мовця з гри, пропускаються.
pub fn speaker_candidates(views: &[FileView], min_event_messages: usize) -> Vec<SpeakerCandidate> {
    type M = IndexMap<String, SpeakerCandidate>;
    let (mut headers, mut faces, mut notes, mut events) = (M::new(), M::new(), M::new(), M::new());
    fn bump(m: &mut M, key: String, kind: CandKind, label: &str, source: &str) {
        if let Some(c) = m.get_mut(&key) {
            c.count += 1;
        } else {
            let flat = collapse_spaces(source);
            let units: Vec<u16> = flat.encode_utf16().take(90).collect();
            m.insert(key.clone(), SpeakerCandidate { key, kind, label: label.to_string(), count: 1, sample: String::from_utf16_lossy(&units) });
        }
    }
    for v in views {
        for u in &v.units {
            if u.kind != crate::model::UnitKind::Dialogue || !u.speaker.is_empty() {
                continue;
            }
            let hdr = header_name(Some(&u.source));
            // надруковане ім'я точне: вгадувати за обличчям, позначкою чи подією не треба
            if !hdr.is_empty() {
                bump(&mut headers, format!("hdr:{hdr}"), CandKind::Hdr, &hdr, &u.source);
                continue;
            }
            if let Some(f) = u.face.as_deref().filter(|s| !s.is_empty()) {
                bump(&mut faces, format!("face:{f}"), CandKind::Face, f, &u.source);
            }
            if let Some(f) = u.note.as_deref().filter(|s| !s.is_empty()) {
                bump(&mut notes, format!("note:{f}"), CandKind::Note, f, &u.source);
            }
            if let Some(f) = u.event.as_deref().filter(|s| !s.is_empty()) {
                bump(&mut events, format!("event:{f}"), CandKind::Event, f, &u.source);
            }
        }
    }
    let by_count = |a: &SpeakerCandidate, b: &SpeakerCandidate| b.count.cmp(&a.count).then_with(|| locale_compare(&a.label, &b.label));
    let sorted = |m: M, min: usize| -> Vec<SpeakerCandidate> {
        let mut v: Vec<SpeakerCandidate> = m.into_values().filter(|c| c.count >= min).collect();
        v.sort_by(by_count);
        v
    };
    let mut out = sorted(headers, 0);
    out.extend(sorted(faces, 0));
    out.extend(sorted(notes, min_event_messages));
    out.extend(sorted(events, min_event_messages));
    out
}

/// `text.replace(/\s+/g, ' ')`.
fn collapse_spaces(text: &str) -> String {
    let mut out = String::new();
    let mut in_space = false;
    for c in text.chars() {
        if crate::js::is_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}
