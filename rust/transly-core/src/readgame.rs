//! `project.ts` (читання гри): `readGame`, `mapLabels`, `labelsOf`: з файлів гри збирає вигляди з рядками й назвами мап.

use crate::engine::extract;
use crate::js;
use crate::model::GameFile;
use crate::project::FileView;
use crate::rpgmaker::ExtractOptions;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::LazyLock;

/// Назви мап з MapInfos.json; власна `displayName` мапи перемагає, коли задана.
fn map_labels(files: &[GameFile]) -> IndexMap<String, String> {
    static MAP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Map([0-9]+)\.json$").unwrap());
    let base = |n: &str| n.rsplit('/').next().unwrap_or(n).to_string();
    let mut out = IndexMap::new();
    let mut names: HashMap<i64, String> = HashMap::new();
    if let Some(Value::Array(infos)) = files.iter().find(|f| base(&f.name) == "MapInfos.json").map(|f| &f.json) {
        for i in infos {
            if let Some(id) = i.get("id").and_then(|x| x.as_f64()).filter(|_| i.is_object()) {
                let name = match i.get("name") {
                    None | Some(Value::Null) => String::new(),
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::Bool(b)) => b.to_string(),
                    Some(_) => "[object Object]".into(),
                };
                names.insert(id as i64, name);
            }
        }
    }
    for f in files {
        let b = base(&f.name);
        let Some(m) = MAP.captures(&b) else { continue };
        let display = f.json.get("displayName").and_then(|d| d.as_str()).map(js::trim).filter(|d| !d.is_empty());
        let label = display.map(String::from).or_else(|| names.get(&m[1].parse::<i64>().unwrap_or(-1)).filter(|n| !n.is_empty()).cloned()).unwrap_or_default();
        if !label.is_empty() {
            out.insert(f.name.clone(), label);
        }
    }
    out
}

/// Перечитує гру: рядки кожного файлу, що їх має.
pub fn read_game(files: &[GameFile], opts: &ExtractOptions) -> Vec<FileView> {
    let labels = map_labels(files);
    files.iter().map(|f| FileView { name: f.name.clone(), units: extract(f, opts), label: labels.get(&f.name).cloned() }).filter(|v| !v.units.is_empty()).collect()
}

pub fn labels_of(views: &[FileView]) -> Map<String, Value> {
    views.iter().filter_map(|v| v.label.as_ref().filter(|l| !l.is_empty()).map(|l| (v.name.clone(), json!(l)))).collect()
}
