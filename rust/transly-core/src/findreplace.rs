//! Пошук і заміна в перекладах (`core/findreplace.ts`).

use crate::project::{FileView, SavedProject};
use fancy_regex::Regex;
use serde::Serialize;

#[derive(Clone, Debug)]
pub struct FindOptions {
    pub find: String,
    pub replace: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FindMatch {
    pub file: String,
    pub key: String,
    pub source: String,
    pub before: String,
    pub after: String,
    pub count: usize,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        if ".*+?^${}()|[]\\".contains(c) {
            o.push('\\');
        }
        o.push(c);
    }
    o
}

/// Візерунок для звичайного тексту (ніколи не регулярний вираз, набраний людиною): апостроф пишеться по-різному
/// (' ’ ʼ `), і будь-який знайде всі; ціле слово закінчується на пропуску чи знаку, а не на апострофі чи дефісі між літерами.
pub fn literal_pattern(find: &str, whole_word: bool, case_sensitive: bool) -> Regex {
    let mut body = String::new();
    for c in esc(find).chars() {
        if "'’ʼ`".contains(c) {
            body.push_str("['’ʼ`]");
        } else {
            body.push(c);
        }
    }
    let core = if whole_word {
        format!(r"(?<![\p{{L}}\p{{N}}])(?<![\p{{L}}\p{{N}}]['’ʼ`]){body}(?![\p{{L}}\p{{N}}])(?!['’ʼ`][\p{{L}}\p{{N}}])")
    } else {
        body
    };
    Regex::new(&format!("{}{core}", if case_sensitive { "" } else { "(?i)" })).expect("візерунок із літерального тексту")
}

/// Кожен переклад із цим текстом і те, чим він стане. Тут нічого не змінюється.
pub fn find_replace(views: &[FileView], saved: &SavedProject, o: &FindOptions, limit: usize) -> Vec<FindMatch> {
    let mut out = Vec::new();
    if o.find.is_empty() {
        return out;
    }
    let re = literal_pattern(&o.find, o.whole_word, o.case_sensitive);
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            let t = &e.target;
            if t.is_empty() {
                continue;
            }
            let mut count = 0;
            let mut after = String::new();
            let mut last = 0;
            for m in re.find_iter(t).flatten() {
                count += 1;
                after.push_str(&t[last..m.start()]);
                after.push_str(&o.replace);
                last = m.end();
            }
            after.push_str(&t[last..]);
            if count > 0 {
                out.push(FindMatch { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), before: t.clone(), after, count });
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }
    out
}
