//! `ext/glossaries.ts`: глосарії, які приносять плагіни, і їх додавання до проєкту.

use crate::glossary::{normalize_gap, pattern_parts};
use crate::js;
use crate::project::SavedProject;
use crate::termedit::{save_term, SaveResult, TermForm};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Термін, який приносить плагін.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BroughtTerm {
    pub en: String,
    pub uk: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

const LIMIT: usize = 5000;

fn is_json_file(name: &str) -> bool {
    name.len() >= 5 && name.is_char_boundary(name.len() - 5) && name[name.len() - 5..].eq_ignore_ascii_case(".json")
}

/// Терміни одного глосарія плагіна: записані в маніфесті або з його файлу (`.json` — список, `.tsv` — оригінал, табуляція,
/// переклад, табуляція, варіанти через `;`). `file_text` — вміст файлу `g.file` у пакеті (порожній, якщо файлу немає).
pub fn glossary_terms(g: &Value, file_text: &str) -> (Vec<BroughtTerm>, usize) {
    let mut raw: Vec<Value> = Vec::new();
    if let Some(a) = g.get("terms").and_then(Value::as_array) {
        raw.extend(a.iter().cloned());
    }
    if let Some(file) = g.get("file").and_then(Value::as_str).filter(|f| !f.is_empty()) {
        if is_json_file(file) {
            if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(file_text) {
                raw.extend(a);
            }
        } else {
            for line in file_text.split('\n') {
                let line = line.strip_suffix('\r').unwrap_or(line);
                if js::trim(line).is_empty() || line.starts_with('#') {
                    continue;
                }
                let mut parts = line.split('\t');
                let (en, uk, alt, note) = (parts.next(), parts.next(), parts.next(), parts.next());
                let mut m = serde_json::Map::new();
                if let Some(en) = en {
                    m.insert("en".into(), Value::from(en));
                }
                if let Some(uk) = uk {
                    m.insert("uk".into(), Value::from(uk));
                }
                if let Some(alt) = alt.filter(|a| !js::trim(a).is_empty()) {
                    m.insert("alt".into(), alt.split(';').map(js::trim).filter(|x| !x.is_empty()).map(Value::from).collect());
                }
                if let Some(note) = note.filter(|n| !js::trim(n).is_empty()) {
                    m.insert("note".into(), Value::from(js::trim(note)));
                }
                raw.push(Value::Object(m));
            }
        }
    }
    let mut terms = Vec::new();
    let mut skipped = 0;
    let mut seen: HashSet<String> = HashSet::new();
    for r in raw.iter().take(LIMIT * 2) {
        let s = |k: &str| r.get(k).and_then(Value::as_str).map(normalize_gap).unwrap_or_default();
        let (en, uk) = (s("en"), s("uk"));
        // у терміна має бути що шукати з обох боків (самий пропуск — не термін)
        if en.is_empty() || uk.is_empty() || js::len16(&en) > 200 || js::len16(&uk) > 200 || pattern_parts(&en).is_empty() || pattern_parts(&uk).is_empty() || seen.contains(&en.to_lowercase()) {
            skipped += 1;
            continue;
        }
        seen.insert(en.to_lowercase());
        let alt: Vec<String> = r.get("alt").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter(|a| !js::trim(a).is_empty() && js::len16(a) <= 200).map(String::from).collect()).unwrap_or_default();
        let note = r.get("note").and_then(Value::as_str).filter(|n| !js::trim(n).is_empty()).map(|n| js::slice16(js::trim(n), 300));
        terms.push(BroughtTerm { en, uk, alt: if alt.is_empty() { None } else { Some(alt) }, note });
        if terms.len() >= LIMIT {
            break;
        }
    }
    (terms, skipped)
}

/// Що зробить додавання глосарія до проєкту, термін за терміном: нові, ті, що проєкт має так само, і ті, що він перекладає інакше (лишаються як є).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct GlossaryPlan {
    pub add: Vec<BroughtTerm>,
    pub same: Vec<BroughtTerm>,
    pub differ: Vec<Differ>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Differ {
    pub brought: BroughtTerm,
    pub has: String,
}

pub fn plan_glossary_import(terms_in_project: &[Value], terms: &[BroughtTerm]) -> GlossaryPlan {
    let mut have: HashMap<String, &Value> = HashMap::new();
    for t in terms_in_project {
        have.insert(js::trim(t.get("en").and_then(Value::as_str).unwrap_or("")).to_lowercase(), t);
    }
    let mut plan = GlossaryPlan::default();
    for b in terms {
        match have.get(&b.en.to_lowercase()) {
            None => plan.add.push(b.clone()),
            Some(h) => {
                let uk = h.get("uk").and_then(Value::as_str).unwrap_or("");
                if js::trim(uk).to_lowercase() == js::trim(&b.uk).to_lowercase() {
                    plan.same.push(b.clone());
                } else {
                    plan.differ.push(Differ { brought: b.clone(), has: uk.to_string() });
                }
            }
        }
    }
    plan
}

/// Додає нові терміни плану до проєкту. Термін, що проєкт уже має, тут ніколи не замінюється (він власний у перекладача). Повертає, скільки додано.
pub fn apply_glossary_import(saved: &mut SavedProject, plan: &GlossaryPlan, now: i64) -> usize {
    let mut n = 0;
    for b in &plan.add {
        let form = TermForm { en: b.en.clone(), uk: b.uk.clone(), alt: b.alt.as_ref().filter(|a| !a.is_empty()).map(|a| a.join("; ")), note: b.note.clone().filter(|n| !n.is_empty()), ..Default::default() };
        if save_term(saved, &form, now, None) == Some(SaveResult::Added) {
            n += 1;
        }
    }
    n
}
