//! `hints.ts`: для чого примітка, у порядку, потрібному перекладачеві: помилка, що ламає текст, термін, що розходиться з глосарієм,
//! факт про ситуацію рядка, рекомендація й довідка. Кожен вид має свій значок і назву, а не лише колір.

use crate::qa::IssueCat;

pub const HINT_ORDER: [IssueCat; 5] = [IssueCat::Error, IssueCat::Term, IssueCat::Context, IssueCat::Style, IssueCat::Info];

/// Назва однієї примітки цього виду.
pub fn hint_label(c: IssueCat) -> &'static str {
    match c {
        IssueCat::Error => "Помилка",
        IssueCat::Term => "Термін",
        IssueCat::Context => "Контекст",
        IssueCat::Style => "Порада",
        IssueCat::Info => "Довідка",
    }
}

/// Назва групи таких приміток.
pub fn hint_group(c: IssueCat) -> &'static str {
    match c {
        IssueCat::Error => "Помилки",
        IssueCat::Term => "Терміни",
        IssueCat::Context => "Контекст",
        IssueCat::Style => "Поради",
        IssueCat::Info => "Довідка",
    }
}

/// Своя форма для кожного виду.
pub fn hint_glyph(c: IssueCat) -> &'static str {
    match c {
        IssueCat::Error => "✖",
        IssueCat::Term => "◆",
        IssueCat::Context => "●",
        IssueCat::Style => "▲",
        IssueCat::Info => "↗",
    }
}

fn rank(c: IssueCat) -> usize {
    HINT_ORDER.iter().position(|x| *x == c).unwrap_or(usize::MAX)
}

/// Примітки в порядку їх видів (порядок усередині виду зберігається).
pub fn by_hint_order<T: Clone>(items: &[T], cat: impl Fn(&T) -> IssueCat) -> Vec<T> {
    let mut v: Vec<(usize, &T)> = items.iter().enumerate().collect();
    v.sort_by_key(|(i, x)| (rank(cat(x)), *i));
    v.into_iter().map(|(_, x)| x.clone()).collect()
}

/// Примітки за видами, по порядку; види без приміток пропущено.
pub fn group_hints<T: Clone>(items: &[T], cat: impl Fn(&T) -> IssueCat) -> Vec<(IssueCat, Vec<T>)> {
    HINT_ORDER.iter().map(|c| (*c, items.iter().filter(|x| cat(x) == *c).cloned().collect::<Vec<_>>())).filter(|(_, v)| !v.is_empty()).collect()
}
