//! `plugins.ts`: команди плагінів гри (код 356), чиї аргументи містять текст. Назви й лічильники беруться з самої гри, тож це працює
//! для будь-якого плагіна: перекладач вирішує, які команди показують текст гравцеві.

use crate::js;
use crate::model::GameFile;
use crate::rpgmaker::{command_lists, has_text, split_plugin_command};
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PluginCandidate {
    pub name: String,
    /// Команд із цією назвою.
    pub count: usize,
    /// З них скільки несуть текст з літерами.
    #[serde(rename = "withText")]
    pub with_text: usize,
    /// Різні приклади тексту.
    pub samples: Vec<String>,
    /// Більшість текстів схожа на речення для гравця, а не на технічні аргументи: безпечно позначити заздалегідь.
    pub likely: bool,
}

static ENDS_SENTENCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[.!?…"”]$"#).unwrap());
static LOWER_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^\p{Ll}{2,}[.,!?…"”']?$"#).unwrap());
static NUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[#\d.+-]+$").unwrap());

/// Речення для гравця, на відміну від технічного аргументу («Screen Change Noise Rate 0.05», «SATURATION adjustment 0»):
/// проза має звичайні слова з малих літер і мало чисел.
pub fn looks_like_prose(text: &str) -> bool {
    let words: Vec<&str> = text.split(js::is_space).filter(|w| !w.is_empty()).collect();
    if words.len() < 3 && !ENDS_SENTENCE.is_match(text) {
        return false;
    }
    let lower = words.iter().filter(|w| LOWER_WORD.is_match(w)).count();
    let numeric = words.iter().filter(|w| NUMERIC.is_match(w)).count();
    lower >= 2 && (numeric as f64 / words.len() as f64) < 0.3
}

struct Acc {
    count: usize,
    with_text: usize,
    wordy: usize,
    samples: IndexSet<String>,
}

/// Команди плагінів (код 356), чиї аргументи містять текст.
pub fn plugin_candidates(game: &[GameFile]) -> Vec<PluginCandidate> {
    let mut m: IndexMap<String, Acc> = IndexMap::new();
    for f in game {
        for list in command_lists(f) {
            for c in &list {
                if c.get("code").and_then(Value::as_f64) != Some(356.0) {
                    continue;
                }
                let Some(cmd) = c.get("parameters").and_then(Value::as_array).and_then(|p| p.first()).and_then(Value::as_str) else { continue };
                let (name, _, text) = split_plugin_command(cmd);
                if name.is_empty() {
                    continue;
                }
                let e = m.entry(name).or_insert(Acc { count: 0, with_text: 0, wordy: 0, samples: IndexSet::new() });
                e.count += 1;
                if has_text(&text) {
                    e.with_text += 1;
                    if looks_like_prose(&text) {
                        e.wordy += 1;
                    }
                    if e.samples.len() < 3 {
                        e.samples.insert(js::slice16(&text, 80));
                    }
                }
            }
        }
    }
    let mut out: Vec<PluginCandidate> = m
        .into_iter()
        .filter(|(_, e)| e.with_text > 0)
        .map(|(name, e)| PluginCandidate { name, count: e.count, with_text: e.with_text, samples: e.samples.into_iter().collect(), likely: e.wordy as f64 / e.with_text as f64 >= 0.6 && e.with_text >= 3 })
        .collect();
    out.sort_by(|a, b| b.likely.cmp(&a.likely).then_with(|| b.with_text.cmp(&a.with_text)));
    out
}
