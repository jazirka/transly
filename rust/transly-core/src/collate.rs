//! Порівняння рядків як `String.prototype.localeCompare` (ICU): для сортування назв за алфавітом.
//! Колатор не потокобезпечний, тож на кожен потік свій.

use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed, CollatorPreferences};
use icu_locale::locale;
use std::cmp::Ordering;

thread_local! {
    static UK: CollatorBorrowed<'static> = Collator::try_new(CollatorPreferences::from(locale!("uk")), CollatorOptions::default()).expect("колатор uk");
    static ROOT: CollatorBorrowed<'static> = Collator::try_new(CollatorPreferences::default(), CollatorOptions::default()).expect("колатор root");
}

/// `a.localeCompare(b, 'uk')`.
pub fn locale_compare_uk(a: &str, b: &str) -> Ordering {
    UK.with(|c| c.compare(a, b))
}

/// `a.localeCompare(b)` без мови (кореневе впорядкування).
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    ROOT.with(|c| c.compare(a, b))
}
