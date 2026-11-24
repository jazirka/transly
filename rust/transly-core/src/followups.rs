//! `followups.ts`: що застосунок може запропонувати після того, як щось сталося, виведене з даних і ніколи не збережене.
//! Кожна функція відповідає на одне питання, яке перекладачеві довелося б ставити вручну.

use crate::glossary::{has_term_in, prepare_text, target_has_term};
use crate::js;
use crate::project::{FileView, SavedProject};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RowKey {
    pub file: String,
    pub key: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct TermRows {
    /// В оригіналі є термін, у рядка є переклад, а переклад термін не вживає.
    pub lacking: Vec<RowKey>,
    /// В оригіналі є термін, а перекладу ще нема.
    pub waiting: Vec<RowKey>,
}

/// Після додавання терміна (чи зміни його оригінального слова): рядки, що мають його в оригіналі. Перший список — робота, на яку
/// варто глянути (перекладено без терміна), другий — робота, що зустріне термін, коли до неї дійде.
pub fn rows_with_term(views: &[FileView], saved: &SavedProject, en: &str, uk: &str, alt: &[String]) -> TermRows {
    let mut out = TermRows::default();
    let en = js::trim(en);
    if en.is_empty() || js::trim(uk).is_empty() {
        return out;
    }
    for v in views {
        let ents = saved.files.get(&v.name);
        for u in &v.units {
            if !has_term_in(&prepare_text(&u.source), en) {
                continue;
            }
            let row = || RowKey { file: v.name.clone(), key: u.key.clone() };
            match ents.and_then(|m| m.get(&u.key)) {
                Some(e) if !js::trim(&e.target).is_empty() => {
                    if !target_has_term(&e.target, uk, alt) {
                        out.lacking.push(row());
                    }
                }
                _ => out.waiting.push(row()),
            }
        }
    }
    out
}

/// Речення про ці рядки, або порожньо, коли терміна нема в жодному.
pub fn term_rows_note(en: &str, r: &TermRows) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !r.lacking.is_empty() {
        parts.push(format!("перекладено без нього: {}", r.lacking.len()));
    }
    if !r.waiting.is_empty() {
        parts.push(format!("чекають перекладу: {}", r.waiting.len()));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("У рядках із «{en}» {}", parts.join(", "))
    }
}
