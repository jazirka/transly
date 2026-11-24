//! `dictlinks.ts`: посилання на онлайн-словники для слів рядка. Сторінки відкриваються в браузері; нічого не завантажується.

use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `Тлумачення` — значення, `Синоніми` — синоніми: обидві — сторінки goroh.pp.ua.
pub fn goroh_url(word: &str, kind: &str) -> String {
    format!("https://goroh.pp.ua/{}/{}", encode_uri_component(kind), encode_uri_component(&word.to_lowercase()))
}

/// Multitran: англійська (1) → українська (33).
pub fn multitran_url(word: &str) -> String {
    format!("https://www.multitran.com/m.exe?l1=1&l2=33&s={}", encode_uri_component(word))
}

static CODES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+(\[[^\]]*\])?|\\[.|!<>^{}$]").unwrap());
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}[\p{L}'’-]*").unwrap());

/// Різні слова рядка (керівні коди гри відкинуто) за порядком появи.
pub fn words_of(text: &str, limit: usize) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    let cleaned = CODES.replace_all(text, " ");
    for m in WORD.find_iter(&cleaned) {
        let w = m.as_str().trim_end_matches(['-', '\'', '’']);
        let k = w.to_lowercase();
        if w.chars().count() < 2 || seen.contains(&k) {
            continue;
        }
        seen.insert(k);
        out.push(w.to_string());
        if out.len() >= limit {
            break;
        }
    }
    out
}
