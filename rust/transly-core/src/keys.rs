//! `keys.ts`, `edges.ts`: безпечні ключі рядків і краї тексту.
//!
//! Ключі рядків беруться з файлів гри (стовпець таблиці, msgid, ім'я в JSON): ключ, що є назвою чогось, що має кожен об'єкт JS
//! (`__proto__`, `constructor`, `toString`), читався б як це «щось». Такий ключ дістає `~` попереду; та сама функція
//! використовується при записі перекладу назад. У Rust ця небезпека зникла б, але ключі лишаються однаковими з TS.

pub const RESERVED: [&str; 13] = ["__proto__", "constructor", "prototype", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "toLocaleString", "valueOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"];

pub fn safe_key(key: &str) -> String {
    if RESERVED.contains(&key) { format!("~{key}") } else { key.to_string() }
}

fn is_edge(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\u{a0}')
}

/// Краї тексту: пробіли, табуляції й переноси до і після нього. У повідомленні це справа перекладача, але в назві, терміні,
/// команді меню чи тексті плагіна гра склеює рядок з малюнком чи іншим текстом, і поля оригіналу («␣Continue») ставлять його на місце.
pub fn edges_of(text: &str) -> (String, String) {
    let lead: String = text.chars().take_while(|&c| is_edge(c)).collect();
    let mut tail: Vec<char> = text.chars().rev().take_while(|&c| is_edge(c)).collect();
    tail.reverse();
    (lead, tail.into_iter().collect())
}

/// Переклад із краями оригіналу. Переклад чи оригінал, що складаються лише з пробілів, лишаються як є.
pub fn with_edges(source: &str, target: &str) -> String {
    if crate::js::trim(target).is_empty() || crate::js::trim(source).is_empty() {
        return target.to_string();
    }
    let (s, t) = (edges_of(source), edges_of(target));
    if s.0 == t.0 && s.1 == t.1 {
        return target.to_string();
    }
    let chars: Vec<char> = target.chars().collect();
    let core: String = chars[t.0.chars().count()..chars.len() - t.1.chars().count()].iter().collect();
    format!("{}{core}{}", s.0, s.1)
}
