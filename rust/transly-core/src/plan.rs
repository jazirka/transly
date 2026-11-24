//! `plan.ts`: план змін — що інструмент збирається зробити з рядками, пораховане й показане ДО того, як щось записано.
//! Кожен інструмент, що міняє багато рядків, робить план, показує, що в ньому, і застосовує як одну дію журналу
//! (її можна скасувати). Тут же живе правило: вичитаний рядок масовий інструмент не чіпає, доки перекладач не попросить.

use crate::journal::{batch_info, FileView, RowChange, SavedFiles};
use crate::model::{Entry, Status};
use crate::plural::rows;
use crate::workflow::source_changed;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protect {
    Skip,
    Include,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SkippedRow {
    pub file: String,
    pub key: String,
    pub reason: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Demotes {
    pub appr: usize,
    pub done: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ChangePlan {
    pub kind: String,
    /// Рядки, які буде записано.
    pub changes: Vec<RowChange>,
    /// Рядки, які інструмент хотів змінити, але лишив.
    pub skipped: Vec<SkippedRow>,
    /// Рядки плану, що падають до чернетки: вичитані (лише коли перекладач їх включив) і надіслані.
    pub demotes: Demotes,
    pub protect: Protect,
}

/// Вичитаний рядок захищений від зміни тексту чи нижчого статусу. Затвердження (той самий текст, досі `appr`) — не зміна.
pub fn is_protected(prev: Option<&Entry>, next: &Entry) -> bool {
    prev.is_some_and(|p| p.status == Status::Appr && (next.target != p.target || next.status != Status::Appr))
}

/// План із змін, які порахував інструмент. З `Skip` (типово) вичитані рядки пропускаються й рахуються в `skipped`;
/// з `Include` вони записуються й рахуються в `demotes`.
pub fn plan_of(files: &SavedFiles, changes: &[RowChange], kind: &str, protect: Protect) -> ChangePlan {
    let (mut keep, mut skipped, mut demotes) = (Vec::new(), Vec::new(), Demotes { appr: 0, done: 0 });
    for c in changes {
        let prev = files.get(&c.file).and_then(|e| e.get(&c.key));
        if is_protected(prev, &c.next) {
            if protect == Protect::Skip {
                skipped.push(SkippedRow { file: c.file.clone(), key: c.key.clone(), reason: "proofread" });
                continue;
            }
            demotes.appr += 1;
        } else if prev.is_some_and(|p| p.status == Status::Done) && c.next.status.rank() < Status::Done.rank() {
            demotes.done += 1;
        }
        keep.push(c.clone());
    }
    ChangePlan { kind: kind.into(), changes: keep, skipped, demotes, protect }
}

/// Записати план однією дією журналу; повертає її id або None, коли план не міняє жодного рядка.
pub fn apply_plan(commit: impl FnOnce(&[RowChange], &str, Option<&str>) -> String, plan: &ChangePlan, what: Option<&str>) -> Option<String> {
    if plan.changes.is_empty() { None } else { Some(commit(&plan.changes, &plan.kind, what)) }
}

/// Що план пропускає чи знижує, реченням для перегляду чи повідомлення ('' коли нічого казати).
pub fn plan_note(plan: &ChangePlan) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !plan.skipped.is_empty() {
        parts.push(format!("Вичитаних пропущено: {}", plan.skipped.len()));
    }
    if plan.demotes.appr > 0 {
        parts.push(format!("Вичитаних стане чернетками: {}", plan.demotes.appr));
    }
    if plan.demotes.done > 0 {
        parts.push(format!("Надісланих стане чернетками: {}", plan.demotes.done));
    }
    parts.join(". ")
}

/// Повідомлення після застосування плану: що зроблено з якою кількістю рядків і що лишено чи знижено.
pub fn plan_message(plan: &ChangePlan, applied: i64) -> String {
    let n = rows(applied);
    let head = batch_info(&plan.kind).map_or_else(String::new, |(_, t)| format!("{t}: {n}"));
    let note = plan_note(plan);
    if note.is_empty() { head } else { format!("{head}. {note}") }
}

/// Після повторного читання файлів гри: перекладені рядки зі зміненим оригіналом. `changed` рахує всі (рядок також
/// показує примітку); `changes` — надіслані чи вичитані, що падають у чернетки, щоб не потрапити непомітно в збірку.
/// Тут нічого не записується: виклик застосовує `changes` однією дією журналу («reconcile»).
pub fn reconcile_changes(views: &[FileView], files: &SavedFiles, now: i64) -> (Vec<RowChange>, usize) {
    let (mut changes, mut changed) = (Vec::new(), 0);
    for v in views {
        let Some(ents) = files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            if !source_changed(Some(e), u) {
                continue;
            }
            changed += 1;
            if matches!(e.status, Status::Done | Status::Appr) {
                changes.push(RowChange { file: v.name.clone(), key: u.key.clone(), next: Entry { status: Status::Draft, mt: now, ..e.clone() }, text: e.target.clone(), what: None });
            }
        }
    }
    (changes, changed)
}
