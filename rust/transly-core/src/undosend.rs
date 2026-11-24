//! `undosend.ts`: пачки надсилань і вичитувань, які ще можна скасувати. Рядок рахується, поки його найновіший запис історії —
//! саме надсилання, а статус такий, який дало надсилання (редагування чи повернення після цього означає, що скасувати вже не можна).
//! Записи в межах трьох хвилин — одна пачка. Найновіші першими.

use crate::autolog::is_auto_note;
use crate::model::{Entry, Status};
use crate::project::{FileView, SavedProject};
use crate::workflow::note;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SendKind {
    Send,
    Approve,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SentItem {
    pub file: String,
    pub key: String,
    pub source: String,
    pub target: String,
    pub at: i64,
    /// Запису про надсилання немає: знайдено лише за часом зміни рядка.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub guessed: bool,
}

/// Рядки, надіслані (чи вичитані) разом; їх можна повернути, поки в них нічого не змінили.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SendBatch {
    pub kind: SendKind,
    pub at: i64,
    pub items: Vec<SentItem>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub guessed: bool,
}

fn kind_of(what: &str) -> Option<SendKind> {
    if what.starts_with("надіслано") {
        Some(SendKind::Send)
    } else if what.starts_with("вичитано") {
        Some(SendKind::Approve)
    } else {
        None
    }
}
const GAP: i64 = 3 * 60 * 1000;

struct Found {
    kind: SendKind,
    item: SentItem,
}

pub fn send_batches(views: &[FileView], saved: &SavedProject, limit: usize) -> Vec<SendBatch> {
    let (mut found, mut loose): (Vec<Found>, Vec<Found>) = (vec![], vec![]);
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let e = ents.get(&u.key);
            let last = e.and_then(|e| e.history.as_ref()).and_then(|h| h.last());
            if last.is_some_and(|l| l.batch.is_some()) {
                continue; // масові дії журналу перелічено (і скасовано) там
            }
            let kind = last.and_then(|l| kind_of(&l.what));
            let item = |e: &Entry, at: i64, guessed: bool| SentItem { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target: e.target.clone(), at, guessed };
            if let Some(e) = e {
                if e.status == Status::Done && !(last.is_some() && kind == Some(SendKind::Send)) && !last.is_some_and(|l| is_auto_note(&l.what)) {
                    loose.push(Found { kind: SendKind::Send, item: item(e, e.mt, true) });
                    continue;
                }
            }
            let (Some(e), Some(last), Some(kind)) = (e, last, kind) else { continue };
            if (kind == SendKind::Send && e.status != Status::Done) || (kind == SendKind::Approve && e.status != Status::Appr) {
                continue;
            }
            if e.mt > last.at {
                continue; // змінено після надсилання: не скасовується
            }
            found.push(Found { kind, item: item(e, last.at, false) });
        }
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.item.at));
    let mut out: Vec<SendBatch> = Vec::new();
    for f in found {
        let it = SentItem { guessed: false, ..f.item };
        match out.last_mut() {
            Some(cur) if cur.kind == f.kind && cur.items.last().unwrap().at - it.at <= GAP => cur.items.push(it),
            _ => {
                if out.len() >= limit {
                    break;
                }
                out.push(SendBatch { kind: f.kind, at: it.at, items: vec![it], guessed: false });
            }
        }
    }
    // Рядки, що чекають вичитки без запису про надсилання (надіслані старою версією чи історію втрачено): за часом зміни.
    loose.sort_by_key(|f| std::cmp::Reverse(f.item.at));
    let mut guessed: Vec<SendBatch> = Vec::new();
    for f in loose {
        let it = SentItem { guessed: true, ..f.item };
        match guessed.last_mut() {
            Some(cur) if cur.items.last().unwrap().at - it.at <= GAP => cur.items.push(it),
            _ => guessed.push(SendBatch { kind: SendKind::Send, at: it.at, items: vec![it], guessed: true }),
        }
    }
    let mut all: Vec<SendBatch> = out.into_iter().chain(guessed).collect();
    all.sort_by_key(|b| std::cmp::Reverse(b.at));
    all.truncate(limit);
    all
}

/// Повертає пачку: надіслані рядки стають чернетками, вичитані — «чекають вичитки». Повертає, скільки змінилось.
pub fn undo_batch(saved: &mut SavedProject, batch: &SendBatch, who: &str, now: i64) -> usize {
    let mut n = 0;
    for it in &batch.items {
        let Some(e) = saved.files.get(&it.file).and_then(|m| m.get(&it.key)).cloned() else { continue };
        let last = e.history.as_ref().and_then(|h| h.last());
        if it.guessed {
            if e.status != Status::Done || e.mt != it.at {
                continue;
            }
        } else if !last.is_some_and(|l| l.at == it.at && kind_of(&l.what) == Some(batch.kind) && e.mt <= l.at) {
            continue;
        }
        let back = Entry { status: if batch.kind == SendKind::Send { Status::Draft } else { Status::Done }, mt: now, ..e.clone() };
        let what = if batch.kind == SendKind::Send { "надсилання скасовано" } else { "вичитування скасовано" };
        let noted = note(&back, what, &e.target, who, now);
        saved.files.get_mut(&it.file).unwrap().insert(it.key.clone(), noted);
        n += 1;
    }
    n
}

/// Надсилання, які було скасовано, найновіші першими, для стрічки подій (лише відомості).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UndoneBatch {
    pub kind: SendKind,
    pub at: i64,
    pub count: usize,
}

pub fn undone_batches(views: &[FileView], saved: &SavedProject, limit: usize) -> Vec<UndoneBatch> {
    let mut found: Vec<(SendKind, i64)> = Vec::new();
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(last) = ents.get(&u.key).and_then(|e| e.history.as_ref()).and_then(|h| h.last()) else { continue };
            if last.what == "надсилання скасовано" {
                found.push((SendKind::Send, last.at));
            } else if last.what == "вичитування скасовано" {
                found.push((SendKind::Approve, last.at));
            }
        }
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.1));
    let mut out: Vec<UndoneBatch> = Vec::new();
    for (kind, at) in found {
        match out.last_mut() {
            Some(cur) if cur.kind == kind && cur.at - at <= GAP => cur.count += 1,
            _ => {
                if out.len() >= limit {
                    break;
                }
                out.push(UndoneBatch { kind, at, count: 1 });
            }
        }
    }
    out
}
