//! Додавання, зміна й видалення термінів глосарію (`core/termedit.ts`).
//! Терміни лежать у проєкті як `Value` (невідомі поля зберігаються).

use crate::glossary::{normalize_gap, pattern_parts, TERM_GENDERS};
use crate::js;
use crate::project::SavedProject;
use serde_json::{json, Map, Value};

/// Що містить форма терміна. Пропущені (`None`) категорія, примітка й рід лишають те, що є в терміні; порожні — стирають.
#[derive(Clone, Debug, Default)]
pub struct TermForm {
    pub en: String,
    pub uk: String,
    pub alt: Option<String>,
    pub kind: Option<String>,
    pub note: Option<String>,
    pub qa: Option<bool>,
    pub gender: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveResult {
    Added,
    Changed,
    Exists,
}

fn key_of(en: &str) -> String {
    js::trim(en).to_lowercase()
}

fn term_en(t: &Value) -> String {
    t.get("en").and_then(Value::as_str).map(key_of).unwrap_or_default()
}

/// Варіанти терміна, як їх набрано у формі.
pub fn split_alts(s: Option<&str>) -> Vec<String> {
    s.unwrap_or("").split([';', ',']).map(|x| js::trim(x).to_string()).filter(|x| !x.is_empty()).collect()
}

/// Варіанти для показу у формі.
pub fn join_alts(alt: Option<&[String]>) -> String {
    alt.unwrap_or(&[]).join("; ")
}

/// Додає термін або змінює наявний. `was` — первісне слово терміна, що змінюється (його можна перейменувати);
/// без нього форма додає новий, а слово, що вже є, дає `Exists`. Обидва поля потрібні (`None`, якщо порожнє).
/// Перейменований термін лишає слід старого слова, щоб копія з іншого пристрою не повернулась при злитті.
pub fn save_term_in(terms: &mut Vec<Value>, deleted: &mut Option<Map<String, Value>>, form: &TermForm, now: i64, was: Option<&str>) -> Option<SaveResult> {
    let en = normalize_gap(&form.en);
    let uk = normalize_gap(&form.uk);
    if en.is_empty() || uk.is_empty() || pattern_parts(&en).is_empty() || pattern_parts(&uk).is_empty() {
        return None;
    }
    let old_key = key_of(was.unwrap_or(&en));
    let new_key = key_of(&en);
    let at = terms.iter().position(|t| term_en(t) == old_key);
    if was.is_none() && at.is_some() {
        return Some(SaveResult::Exists);
    }
    if at.is_some() && old_key != new_key && terms.iter().any(|t| term_en(t) == new_key) {
        return Some(SaveResult::Exists);
    }
    let alts: Vec<String> = split_alts(form.alt.as_deref()).iter().map(|a| normalize_gap(a)).collect();
    let prev = at.map(|i| &terms[i]);
    let prev_field = |k: &str| prev.and_then(|p| p.get(k)).cloned();
    let mut term: Map<String, Value> = prev.and_then(Value::as_object).cloned().unwrap_or_default();
    for k in ["alt", "kind", "note", "qa", "gender"] {
        term.shift_remove(k);
    }
    let kind = match &form.kind {
        None => prev_field("kind"),
        Some(k) => Some(js::trim(k)).filter(|k| !k.is_empty()).map(|k| json!(k)),
    };
    let note = match &form.note {
        None => prev_field("note"),
        Some(n) => Some(js::trim(n)).filter(|n| !n.is_empty()).map(|n| json!(n)),
    };
    let gender = match &form.gender {
        None => prev_field("gender"),
        Some(g) => TERM_GENDERS.iter().map(|x| json!(x)).find(|x| x.as_str() == Some(g.as_str())),
    };
    let truthy = |v: &Option<Value>| v.as_ref().is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)) && v.as_str() != Some("") && v.as_f64() != Some(0.0));
    term.insert("en".into(), json!(en));
    term.insert("uk".into(), json!(uk));
    term.insert("mt".into(), json!(now));
    if !alts.is_empty() {
        term.insert("alt".into(), json!(alts));
    }
    if truthy(&kind) {
        term.insert("kind".into(), kind.unwrap());
    }
    if truthy(&note) {
        term.insert("note".into(), note.unwrap());
    }
    if truthy(&gender) {
        term.insert("gender".into(), gender.unwrap());
    }
    if form.qa == Some(false) {
        term.insert("qa".into(), json!(false));
    }
    match at {
        Some(i) => {
            terms[i] = Value::Object(term);
            if old_key != new_key {
                deleted.get_or_insert_with(Map::new).insert(old_key, json!(now));
            }
            Some(SaveResult::Changed)
        }
        None => {
            terms.push(Value::Object(term));
            Some(SaveResult::Added)
        }
    }
}

/// Видаляє термін. Лишається слід видалення, щоб копія з іншого пристрою не повернула його при злитті.
pub fn remove_term_in(terms: &mut Vec<Value>, deleted: &mut Option<Map<String, Value>>, en: &str, now: i64) -> bool {
    let k = key_of(en);
    let before = terms.len();
    terms.retain(|t| term_en(t) != k);
    if terms.len() == before {
        return false;
    }
    deleted.get_or_insert_with(Map::new).insert(k, json!(now));
    true
}

pub fn save_term(saved: &mut SavedProject, form: &TermForm, now: i64, was: Option<&str>) -> Option<SaveResult> {
    save_term_in(&mut saved.terms, &mut saved.deleted_terms, form, now, was)
}

pub fn remove_term(saved: &mut SavedProject, en: &str, now: i64) -> bool {
    remove_term_in(&mut saved.terms, &mut saved.deleted_terms, en, now)
}
