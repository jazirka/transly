//! `ext/commands.ts`: команди плагінів, що замінюють текст у перекладах. Частина `pluginCommands` (меню з реєстру плагінів)
//! буде разом з `registry`.

use crate::findreplace::{literal_pattern, FindMatch};
use crate::project::{FileView, SavedProject};

/// Крок команди: кожен переклад із `find` отримує `replace` на його місце.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplaceStep {
    pub find: String,
    pub replace: String,
    pub whole_word: bool,
    pub case_sensitive: bool,
}

/// Один текст після всіх кроків команди по черзі.
pub fn run_steps(text: &str, steps: &[ReplaceStep]) -> (String, usize) {
    let mut after = text.to_string();
    let mut count = 0;
    for st in steps {
        if st.find.is_empty() {
            continue;
        }
        let re = literal_pattern(&st.find, st.whole_word, st.case_sensitive);
        let mut out = String::new();
        let mut last = 0;
        for m in re.find_iter(&after).flatten() {
            count += 1;
            out.push_str(&after[last..m.start()]);
            out.push_str(&st.replace);
            last = m.end();
        }
        out.push_str(&after[last..]);
        after = out;
    }
    (after, count)
}

/// Переклади, які змінила б команда, і чим кожен став би. Тут нічого не змінюється.
pub fn plan_steps(views: &[FileView], saved: &SavedProject, steps: &[ReplaceStep], limit: usize) -> Vec<FindMatch> {
    let mut out = Vec::new();
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            if e.target.is_empty() {
                continue;
            }
            let (after, count) = run_steps(&e.target, steps);
            if count > 0 && after != e.target {
                out.push(FindMatch { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), before: e.target.clone(), after, count });
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }
    out
}
