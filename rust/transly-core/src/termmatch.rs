//! `termmatch.ts`: де в тексті стоять терміни глосарія. Термін у знахідці — індекс у списку, який передали
//! (у TS це посилання на об'єкт).

use crate::glossary::*;
use serde::Serialize;

/// Термін, знайдений у тексті: де й який. `start`/`end` — перша частина; шаблон має діапазон для кожної частини в `parts`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermHit {
    pub start: usize,
    pub end: usize,
    pub term: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<(usize, usize)>>,
}

/// Найдовші першими на одному місці, жодних двох знахідок, що перекриваються (частини шаблону порівнюються окремо).
fn disjoint(mut hits: Vec<TermHit>) -> Vec<TermHit> {
    let parts_of = |h: &TermHit| h.parts.clone().unwrap_or_else(|| vec![(h.start, h.end)]);
    let size = |h: &TermHit| parts_of(h).iter().map(|(a, b)| b - a).sum::<usize>();
    hits.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| size(b).cmp(&size(a))));
    let mut out = Vec::new();
    let mut taken: Vec<(usize, usize)> = Vec::new();
    for h in hits {
        let ps = parts_of(&h);
        if ps.iter().any(|&(a, b)| taken.iter().any(|&(c, d)| a < d && b > c)) {
            continue;
        }
        taken.extend(ps);
        out.push(h);
    }
    out
}

fn hit_of(m: Vec<(usize, usize)>, term: usize) -> TermHit {
    if m.len() > 1 {
        TermHit { start: m[0].0, end: m[0].1, term, parts: Some(m) }
    } else {
        TermHit { start: m[0].0, end: m[0].1, term, parts: None }
    }
}

/// Де в оригіналі стоять англійські терміни глосарія (будь-яка форма множини, дієслова чи написання).
pub fn source_term_hits(source: &str, terms: &[Term]) -> Vec<TermHit> {
    let p = prepare_text(source);
    let mut hits = Vec::new();
    for ti in candidate_terms(&p, terms) {
        for m in term_matches_in(&p, &terms[ti].en) {
            hits.push(hit_of(m, ti));
        }
    }
    disjoint(hits)
}

/// Де в перекладі стоїть український відповідник терміна (або варіанта). Слова порівнюються за основами, тож підходить будь-який
/// відмінок чи число; фраза має стояти разом (слова розділені пробілами чи дефісами).
pub fn term_ranges_in_target(text: &str, uk: &str, alt: &[String]) -> Vec<(usize, usize)> {
    term_matches_of_phrases(text, uk, alt).into_iter().flatten().collect()
}

/// Те саме, по одному списку діапазонів на входження (шаблон має діапазон для кожної частини).
pub fn term_matches_of_phrases(text: &str, uk: &str, alt: &[String]) -> Vec<Vec<(usize, usize)>> {
    let toks = word_tokens(text);
    let mut out: Vec<Vec<(usize, usize)>> = Vec::new();
    for phrase in std::iter::once(uk).chain(alt.iter().map(|s| s.as_str())) {
        if has_gap(phrase) && pattern_parts(phrase).len() > 1 {
            out.extend(term_matches_in_target(text, phrase));
            continue;
        }
        let bare = pattern_parts(phrase).join(" ");
        let need: Vec<String> = word_tokens(&bare).into_iter().map(|t| t.keys[0].clone()).collect();
        if need.is_empty() {
            continue;
        }
        let forms = phrase_forms(&bare);
        let mut i = 0;
        while i + need.len() <= toks.len() {
            let ok = (0..need.len()).all(|j| word_agrees(&forms, j, &text[toks[i + j].bs..toks[i + j].be], &toks[i + j].keys[0], &need[j]) && (j == 0 || is_sep(&text[toks[i + j - 1].be..toks[i + j].bs])));
            if ok {
                out.push(vec![(toks[i].start, toks[i + need.len() - 1].end)]);
            }
            i += 1;
        }
    }
    out
}

/// Відповідники термінів, що є в оригіналі, так, як вони стоять у перекладі.
pub fn target_term_hits(target: &str, terms_in_source: &[Term]) -> Vec<TermHit> {
    let mut hits = Vec::new();
    for (ti, t) in terms_in_source.iter().enumerate() {
        for m in term_matches_of_phrases(target, &t.uk, t.alt.as_deref().unwrap_or(&[])) {
            hits.push(hit_of(m, ti));
        }
    }
    disjoint(hits)
}
