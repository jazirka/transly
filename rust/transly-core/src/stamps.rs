//! `stamps.ts`: позначки про те, що зроблено з проєктом поза застосунком: коли копія востаннє вийшла за межі сховища
//! (збережено файл проєкту, пройшла синхронізація) і коли востаннє збирали гру. Позначки — частина проєкту й зливаються за часом.
//! У Rust лежать у `extra["stamps"]` (невідоме поле верхнього рівня проходить без змін).

use crate::progress::{row_state, RowState};
use crate::project::SavedProject;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StampKind {
    Copy,
    Build,
}
impl StampKind {
    fn key(self) -> &'static str {
        match self {
            StampKind::Copy => "copy",
            StampKind::Build => "build",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Stamp {
    pub mt: f64,
    pub how: String,
    pub n: Option<f64>,
}

pub fn stamp(saved: &mut SavedProject, kind: StampKind, how: &str, now: i64, n: Option<i64>) {
    let entry = saved.extra.entry("stamps").or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    let mut s = Map::new();
    s.insert("mt".into(), json!(now));
    s.insert("how".into(), json!(how));
    if let Some(n) = n {
        s.insert("n".into(), json!(n));
    }
    entry.as_object_mut().unwrap().insert(kind.key().into(), Value::Object(s));
}

pub fn stamp_of(saved: &SavedProject, kind: StampKind) -> Option<Stamp> {
    let s = saved.extra.get("stamps")?.get(kind.key())?;
    let mt = s.get("mt")?.as_f64().filter(|m| m.is_finite())?;
    Some(Stamp { mt, how: s.get("how").and_then(Value::as_str).unwrap_or("").to_string(), n: s.get("n").and_then(Value::as_f64) })
}

/// «щойно», «5 хв тому», «3 год тому», «2 дн. тому».
pub fn ago(mt: f64, now: f64) -> String {
    let min = ((now - mt) / 60000.0).floor().max(0.0) as i64;
    if min < 1 {
        return "щойно".into();
    }
    if min < 60 {
        return format!("{min} хв тому");
    }
    let h = min / 60;
    if h < 48 {
        return format!("{h} год тому");
    }
    format!("{} дн. тому", h / 24)
}

/// Рядок про найновішу копію: наскільки стара й чи досить стара (або її нема), щоб нагадати.
pub fn copy_line(saved: &SavedProject, now: f64, translated: usize) -> (String, bool) {
    match stamp_of(saved, StampKind::Copy) {
        None => ("Копії поза браузером ще не було".into(), translated > 0),
        Some(c) => (format!("Копія: {}", ago(c.mt, now)), translated > 0 && now - c.mt > 24.0 * 3600.0 * 1000.0),
    }
}

/// Що змінилось від останньої збірки: рядки, що потрапили б у збірку (надіслані чи вичитані) і написані після неї.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct BuildDrift {
    pub n: usize,
    pub approved: usize,
    pub sent: usize,
    pub rows: Vec<DriftRow>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DriftRow {
    pub file: String,
    pub key: String,
}

pub fn built_drift(saved: &SavedProject, since: i64) -> BuildDrift {
    let mut d = BuildDrift::default();
    for (file, ents) in &saved.files {
        for (key, e) in ents {
            if e.mt <= since {
                continue;
            }
            let st = row_state(Some(e));
            if st != RowState::Sent && st != RowState::Approved {
                continue;
            }
            d.n += 1;
            if st == RowState::Approved {
                d.approved += 1;
            } else {
                d.sent += 1;
            }
            d.rows.push(DriftRow { file: file.clone(), key: key.clone() });
        }
    }
    d
}
