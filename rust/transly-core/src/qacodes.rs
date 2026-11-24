//! `qacodes.ts`: спільне для правил QA. Керівний код гри (`\C[2]`, `\N[1]`, `\{`) містить латинські літери й цифри, тож правило,
//! що дивиться на літери, мусить спершу замінити коди заглушками; заміна зберігає всі позиції.
//!
//! Позиції тут — індекси символів (`char`), не UTF-16 (у TS — одиниці UTF-16). Усередині правил це послідовно, а
//! результат (виправлений текст) однаковий.

use regex::Regex;
use std::sync::LazyLock;

/// Заглушка на місці керівного коду (U+E000, символ приватного використання).
pub const BLANK: char = '\u{E000}';

static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+(?:\[[^\]\n]*\])?|\\[{}.|!><^$\\]").unwrap());

/// Текст, де кожен керівний код замінено заглушками тієї ж довжини.
pub fn mask_codes(text: &str) -> String {
    CODE.replace_all(text, |m: &regex::Captures| BLANK.to_string().repeat(m[0].chars().count())).into_owned()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Script {
    Cyr,
    Lat,
    Mixed,
    Other,
    None,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScriptWord {
    pub text: String,
    pub start: usize,
    pub end: usize,
    pub script: Script,
    pub cyr: usize,
    pub lat: usize,
}

/// Літери, позначки й цифри, з'єднані апострофом, — слово; дефіс, крапка чи скісна риска його закінчують (HP-бар — два слова).
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{M}\p{Nd}]+(?:['’ʼ`´‘][\p{L}\p{M}\p{Nd}]+)*").unwrap());
static CYR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{Script=Cyrillic}$").unwrap());
static LAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{Script=Latin}$").unwrap());
static LETTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{L}$").unwrap());

pub fn is_cyrillic_letter(c: char) -> bool {
    CYR.is_match(c.encode_utf8(&mut [0; 4]))
}
pub fn is_latin_letter(c: char) -> bool {
    LAT.is_match(c.encode_utf8(&mut [0; 4]))
}

/// Таблиця «байтовий зсув → індекс символа».
pub fn byte_to_char(s: &str) -> Vec<usize> {
    let mut t = vec![0usize; s.len() + 1];
    let mut n = 0;
    for (b, c) in s.char_indices() {
        for k in 0..c.len_utf8() {
            t[b + k] = n;
        }
        n += 1;
    }
    t[s.len()] = n;
    t
}

/// Слова (замаскованого) тексту зі скриптом їхніх літер; цифри й позначки скриптом не рахуються.
pub fn script_words(masked: &str) -> Vec<ScriptWord> {
    let tab = byte_to_char(masked);
    WORD.find_iter(masked)
        .map(|m| {
            let (mut cyr, mut lat, mut other) = (0, 0, 0);
            for c in m.as_str().chars() {
                let s = c.encode_utf8(&mut [0; 4]).to_string();
                if !LETTER.is_match(&s) {
                    continue;
                }
                if CYR.is_match(&s) {
                    cyr += 1;
                } else if LAT.is_match(&s) {
                    lat += 1;
                } else {
                    other += 1;
                }
            }
            let script = if other > 0 {
                Script::Other
            } else if cyr > 0 && lat > 0 {
                Script::Mixed
            } else if cyr > 0 {
                Script::Cyr
            } else if lat > 0 {
                Script::Lat
            } else {
                Script::None
            };
            ScriptWord { text: m.as_str().to_string(), start: tab[m.start()], end: tab[m.end()], script, cyr, lat }
        })
        .collect()
}

#[derive(Clone, Debug)]
pub struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// Текст із заміненими місцями; правки не мають перекриватися.
pub fn apply_edits(text: &str, edits: &[Edit]) -> String {
    let mut out: Vec<char> = text.chars().collect();
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by_key(|e| std::cmp::Reverse(e.start));
    for e in sorted {
        let (s, t) = (e.start.min(out.len()), e.end.min(out.len()).max(e.start.min(out.len())));
        out.splice(s..t, e.text.chars());
    }
    out.into_iter().collect()
}
