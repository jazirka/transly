//! `controlCodes.ts`: керівні коди RPG Maker (`\C[2]`, `\V[1]`, `\N[3]`, `\{`, `\\`…), довжина тексту, яку бачить гравець,
//! і повернення пропущених кодів у переклад. Позиції в `with_codes` — у кодових одиницях UTF-16, як у JS.

use crate::js;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

/// Джерело шаблону одного коду (для побудови інших шаблонів).
pub const CODE_SOURCE: &str = r"\\[A-Za-z]+\[[0-9]+\]|\\[{}.|!><^$]|\\\\";
static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(CODE_SOURCE).unwrap());
static WIDTH_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"{CODE_SOURCE}|\\G")).unwrap());

pub fn codes_of(text: &str) -> Vec<String> {
    CODE.find_iter(text).map(|m| m.as_str().to_string()).collect()
}

/// Що код займає на екрані: екранований зворотний слеш — один символ, назва валюти `\G` — десь три, решта нічого.
fn code_width(code: &str) -> &'static str {
    match code {
        "\\\\" => "\\",
        "\\G" => "000",
        _ => "",
    }
}

/// Текст так, як він займає місце на екрані: коди зникли (`\G` — кілька символів), переноси зникли. Міряти це, а не сирий текст.
pub fn visible_text(text: &str) -> String {
    WIDTH_CODE.replace_all(text, |c: &regex::Captures| code_width(&c[0])).replace('\n', "")
}

pub fn display_length(text: &str) -> usize {
    visible_text(text).chars().count()
}

/// Коди з `source`, яких немає в `target` (різниця мультимножин).
pub fn missing_codes(source: &str, target: &str) -> Vec<String> {
    let mut left: HashMap<String, usize> = HashMap::new();
    for c in codes_of(target) {
        *left.entry(c).or_default() += 1;
    }
    let mut out = Vec::new();
    for c in codes_of(source) {
        match left.get_mut(&c) {
            Some(n) if *n > 0 => *n -= 1,
            _ => out.push(c),
        }
    }
    out
}

fn u16s(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn from16(v: &[u16]) -> String {
    String::from_utf16_lossy(v)
}
fn plain(t: &[u16]) -> usize {
    CODE.replace_all(&from16(t), "").chars().count()
}
fn index_of(hay: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    hay.windows(needle.len()).position(|w| w == needle)
}
fn space_at(t: &[u16], i: usize) -> bool {
    t.get(i).is_some_and(|&u| char::from_u32(u as u32).is_some_and(js::is_space))
}

/// Переклад із пропущеними кодами, повернутими туди, де вони в оригіналі: код на початку оригіналу — на початок, у кінці — у кінець,
/// посередині — на ту саму частку тексту (біля найближчого пробілу).
pub fn with_codes(source: &str, target: &str, miss: &[String]) -> String {
    let (src, tgt) = (u16s(source), u16s(target));
    struct Place {
        text: Vec<u16>,
        idx: usize,
        pos: usize,
    }
    let mut places: Vec<Place> = miss
        .iter()
        .enumerate()
        .map(|(idx, code)| {
            let c16 = u16s(code);
            let Some(at) = index_of(&src, &c16) else { return Place { text: c16, idx, pos: tgt.len() } };
            let (before, after) = (&src[..at], &src[at + c16.len()..]);
            // проміжок, який оригінал має навколо коду, зберігається: «\N[1] хвилювалися» лишається окремо, «\C[2]слово» — разом
            let space_after = space_at(after, 0);
            let space_before = !before.is_empty() && space_at(before, before.len() - 1);
            let blank = |t: &[u16]| js::trim(&from16(t)).is_empty();
            let pos = if blank(before) || plain(before) == 0 {
                0
            } else if blank(after) || plain(after) == 0 {
                tgt.len()
            } else {
                let (pb, pa) = (plain(before) as f64, plain(after) as f64);
                let mut p = (tgt.len() as f64 * (pb / (pb + pa))).round() as usize;
                // найближчий пробіл, щоб не розрізати слово; код стоїть перед словом, якому належить: після пробілу
                let (mut l, mut r) = (p, p);
                while l > 0 && tgt[l - 1] != 0x20 {
                    l -= 1;
                }
                while r < tgt.len() && tgt[r] != 0x20 {
                    r += 1;
                }
                p = if p - l <= r - p { l } else { r };
                if tgt.get(p) == Some(&0x20) {
                    p += 1;
                }
                p
            };
            let mut text = c16.clone();
            if pos < tgt.len() && space_after && tgt[pos] != 0x20 {
                text.push(0x20);
            } else if pos >= tgt.len() && space_before && !tgt.is_empty() && !space_at(&tgt, tgt.len() - 1) {
                text.insert(0, 0x20);
            }
            Place { text, idx, pos }
        })
        .collect();
    // з кінця, а коди одного місця — від останнього до першого: виходять у порядку списку
    places.sort_by(|a, b| b.pos.cmp(&a.pos).then(b.idx.cmp(&a.idx)));
    let mut out = tgt;
    for p in places {
        out.splice(p.pos..p.pos, p.text);
    }
    from16(&out)
}
