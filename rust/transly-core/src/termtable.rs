//! `termtable.ts`: глосарій із таблиці (HTML-сторінка, CSV/TSV): клітинки → терміни.
//!
//! Відмінність від TS: сутність `&constructor;` у HTML лишається як є (у TS вона дає текст функції через прототип об'єкта).

use crate::glossary::GlossaryTerm;
use crate::js;
use indexmap::IndexMap;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

static ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&(#x[0-9a-f]+|#\d+|[a-z]+);").unwrap());
static TABLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<table[\s\S]*?</table>").unwrap());
static TR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<tr[^>]*>([\s\S]*?)</tr>").unwrap());
static CELL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<t[dh][^>]*>([\s\S]*?)</t[dh]>").unwrap());
static BR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>").unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static BLANKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]+").unwrap());

fn decode(s: &str) -> String {
    ENTITY
        .replace_all(s, |c: &regex::Captures| {
            let whole = c[0].to_string();
            let e = &c[1];
            if let Some(rest) = e.strip_prefix('#') {
                let (digits, radix) = match rest.strip_prefix(['x', 'X']) {
                    Some(h) => (h, 16),
                    None => (rest, 10),
                };
                let code = digits.chars().try_fold(0f64, |a, d| d.to_digit(radix).map(|d| a * radix as f64 + d as f64));
                return match code {
                    Some(n) if n > 0.0 && n < 1_114_112.0 => char::from_u32(n as u32).map_or(whole, |c| c.to_string()),
                    _ => whole,
                };
            }
            match e.to_lowercase().as_str() {
                "amp" => "&".into(),
                "lt" => "<".into(),
                "gt" => ">".into(),
                "quot" => "\"".into(),
                "apos" => "'".into(),
                "nbsp" => " ".into(),
                _ => whole,
            }
        })
        .into_owned()
}

/// Клітинки кожного рядка першої таблиці HTML-сторінки (підходить експорт Google Sheets «Веб-сторінка»).
pub fn parse_html_table(html: &str) -> Vec<Vec<String>> {
    let table = TABLE.find(html).map_or(html, |m| m.as_str());
    let mut rows = Vec::new();
    for tr in TR.captures_iter(table) {
        let cells = CELL
            .captures_iter(&tr[1])
            .map(|c| {
                let text = BR.replace_all(&c[1], "\n");
                let text = TAG.replace_all(&text, "");
                js::trim(&BLANKS.replace_all(&decode(&text), " ")).to_string()
            })
            .collect();
        rows.push(cells);
    }
    rows
}

/// CSV / TSV з лапками. Роздільник визначається за першим рядком (табуляція, крапка з комою чи кома).
pub fn parse_delimited(text: &str) -> Vec<Vec<String>> {
    let first = text.split('\n').next().unwrap_or("");
    let first = first.strip_suffix('\r').unwrap_or(first);
    let delim = if first.contains('\t') {
        '\t'
    } else if first.split(';').count() > first.split(',').count() {
        ';'
    } else {
        ','
    };
    let chars: Vec<char> = text.chars().collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let (mut row, mut cell, mut q) = (Vec::<String>::new(), String::new(), false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if q {
            if c == '"' {
                if chars.get(i + 1) == Some(&'"') {
                    cell.push('"');
                    i += 1;
                } else {
                    q = false;
                }
            } else {
                cell.push(c);
            }
        } else if c == '"' && cell.is_empty() {
            q = true;
        } else if c == delim {
            row.push(std::mem::take(&mut cell));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.get(i + 1) == Some(&'\n') {
                i += 1;
            }
            row.push(std::mem::take(&mut cell));
            if row.iter().any(|x| !js::trim(x).is_empty()) {
                rows.push(std::mem::take(&mut row));
            }
            row = Vec::new();
        } else {
            cell.push(c);
        }
        i += 1;
    }
    row.push(cell);
    if row.iter().any(|x| !js::trim(x).is_empty()) {
        rows.push(row);
    }
    rows.into_iter().map(|r| r.into_iter().map(|x| js::trim(&x).to_string()).collect()).collect()
}

pub struct TermTable {
    pub terms: Vec<GlossaryTerm>,
    pub skipped: usize,
}

