//! `progress.ts`: як просунулася робота; одні визначення для кожного місця, що її показує. Рядок — рівно в одному з чотирьох станів:
//! неперекладений (тексту нема; лише пробіли — теж нема), чернетка (є текст, не надіслано), надісланий (чекає вичитки), вичитаний.

use crate::model::{Entry, Status, Translations, Unit};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RowState {
    Untranslated,
    Draft,
    Sent,
    Approved,
}

pub fn row_state(e: Option<&Entry>) -> RowState {
    match e {
        None => RowState::Untranslated,
        Some(e) if e.target.is_empty() || crate::js::trim(&e.target).is_empty() => RowState::Untranslated,
        Some(e) => match e.status {
            Status::Appr => RowState::Approved,
            Status::Done => RowState::Sent,
            _ => RowState::Draft,
        },
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub total: usize,
    pub untranslated: usize,
    pub draft: usize,
    pub sent: usize,
    pub approved: usize,
    /// Усе з текстом: draft + sent + approved.
    pub translated: usize,
}

/// Враховує один рядок у `p`.
pub fn count_row(p: &mut Progress, e: Option<&Entry>) {
    p.total += 1;
    match row_state(e) {
        RowState::Untranslated => p.untranslated += 1,
        RowState::Draft => p.draft += 1,
        RowState::Sent => p.sent += 1,
        RowState::Approved => p.approved += 1,
    }
    if row_state(e) != RowState::Untranslated {
        p.translated += 1;
    }
}

/// Прогрес заданих рядків, переклади шукаються за ключем.
pub fn progress_of(units: &[Unit], entries: &Translations) -> Progress {
    let mut p = Progress::default();
    for u in units {
        count_row(&mut p, entries.get(&u.key));
    }
    p
}

/// Сума кількох прогресів (весь проєкт з його файлів).
pub fn sum_progress(list: &[Progress]) -> Progress {
    let mut p = Progress::default();
    for q in list {
        p.total += q.total;
        p.untranslated += q.untranslated;
        p.draft += q.draft;
        p.sent += q.sent;
        p.approved += q.approved;
        p.translated += q.translated;
    }
    p
}

/// Відсоток для екрана. Округляється вниз, але стан, що не завершений, ніколи не показує 100 (995 з 1000 — 99), а розпочатий — 0 (1 з 1000 — 1).
pub fn pct(n: usize, total: usize) -> u32 {
    if total == 0 || n == 0 {
        0
    } else if n >= total {
        100
    } else {
        (100 * n / total).clamp(1, 99) as u32
    }
}
