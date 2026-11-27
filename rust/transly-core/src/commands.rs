//! `ext/commands.ts`: команди плагінів, що замінюють текст у перекладах, і меню команд працюючих плагінів.

use crate::findreplace::{literal_pattern, FindMatch};
use crate::i18n::{I18n, CORE};
use crate::project::{FileView, SavedProject};
use crate::registry::{qualified, PluginRegistry, PluginState};
use serde_json::Value;

/// Крок команди: кожен переклад із `find` отримує `replace` на його місце.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplaceStep {
    pub find: String,
    pub replace: String,
    pub whole_word: bool,
    pub case_sensitive: bool,
}

/// Кроки, готові до застосування: візерунок кожного кроку збирається один раз (збирання регулярного виразу з прохідною «ціле слово» коштує мілісекунди, а рядків бувають сотні тисяч).
pub struct CompiledSteps<'a>(Vec<(fancy_regex::Regex, &'a str)>);

/// Збирає візерунки кроків (кроки з порожнім `find` пропускаються, як і в `run_steps`).
pub fn compile_steps(steps: &[ReplaceStep]) -> CompiledSteps<'_> {
    CompiledSteps(steps.iter().filter(|st| !st.find.is_empty()).map(|st| (literal_pattern(&st.find, st.whole_word, st.case_sensitive), st.replace.as_str())).collect())
}

/// Один текст після всіх кроків по черзі, з уже зібраними візерунками.
pub fn run_compiled(text: &str, steps: &CompiledSteps<'_>) -> (String, usize) {
    let mut after = text.to_string();
    let mut count = 0;
    for (re, replace) in &steps.0 {
        let mut out = String::new();
        let mut last = 0;
        for m in re.find_iter(&after).flatten() {
            count += 1;
            out.push_str(&after[last..m.start()]);
            out.push_str(replace);
            last = m.end();
        }
        out.push_str(&after[last..]);
        after = out;
    }
    (after, count)
}

/// Один текст після всіх кроків команди по черзі.
pub fn run_steps(text: &str, steps: &[ReplaceStep]) -> (String, usize) {
    run_compiled(text, &compile_steps(steps))
}

/// Переклади, які змінила б команда, і чим кожен став би. Тут нічого не змінюється.
pub fn plan_steps(views: &[FileView], saved: &SavedProject, steps: &[ReplaceStep], limit: usize) -> Vec<FindMatch> {
    let mut out = Vec::new();
    let compiled = compile_steps(steps);
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            if e.target.is_empty() {
                continue;
            }
            let (after, count) = run_compiled(&e.target, &compiled);
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

/// Команда працюючого плагіна, готова для меню: назва вже мовою інтерфейсу.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginCommand {
    /// `<id плагіна>/<id>`: так її називає застосунок.
    pub r#ref: String,
    pub plugin: String,
    pub plugin_name: String,
    pub title: String,
    pub description: Option<String>,
    /// `replace`, `help`, `link`.
    pub action: String,
    pub steps: Option<Vec<ReplaceStep>>,
    /// `help`: id, під яким реєстр знає тему (`<плагін>:<id>`).
    pub help: Option<String>,
    pub url: Option<String>,
}

/// Команди всіх працюючих плагінів у порядку їх додавання.
pub fn plugin_commands(reg: &PluginRegistry, i18n: &mut I18n) -> Vec<PluginCommand> {
    let mut out = Vec::new();
    for r in reg.list().filter(|r| r.state == PluginState::Enabled) {
        let ctx = if r.builtin { CORE.to_string() } else { format!("plugin:{}", r.id()) };
        let list = r.manifest.get("contributes").and_then(|c| c.get("commands")).and_then(Value::as_array).cloned().unwrap_or_default();
        for c in list {
            let s = |k: &str| c.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(String::from);
            let mut tr = |text: &str| i18n.t(text, &vec![], &ctx);
            let steps = c.get("steps").and_then(Value::as_array).map(|a| {
                a.iter()
                    .map(|st| ReplaceStep {
                        find: st["find"].as_str().unwrap_or("").into(),
                        replace: st["replace"].as_str().unwrap_or("").into(),
                        whole_word: st.get("wholeWord").and_then(Value::as_bool) == Some(true),
                        case_sensitive: st.get("caseSensitive").and_then(Value::as_bool) == Some(true),
                    })
                    .collect()
            });
            let name = tr(r.manifest.get("name").and_then(Value::as_str).unwrap_or(""));
            out.push(PluginCommand {
                r#ref: qualified(r, c.get("id").and_then(Value::as_str).unwrap_or("")),
                plugin: r.id().to_string(),
                plugin_name: name,
                title: tr(c.get("title").and_then(Value::as_str).unwrap_or("")),
                description: s("description").map(|d| tr(&d)),
                action: c.get("action").and_then(Value::as_str).unwrap_or("").to_string(),
                steps,
                help: s("help").map(|h| format!("{}:{h}", r.id())),
                url: s("url"),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Зібрані наперед візерунки дають те саме, що `run_steps` (він збирає їх щоразу): кілька кроків по черзі, ціле слово, регістр, порожній `find` пропускається.
    #[test]
    fn compiled_steps_match_run_steps() {
        let steps = vec![
            ReplaceStep { find: "cat".into(), replace: "dog".into(), whole_word: true, case_sensitive: false },
            ReplaceStep { find: String::new(), replace: "x".into(), whole_word: false, case_sensitive: false },
            ReplaceStep { find: "Dog".into(), replace: "wolf".into(), whole_word: false, case_sensitive: true },
        ];
        let compiled = compile_steps(&steps);
        for text in ["The cat sat", "concatenate the Cat", "Dog and dog", "", "кіт и cat’s"] {
            assert_eq!(run_compiled(text, &compiled), run_steps(text, &steps), "{text}");
        }
        assert_eq!(run_steps("The cat sat", &steps), ("The dog sat".to_string(), 1));
    }
}
