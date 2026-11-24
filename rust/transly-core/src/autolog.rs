//! `autolog.ts`: що застосунок заповнює сам, і запис в історії, який це лишає на рядку.

use crate::journal::{FileView, SavedFiles};
use crate::model::{Entry, Status};
use crate::workflow::note;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AutoKind {
    Words,
    Twin,
}
pub fn auto_note_text(k: AutoKind) -> &'static str {
    match k {
        AutoKind::Words => "автозаповнено за словами",
        AutoKind::Twin => "підставлено з однакового рядка",
    }
}
fn undone_text(k: AutoKind) -> &'static str {
    match k {
        AutoKind::Words => "автозаповнення скасовано",
        AutoKind::Twin => "підстановку скасовано",
    }
}
const GAP: i64 = 3 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AutoItem {
    pub file: String,
    pub key: String,
    pub source: String,
    pub target: String,
    pub at: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AutoBatch {
    pub kind: AutoKind,
    pub at: i64,
    pub items: Vec<AutoItem>,
}

fn kind_of(what: &str) -> Option<AutoKind> {
    if what == auto_note_text(AutoKind::Words) {
        Some(AutoKind::Words)
    } else if what == auto_note_text(AutoKind::Twin) {
        Some(AutoKind::Twin)
    } else {
        None
    }
}

pub fn is_auto_note(what: &str) -> bool {
    kind_of(what).is_some() || what == "автозаповнено з однакового рядка"
}

/// Чи рядок заповнено застосунком і ще не переглянуто перекладачем? Його найновіший запис в історії автоматичний (однаковий
/// оригінал, пам'ять, слова), і відтоді нічого не набирали. Такий рядок — чернетка з позначкою «авто».
pub fn is_auto_filled(e: Option<&Entry>) -> bool {
    let Some(e) = e else { return false };
    let Some(last) = e.history.as_ref().and_then(|h| h.last()) else { return false };
    e.status == Status::Draft && e.mt <= last.at && (is_auto_note(&last.what) || last.what.starts_with("підставлено з пам’яті"))
}

/// Рядки, які застосунок заповнив сам і які досі такі, якими їх лишив: найновіший запис історії — автоматичний (будь-яка пізніша
/// правка, надсилання чи повернення виводить рядок). Записи в межах трьох хвилин утворюють одну партію; найновіші першими.
pub fn auto_batches(views: &[FileView], saved: &SavedFiles, limit: usize) -> Vec<AutoBatch> {
    let mut found: Vec<(AutoKind, AutoItem)> = Vec::new();
    for v in views {
        let Some(ents) = saved.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            let Some(last) = e.history.as_ref().and_then(|h| h.last()) else { continue };
            let kind = if last.batch.as_deref().is_none_or(|b| b.is_empty()) { kind_of(&last.what) } else { None };
            if let Some(kind) = kind.filter(|_| e.mt <= last.at) {
                found.push((kind, AutoItem { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target: e.target.clone(), at: last.at }));
            }
        }
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.1.at));
    let mut out: Vec<AutoBatch> = Vec::new();
    for (kind, item) in found {
        if let Some(cur) = out.last_mut().filter(|c| c.kind == kind && c.items.last().is_some_and(|l| l.at - item.at <= GAP)) {
            cur.items.push(item);
        } else {
            if out.len() >= limit {
                break;
            }
            out.push(AutoBatch { kind, at: item.at, items: vec![item] });
        }
    }
    out
}

/// Скасувати автоматичне заповнення: рядок знову порожній. Повертає, скільки рядків змінено.
pub fn undo_auto(saved: &mut SavedFiles, batch: &AutoBatch, who: &str, now: i64) -> usize {
    let mut n = 0;
    for it in &batch.items {
        let Some(e) = saved.get(&it.file).and_then(|f| f.get(&it.key)) else { continue };
        let Some(last) = e.history.as_ref().and_then(|h| h.last()) else { continue };
        if last.at != it.at || kind_of(&last.what) != Some(batch.kind) || e.mt > last.at {
            continue;
        }
        let mut empty = Entry { target: String::new(), status: Status::New, mt: now, returned: Some(false), ..e.clone() };
        empty.orig = None;
        let next = note(&empty, undone_text(batch.kind), &it.target, who, now);
        saved.get_mut(&it.file).unwrap().insert(it.key.clone(), next);
        n += 1;
    }
    n
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AutoUndone {
    pub kind: AutoKind,
    pub at: i64,
    pub count: usize,
}

/// Автоматичні заповнення, що були скасовані (відомості для стрічки).
pub fn auto_undone(views: &[FileView], saved: &SavedFiles, limit: usize) -> Vec<AutoUndone> {
    let mut found: Vec<(AutoKind, i64)> = Vec::new();
    for v in views {
        let Some(ents) = saved.get(&v.name) else { continue };
        for u in &v.units {
            let Some(last) = ents.get(&u.key).and_then(|e| e.history.as_ref()).and_then(|h| h.last()) else { continue };
            if last.what == undone_text(AutoKind::Words) {
                found.push((AutoKind::Words, last.at));
            } else if last.what == undone_text(AutoKind::Twin) {
                found.push((AutoKind::Twin, last.at));
            }
        }
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.1));
    let mut out: Vec<AutoUndone> = Vec::new();
    for (kind, at) in found {
        if let Some(cur) = out.last_mut().filter(|c| c.kind == kind && c.at - at <= GAP) {
            cur.count += 1;
            continue;
        }
        if out.len() >= limit {
            break;
        }
        out.push(AutoUndone { kind, at, count: 1 });
    }
    out
}

/// Хвіст повідомлення про масове надсилання/вичитку: скільки рядків були чернетками, написаними програмою.
pub fn auto_note(n: usize) -> String {
    if n > 0 { format!(". Із них заповнених автоматично: {n}") } else { String::new() }
}
