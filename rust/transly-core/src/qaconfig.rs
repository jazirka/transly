//! `qaconfig.ts`: що перекладач обрав про правила QA (діалог «Правила QA»). Живе в налаштуваннях проєкту як необов'язковий
//! об'єкт `qa`: проєкт, збережений до його появи, чи копія без нього отримує типові значення для кожного правила, яке не
//! згадано, а невідоме значення ігнорується. Кеш по об'єкту налаштувань (`WeakMap`) не переноситься.

use crate::js;
use crate::qarules::{qa_rules_revision, QaRules, RuleSeverity, QA_RULES};
use indexmap::IndexMap;
use serde_json::{json, Map, Value};
use std::collections::HashSet;

pub const APOSTROPHES: [&str; 4] = ["any", "’", "ʼ", "'"];

fn build(q: Option<&Value>) -> QaRules {
    let mut sev: IndexMap<String, RuleSeverity> = IndexMap::new();
    for r in QA_RULES.iter() {
        let v = q.and_then(|q| q.get("rules")).and_then(|r2| r2.get(r.id)).and_then(|v| v.as_str()).and_then(RuleSeverity::parse);
        sev.insert(r.id.to_string(), v.unwrap_or(r.def));
    }
    let mut keep: HashSet<String> = HashSet::new();
    if let Some(list) = q.and_then(|q| q.get("keep")).and_then(|k| k.as_array()) {
        for w in list {
            let t = w.as_str().map(|s| js::trim(s).to_lowercase()).unwrap_or_default();
            if !t.is_empty() && js::len16(&t) <= 40 {
                keep.insert(t);
            }
        }
    }
    let apostrophe = q.and_then(|q| q.get("apostrophe")).and_then(|a| a.as_str()).filter(|a| APOSTROPHES.contains(a)).unwrap_or("any").to_string();
    let mut sorted: Vec<&String> = keep.iter().collect();
    sorted.sort_by(|a, b| js::cmp(a, b));
    let sig = format!(
        "{}|{}|{apostrophe}|r{}",
        QA_RULES.iter().map(|r| format!("{}={}", r.id, sev[r.id].as_str())).collect::<Vec<_>>().join(","),
        sorted.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(","),
        qa_rules_revision()
    );
    QaRules { sev, keep, apostrophe, sig }
}

/// Правила QA проєкту, кожне поле перевірене й добране. `qa` — значення `settings.qa`, якщо воно є.
pub fn qa_of(qa: Option<&Value>) -> QaRules {
    match qa {
        Some(q) if q.is_object() => build(Some(q)),
        _ => build(None),
    }
}

/// Копія налаштувань з одним правилом на заданому рівні (типовий рівень зберігається як «не згадано»).
pub fn with_rule_level(q: Option<&Value>, id: &str, level: RuleSeverity) -> Value {
    let mut rules: Map<String, Value> = q.and_then(|q| q.get("rules")).and_then(|r| r.as_object()).cloned().unwrap_or_default();
    let def = QA_RULES.iter().find(|r| r.id == id).map(|r| r.def);
    if Some(level) == def {
        rules.shift_remove(id);
    } else {
        rules.insert(id.to_string(), json!(level.as_str()));
    }
    let mut out: Map<String, Value> = q.and_then(|q| q.as_object()).cloned().unwrap_or_default();
    out.insert("rules".into(), Value::Object(rules.clone()));
    if rules.is_empty() {
        out.shift_remove("rules");
    }
    Value::Object(out)
}

/// Слова списку «залишати» одним текстом для редагування (по слову на рядок) і назад.
pub fn keep_to_text(keep: &[String]) -> String {
    keep.join("\n")
}
pub fn keep_from_text(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in text.split(|c: char| js::is_space(c) || c == ',' || c == ';') {
        let w = js::trim(w).to_lowercase();
        if !w.is_empty() && !out.contains(&w) {
            out.push(w);
        }
    }
    out.truncate(500);
    out
}
