//! `ext/units.ts`: рядки, які повертає плагін, — недовірені дані. Кожен приводиться до відомого застосунку вигляду
//! (текстовий ключ, текст оригіналу, відомий вид), ключі робляться безпечними й унікальними, а що не рядок — відкидається.

use crate::js;
use crate::keys::safe_key;
use crate::model::{Unit, UnitKind};
use serde_json::Value;
use std::collections::HashSet;

const MAX_UNITS: usize = 200_000;
const MAX_TEXT: usize = 100_000;

fn kind_of(v: Option<&Value>) -> UnitKind {
    match v.and_then(Value::as_str) {
        Some("dialogue") => UnitKind::Dialogue,
        Some("choice") => UnitKind::Choice,
        Some("scroll") => UnitKind::Scroll,
        Some("name") => UnitKind::Name,
        Some("description") => UnitKind::Description,
        Some("term") => UnitKind::Term,
        _ => UnitKind::Message,
    }
}

pub fn clean_units(raw: &Value) -> Result<Vec<Unit>, String> {
    let Some(list) = raw.as_array() else { return Err("the plugin did not return a list of rows".into()) };
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for r in list.iter().take(MAX_UNITS) {
        let Some(o) = r.as_object() else { continue };
        let (Some(key), Some(source)) = (o.get("key").and_then(Value::as_str), o.get("source").and_then(Value::as_str)) else { continue };
        if key.is_empty() || js::len16(key) > 400 || js::len16(source) > MAX_TEXT {
            continue;
        }
        let key = safe_key(key);
        if !seen.insert(key.clone()) {
            continue;
        }
        let str_of = |k: &str, max: usize| o.get(k).and_then(Value::as_str).map_or(String::new(), |s| js::slice16(s, max));
        out.push(Unit {
            key,
            source: source.to_string(),
            speaker: str_of("speaker", 200),
            face: None,
            event: None,
            note: None,
            db_note: None,
            page: None,
            kind: kind_of(o.get("kind")),
            context: str_of("context", 400),
        });
    }
    Ok(out)
}
