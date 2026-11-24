//! `queue.ts`: рядки, що чекають перекладача, у порядку проєкту (файл за файлом, рядок за рядком): що дивитися далі не лише
//! у відкритому файлі, а й у всій грі. Одне визначення кожного виду для меню, клавіш, лічильників.

use crate::model::{Entry, Status, Unit};
use crate::progress::{row_state, RowState};
use crate::project::{FileView, SavedProject};
use crate::qa::{active_issues, QaOptions, Severity, UnitLike};
use crate::qaadvice::has_advice;
use crate::workflow::source_changed;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueueKind {
    /// Ще немає тексту.
    Untranslated,
    /// Має помилку QA (блокуючу).
    Error,
    /// Має пораду QA.
    Advice,
    /// Надіслано, чекає вичитки.
    Unreviewed,
    /// Оригінал змінився після того, як переклад написано.
    SourceChanged,
}

impl QueueKind {
    pub const ALL: [QueueKind; 5] = [QueueKind::Untranslated, QueueKind::Error, QueueKind::Advice, QueueKind::Unreviewed, QueueKind::SourceChanged];

    pub fn as_str(self) -> &'static str {
        match self {
            QueueKind::Untranslated => "untranslated",
            QueueKind::Error => "error",
            QueueKind::Advice => "advice",
            QueueKind::Unreviewed => "unreviewed",
            QueueKind::SourceChanged => "sourceChanged",
        }
    }

    /// Слова для повідомлень і меню: (коли порожньо, назва).
    pub fn label(self) -> (&'static str, &'static str) {
        match self {
            QueueKind::Untranslated => ("Рядків без перекладу немає", "Без перекладу"),
            QueueKind::Error => ("Помилок QA немає", "Помилка QA"),
            QueueKind::Advice => ("Порад немає", "Порада"),
            QueueKind::Unreviewed => ("Рядків, що чекають вичитки, немає", "На вичитку"),
            QueueKind::SourceChanged => ("Рядків зі зміненим оригіналом немає", "Оригінал змінився"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct QueueRow {
    pub file: String,
    pub key: String,
    /// Місце рядка в усьому проєкті (з 0).
    pub at: usize,
}

fn is_in(kind: QueueKind, u: &Unit, e: Option<&Entry>, qa: &QaOptions) -> bool {
    match kind {
        QueueKind::Untranslated => row_state(e) == RowState::Untranslated,
        QueueKind::Unreviewed => row_state(e) == RowState::Sent,
        QueueKind::SourceChanged => source_changed(e, u),
        QueueKind::Error => e.is_some_and(|e| !e.target.is_empty() && e.status != Status::New && active_issues(&UnitLike::from(u), Some(e), qa).iter().any(|i| i.severity == Severity::Bad)),
        QueueKind::Advice => has_advice(&UnitLike::from(u), e, qa),
    }
}

/// Усі рядки цього виду в проєкті за порядком.
pub fn queue_rows(views: &[FileView], saved: &SavedProject, kind: QueueKind, qa: &QaOptions) -> Vec<QueueRow> {
    let mut out = Vec::new();
    let mut at = 0;
    for v in views {
        let ents = saved.files.get(&v.name);
        for u in &v.units {
            if is_in(kind, u, ents.and_then(|m| m.get(&u.key)), qa) {
                out.push(QueueRow { file: v.name.clone(), key: u.key.clone(), at });
            }
            at += 1;
        }
    }
    out
}

/// Де рядок стоїть у всьому проєкті; None, коли такого рядка нема.
pub fn position_of(views: &[FileView], from: Option<(&str, &str)>) -> Option<usize> {
    let (file, key) = from?;
    let mut at = 0;
    for v in views {
        if v.name != file {
            at += v.units.len();
            continue;
        }
        return v.units.iter().position(|u| u.key == key).map(|i| at + i);
    }
    None
}

/// Наступний (`forward`) чи попередній рядок черги після місця `at` (None = перед початком), по колу.
/// Сам рядок на `at` не пропонується, хіба що він єдиний. Повертає рядок і його місце в черзі (з 1).
pub fn next_in(rows: &[QueueRow], at: Option<usize>, forward: bool) -> Option<(&QueueRow, usize)> {
    if rows.is_empty() {
        return None;
    }
    let i = if forward {
        rows.iter().position(|r| at.is_none_or(|a| r.at > a)).unwrap_or(0)
    } else {
        match at {
            None => rows.len() - 1,
            Some(a) => rows.iter().rposition(|r| r.at < a).unwrap_or(rows.len() - 1),
        }
    };
    Some((&rows[i], i + 1))
}
