//! `plural.ts`: число з українською формою множини. Підключення до i18n (`countWord`, мова інтерфейсу) прийде з модулем `ext/i18n`;
//! тут — обраний за правилом варіант і групування тисяч у `uk-UA` (нерозривний пробіл).

/// Форма слова для числа: однина (1, 21…), мала множина (2–4, 22–24…), велика (решта, 11–14 теж).
pub fn plural_form(n: i64, forms: [&str; 3]) -> &str {
    let (m10, m100) = (n % 10, n % 100);
    if m10 == 1 && m100 != 11 {
        forms[0]
    } else if (2..=4).contains(&m10) && !(12..=14).contains(&m100) {
        forms[1]
    } else {
        forms[2]
    }
}

/// `n.toLocaleString('uk-UA')` для цілих: групи по три цифри, розділювач — U+00A0, мінус — `-`.
pub fn group_uk(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('\u{a0}');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// «1 рядок», «3 рядки», «5 рядків».
pub fn plural(n: i64, forms: [&str; 3]) -> String {
    format!("{} {}", group_uk(n), plural_form(n, forms))
}

/// Рядки: слово, яке найчастіше рахують у повідомленнях.
pub fn rows(n: i64) -> String {
    plural(n, ["рядок", "рядки", "рядків"])
}