/// `s.toLowerCase().replace(/\s+/g, ' ').trim()`.
fn norm(s: &str) -> String {
    let mut out = String::new();
    let mut in_space = false;
    for c in s.to_lowercase().chars() {
        if js::is_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    js::trim(&out).to_string()
}

static HEAD_EN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(оригінал|original|english|source|en)$").unwrap());
static COL_EN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(оригінал|original|english|source|en)$").unwrap());
static COL_TR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(переклад|translation|ukrainian|uk|переклад \d+|translation \d+)$").unwrap());
static COL_NOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(опис|description|коментар|comment|note)").unwrap());
static COL_KIND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(розділ|тип|category|type|section)").unwrap());
static ABBREV: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{1,2}$").unwrap());

/// Рядки таблиці → терміни глосарія. Рядок заголовка знаходиться за коміркою «Оригінал»/«Original»; стовпці:
/// `Переклад 1…n` / `Translation` → uk (перший) і запасні, `Опис`/`Коментар`/`Description` → примітка,
/// `Розділ…`/`Тип`/`Category` → вид. Без заголовка стовпець 1 — оригінал, 2 — переклад.
/// Рядки з однаковим оригіналом зливаються: пізніші значення стають запасними.
pub fn terms_from_table(rows: &[Vec<String>], now: i64, qa: bool) -> TermTable {
    let mut head: Option<usize> = None;
    for (i, r) in rows.iter().take(12).enumerate() {
        if r.iter().any(|c| HEAD_EN.is_match(js::trim(c))) {
            head = Some(i);
            break;
        }
    }
    let (mut en, mut tr, mut note, mut kind): (Option<usize>, Vec<usize>, Option<usize>, Option<usize>) = (Some(0), vec![1], None, None);
    if let Some(h) = head {
        let hd: Vec<String> = rows[h].iter().map(|c| norm(c)).collect();
        en = hd.iter().position(|c| COL_EN.is_match(c));
        tr = hd.iter().enumerate().filter(|(_, c)| COL_TR.is_match(c)).map(|(i, _)| i).collect();
        note = hd.iter().position(|c| COL_NOTE.is_match(c));
        kind = hd.iter().position(|c| COL_KIND.is_match(c));
        if tr.is_empty() {
            return TermTable { terms: vec![], skipped: rows.len() - h - 1 };
        }
    }
    let cell = |r: &Vec<String>, i: Option<usize>| -> String { i.and_then(|i| r.get(i)).map_or(String::new(), |c| js::trim(c).to_string()) };
    let mut out: IndexMap<String, GlossaryTerm> = IndexMap::new();
    let mut skipped = 0;
    let start = head.map_or(0, |h| h + 1);
    for r in &rows[start.min(rows.len())..] {
        let e = cell(r, en);
        let variants: Vec<String> = tr.iter().map(|i| cell(r, Some(*i))).filter(|v| !v.is_empty()).collect();
        if e.is_empty() || variants.is_empty() || ABBREV.is_match(&e) {
            if !e.is_empty() || !variants.is_empty() {
                skipped += 1;
            }
            continue;
        }
        let key = e.to_lowercase();
        if let Some(prev) = out.get_mut(&key) {
            let mut have: HashSet<String> = HashSet::new();
            have.insert(norm(&prev.uk));
            for a in prev.alt.iter().flatten() {
                have.insert(norm(a));
            }
            let more: Vec<String> = variants.iter().filter(|v| !have.contains(&norm(v))).cloned().collect();
            if !more.is_empty() {
                prev.alt.get_or_insert_with(Vec::new).extend(more);
            }
            continue;
        }
        let mut t = GlossaryTerm { en: e, uk: variants[0].clone(), alt: None, qa: None, mt: now, note: None, gender: None, kind: None };
        if variants.len() > 1 {
            let first = norm(&variants[0]);
            let mut seen: HashSet<&str> = HashSet::new();
            let alts: Vec<String> = variants[1..].iter().filter(|v| norm(v) != first && seen.insert(v.as_str())).cloned().collect();
            if !alts.is_empty() {
                t.alt = Some(alts);
            }
        }
        let n = cell(r, note);
        let k = cell(r, kind);
        if !n.is_empty() {
            t.note = Some(js::slice16(&n, 400));
        }
        if !k.is_empty() {
            t.kind = Some(k);
        }
        if !qa {
            t.qa = Some(false);
        }
        out.insert(key, t);
    }
    TermTable { terms: out.into_values().collect(), skipped }
}
