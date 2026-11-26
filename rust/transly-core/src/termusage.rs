//! `termusage.ts`: де в усій грі вживається термін чи шаблон і як його перекладено (числа за карткою нитки й список
//! рядків, що пішли іншим шляхом). Рахується з рядків, ніколи не зберігається.
//!
//! Відмінність від TS: `WordIndex::build` (шматками з паузами для екрана) тут не потрібна — індексація в Rust іде
//! у фоновому потоці інтерфейсу; лишено `of` (усе одразу).

use crate::glossary::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermUse {
    pub file: String,
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermUsage {
    /// Кожен рядок, оригінал якого має термін, у порядку гри.
    pub rows: Vec<TermUse>,
    /// Переклад вживає власний відповідник терміна.
    pub main: usize,
    /// Вживає один із варіантів.
    pub alt: usize,
    /// Перекладено, але без терміна й варіантів.
    pub other: usize,
    /// Ще не перекладено.
    pub none: usize,
    /// Рядки з `other`, щоб на них подивитися.
    #[serde(rename = "otherRows")]
    pub other_rows: Vec<TermUse>,
}

pub struct IndexRow {
    pub file: String,
    pub key: String,
    pub source: String,
}

/// Слова кожного оригіналу один раз: ключ слова → рядки, що його мають, тож термін пробується лише на рядках, які можуть його містити.
#[derive(Default)]
pub struct WordIndex {
    pub rows: Vec<IndexRow>,
    by_key: HashMap<String, Vec<usize>>,
}

impl WordIndex {
    fn add(&mut self, file: &str, key: &str, source: &str) {
        let at = self.rows.len();
        self.rows.push(IndexRow { file: file.into(), key: key.into(), source: source.into() });
        let mut seen: HashSet<&str> = HashSet::new();
        for t in &prepare_text(source).tokens {
            for k in &t.keys {
                if seen.insert(k.as_str()) {
                    self.by_key.entry(k.clone()).or_default().push(at);
                }
            }
        }
    }

    /// Усе одразу: (файл, ключ, оригінал) у порядку гри.
    pub fn of<'a>(rows: impl IntoIterator<Item = (&'a str, &'a str, &'a str)>) -> WordIndex {
        let mut ix = WordIndex::default();
        for (file, key, source) in rows {
            ix.add(file, key, source);
        }
        ix
    }

    /// Індекси (в `rows`) рядків, що мають слово з таким ключем.
    pub fn with_key(&self, key: &str) -> &[usize] {
        self.by_key.get(key).map_or(&[], |v| v.as_slice())
    }
}

/// Те саме, що `term_usage` без пропуску рядка, але переклад беруть за номером рядка в `index.rows`: на великих проєктах це швидше, ніж шукати за файлом і ключем.
pub fn term_usage_at<'a>(index: &WordIndex, target_at: impl Fn(usize) -> Option<&'a str>, term: &Term) -> TermUsage {
    let mut out = TermUsage { rows: Vec::new(), main: 0, alt: 0, other: 0, none: 0, other_rows: Vec::new() };
    let en = crate::js::trim(&term.en);
    let first = term_first_key(en);
    let Some(first) = first.filter(|_| !en.is_empty()) else { return out };
    let alt = term.alt.as_deref().unwrap_or(&[]);
    for &at in index.with_key(&first) {
        let r = &index.rows[at];
        if term_matches_in(&prepare_text(&r.source), en).is_empty() {
            continue;
        }
        let row = TermUse { file: r.file.clone(), key: r.key.clone() };
        out.rows.push(row.clone());
        match target_at(at).filter(|t| !crate::js::trim(t).is_empty()) {
            None => out.none += 1,
            Some(tr) if target_has_term(tr, &term.uk, &[]) => out.main += 1,
            Some(tr) if !alt.is_empty() && target_has_term(tr, &alt[0], &alt[1..]) => out.alt += 1,
            Some(_) => {
                out.other += 1;
                out.other_rows.push(row);
            }
        }
    }
    out
}

/// Як термін вживається в грі. `skip` пропускає один рядок (відкритий). `target_of(file, key)` — переклад рядка, якщо він є.
pub fn term_usage<'a>(index: &WordIndex, target_of: impl Fn(&str, &str) -> Option<&'a str>, term: &Term, skip: Option<&TermUse>) -> TermUsage {
    let mut out = TermUsage { rows: Vec::new(), main: 0, alt: 0, other: 0, none: 0, other_rows: Vec::new() };
    let en = crate::js::trim(&term.en);
    let first = term_first_key(en);
    let Some(first) = first.filter(|_| !en.is_empty()) else { return out };
    let alt = term.alt.as_deref().unwrap_or(&[]);
    for &at in index.with_key(&first) {
        let r = &index.rows[at];
        if skip.is_some_and(|s| r.file == s.file && r.key == s.key) {
            continue;
        }
        if term_matches_in(&prepare_text(&r.source), en).is_empty() {
            continue;
        }
        let row = TermUse { file: r.file.clone(), key: r.key.clone() };
        out.rows.push(row.clone());
        match target_of(&r.file, &r.key).filter(|t| !crate::js::trim(t).is_empty()) {
            None => out.none += 1,
            Some(tr) if target_has_term(tr, &term.uk, &[]) => out.main += 1,
            Some(tr) if !alt.is_empty() && target_has_term(tr, &alt[0], &alt[1..]) => out.alt += 1,
            Some(_) => {
                out.other += 1;
                out.other_rows.push(row);
            }
        }
    }
    out
}
