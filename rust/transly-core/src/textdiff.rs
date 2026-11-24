//! `textdiff.ts`: різниця двох версій тексту по словах: що лишилось, що додано, що прибрано. Для порівняння версій в історії рядка.
//! Пропуски й розділові знаки — теж слова, тож відрізки разом дають кожен із текстів точно.

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffKind {
    Same,
    Add,
    Del,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DiffSeg {
    pub t: DiffKind,
    pub text: String,
}

// `\s` як у JS (без U+0085, з U+FEFF)
const WS: &str = r"\t-\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}";
static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"[{WS}]+|[\p{{L}}\p{{N}}]+(?:['’ʼ-][\p{{L}}\p{{N}}]+)*|[^{WS}\p{{L}}\p{{N}}]")).unwrap());
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]+").unwrap());

fn tokens(s: &str) -> Vec<&str> {
    TOKEN.find_iter(s).map(|m| m.as_str()).collect()
}

/// Вище цього числа клітинок таблиця найдовшої спільної частини не будується: середина показується як заміна.
const MAX_CELLS: usize = 2_000_000;

fn push(out: &mut Vec<DiffSeg>, t: DiffKind, text: &str) {
    if text.is_empty() {
        return;
    }
    match out.last_mut() {
        Some(last) if last.t == t => last.text.push_str(text),
        _ => out.push(DiffSeg { t, text: text.to_string() }),
    }
}

pub fn diff_words(before: &str, after: &str) -> Vec<DiffSeg> {
    if before == after {
        return if before.is_empty() { vec![] } else { vec![DiffSeg { t: DiffKind::Same, text: before.to_string() }] };
    }
    let (a, b) = (tokens(before), tokens(after));
    let mut lo = 0;
    while lo < a.len() && lo < b.len() && a[lo] == b[lo] {
        lo += 1;
    }
    let (mut ea, mut eb) = (a.len(), b.len());
    while ea > lo && eb > lo && a[ea - 1] == b[eb - 1] {
        ea -= 1;
        eb -= 1;
    }
    let mut out = Vec::new();
    push(&mut out, DiffKind::Same, &a[..lo].concat());
    let (x, y) = (&a[lo..ea], &b[lo..eb]);
    if x.is_empty() || y.is_empty() || (x.len() + 1) * (y.len() + 1) > MAX_CELLS {
        push(&mut out, DiffKind::Del, &x.concat());
        push(&mut out, DiffKind::Add, &y.concat());
    } else {
        // найдовша спільна послідовність середин, з кінця, щоб обхід нижче йшов уперед
        let w = y.len() + 1;
        let mut lcs = vec![0u16; (x.len() + 1) * w];
        for i in (0..x.len()).rev() {
            for j in (0..y.len()).rev() {
                lcs[i * w + j] = if x[i] == y[j] { lcs[(i + 1) * w + j + 1] + 1 } else { lcs[(i + 1) * w + j].max(lcs[i * w + j + 1]) };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < x.len() && j < y.len() {
            if x[i] == y[j] {
                push(&mut out, DiffKind::Same, x[i]);
                i += 1;
                j += 1;
            } else if lcs[(i + 1) * w + j] >= lcs[i * w + j + 1] {
                push(&mut out, DiffKind::Del, x[i]);
                i += 1;
            } else {
                push(&mut out, DiffKind::Add, y[j]);
                j += 1;
            }
        }
        while i < x.len() {
            push(&mut out, DiffKind::Del, x[i]);
            i += 1;
        }
        while j < y.len() {
            push(&mut out, DiffKind::Add, y[j]);
            j += 1;
        }
    }
    push(&mut out, DiffKind::Same, &a[ea..].concat());
    out
}

/// Текст одного боку різниці: до («before») без доданого, після («after») без прибраного.
pub fn side_of(segs: &[DiffSeg], after: bool) -> String {
    let keep = if after { DiffKind::Add } else { DiffKind::Del };
    segs.iter().filter(|s| s.t == DiffKind::Same || s.t == keep).map(|s| s.text.as_str()).collect()
}

/// Скільки слів додано й прибрано (замінене слово рахується раз в обох).
pub fn diff_counts(segs: &[DiffSeg]) -> (usize, usize) {
    let (mut added, mut removed) = (0, 0);
    for s in segs {
        let n = WORD.find_iter(&s.text).count();
        match s.t {
            DiffKind::Add => added += n,
            DiffKind::Del => removed += n,
            DiffKind::Same => {}
        }
    }
    (added, removed)
}
