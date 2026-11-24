//! Дрібниці, що відтворюють поведінку JavaScript, від якої залежить злиття.

use std::cmp::Ordering;

/// Порівняння рядків за кодовими одиницями UTF-16, як `<` і `>` у JS (UTF-8 порядок інший для символів вище U+FFFF).
pub fn cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `JSON.stringify` значення, яке серіалізується в такий самий текст (компактно, без пробілів).
pub fn stringify<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("серіалізація в рядок")
}

/// FNV-1a за кодовими одиницями UTF-16 у base36 (`hashText`/`hash` з `variants.ts` і `workflow.ts`).
pub fn hash_text(t: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for u in t.encode_utf16() {
        h ^= u as u32;
        h = h.wrapping_mul(0x01000193);
    }
    base36(h as u64)
}

pub fn base36(mut n: u64) -> String {
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(std::char::from_digit((n % 36) as u32, 36).unwrap() as u8);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

/// `String.prototype.trim`: пробіли Unicode плюс U+FEFF (Rust `trim` його не знає).
pub fn trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Довжина в кодових одиницях UTF-16 (`String.length`).
pub fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}
