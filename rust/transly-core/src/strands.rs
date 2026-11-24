//! `strands.ts`: нитки рядка (для інтерфейсу): кожен запис глосарія, що є в оригіналі, з місцем в оригіналі й місцем,
//! де його передає переклад. Рахується з текстів, ніколи не зберігається.

use crate::glossary::*;
use crate::termmatch::*;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StrandKind {
    Word,
    Phrase,
    Construction,
}
/// ok — власний відповідник запису; alt — прийнятний варіант; missing — немає ні того, ні того; pending — ще не перекладено.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StrandState {
    Ok,
    Alt,
    Missing,
    Pending,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Strand {
    /// Індекс запису в списку `terms`, який передали.
    pub term: usize,
    pub kind: StrandKind,
    /// Частини в оригіналі (одна для слова, більше для конструкції).
    pub src: Vec<(usize, usize)>,
    /// Частини, де переклад це передає; порожньо, коли ні.
    pub dst: Vec<(usize, usize)>,
    pub state: StrandState,
    /// Яким із кольорів рядка вона позначена (0…COLORS-1 у порядку входження в оригінал).
    pub ci: usize,
}

/// Скільки кольорів у ниток; рядок із більшою кількістю записів іде по колу.
pub const COLORS: usize = 6;

pub fn strand_kind(en: &str) -> StrandKind {
    if has_gap(en) && pattern_parts(en).len() > 1 {
        StrandKind::Construction
    } else if word_tokens(en).len() > 1 {
        StrandKind::Phrase
    } else {
        StrandKind::Word
    }
}

fn flat(h: Option<&TermHit>) -> Vec<(usize, usize)> {
    match h {
        Some(h) => h.parts.clone().unwrap_or_else(|| vec![(h.start, h.end)]),
        None => Vec::new(),
    }
}

/// Нитки рядка в порядку, в якому стоїть їхня перша частина в оригіналі. По одній на запис (перше місце, де він трапляється).
pub fn strands_of(source: &str, target: &str, terms: &[Term]) -> Vec<Strand> {
    let in_src = terms_in(source, terms);
    let subset: Vec<Term> = in_src.iter().map(|&i| terms[i].clone()).collect();
    let mut out: Vec<Strand> = Vec::new();
    let mut seen: Vec<usize> = Vec::new();
    let has_target = !crate::js::trim(target).is_empty();
    for h in source_term_hits(source, &subset) {
        if seen.contains(&h.term) {
            continue;
        }
        seen.push(h.term);
        let t = &subset[h.term];
        let dst = if has_target { flat(target_term_hits(target, std::slice::from_ref(t)).first()) } else { Vec::new() };
        let alt = t.alt.as_deref().unwrap_or(&[]);
        let state = if !has_target {
            StrandState::Pending
        } else if target_has_term(target, &t.uk, &[]) {
            StrandState::Ok
        } else if !alt.is_empty() && target_has_term(target, &alt[0], &alt[1..]) {
            StrandState::Alt
        } else {
            StrandState::Missing
        };
        let ci = out.len() % COLORS;
        out.push(Strand { term: in_src[h.term], kind: strand_kind(&t.en), src: flat(Some(&h)), dst, state, ci });
    }
    out
}
