//! `preflight.ts`: що ще не готове, порахованого перед збіркою гри (чи запуском): один погляд на весь проєкт, щоб збірка
//! тихо не лишила рядків, які перекладач вважає готовими. Тут нічого не блокується (у збірки свої перемикачі); тут сказано, що збірка зустріне.

use crate::model::Status;
use crate::progress::{row_state, RowState};
use crate::project::{FileView, SavedProject};
use crate::qa::{active_issues, QaOptions, Severity, UnitLike};
use crate::qaadvice::has_advice;
use crate::workflow::source_changed;
use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Preflight {
    pub total: usize,
    pub untranslated: usize,
    pub drafts: usize,
    pub sent: usize,
    pub errors: usize,
    pub advice: usize,
    #[serde(rename = "sourceChanged")]
    pub source_changed: usize,
}

pub fn preflight(views: &[FileView], saved: &SavedProject, qa: &QaOptions) -> Preflight {
    let mut p = Preflight::default();
    for v in views {
        let ents = saved.files.get(&v.name);
        for u in &v.units {
            p.total += 1;
            let e = ents.and_then(|m| m.get(&u.key));
            let st = row_state(e);
            if st == RowState::Untranslated {
                p.untranslated += 1;
                continue;
            }
            if st == RowState::Draft {
                p.drafts += 1;
            }
            if st == RowState::Sent {
                p.sent += 1;
            }
            let like = UnitLike::from(u);
            if e.is_some_and(|e| e.status != Status::New && active_issues(&like, Some(e), qa).iter().any(|i| i.severity == Severity::Bad)) {
                p.errors += 1;
            }
            if has_advice(&like, e, qa) {
                p.advice += 1;
            }
            if source_changed(e, u) {
                p.source_changed += 1;
            }
        }
    }
    p
}

/// Рядки для показу: лише те, що не нуль, у порядку того, наскільки це важить для збірки.
/// `drafts_option`: у вікні є перемикач «Додати чернетки» (ПК); інакше текст каже, як потрапити чернетці до збірки.
pub fn preflight_lines(p: &Preflight, drafts_option: bool) -> Vec<String> {
    let mut out = Vec::new();
    if p.errors > 0 {
        out.push(format!("помилок QA: {} (такі рядки в збірку не беруться, якщо ввімкнено перемикач)", p.errors));
    }
    if p.source_changed > 0 {
        out.push(format!("оригінал змінився після перекладу: {}", p.source_changed));
    }
    if p.drafts > 0 {
        let how = if drafts_option { "не потраплять у збірку без «Додати чернетки»" } else { "до збірки беруться лише надіслані й вичитані: надішліть їх" };
        out.push(format!("чернеток: {} ({how})", p.drafts));
    }
    if p.untranslated > 0 {
        out.push(format!("без перекладу: {}", p.untranslated));
    }
    if p.advice > 0 {
        out.push(format!("порад: {}", p.advice));
    }
    out
}
