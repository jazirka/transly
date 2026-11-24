//! `usage.ts`: де гра видає предмет, зброю, броню чи навичку: `Items.json:5` → контексти подій.

use crate::model::GameFile;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

pub type Usage = IndexMap<String, Vec<String>>;

static MAP_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Map\d+\.json$").unwrap());
static DB_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[(\d+)\]\.").unwrap());

fn give(code: f64) -> Option<&'static str> {
    match code as i64 {
        126 if code == 126.0 => Some("Items.json"),
        127 if code == 127.0 => Some("Weapons.json"),
        128 if code == 128.0 => Some("Armors.json"),
        _ => None,
    }
}

/// Число так, як його друкує JS у шаблонному рядку.
fn num(v: &Value) -> String {
    match v.as_i64() {
        Some(i) => i.to_string(),
        None => v.as_f64().map_or(String::new(), |f| f.to_string()),
    }
}

fn is_zero(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64) == Some(0.0)
}

fn note(out: &mut Usage, key: String, wh: &str) {
    let a = out.entry(key).or_default();
    if a.len() < 8 && !a.iter().any(|x| x == wh) {
        a.push(wh.to_string());
    }
}

fn scan(out: &mut Usage, list: Option<&Value>, wh: &str) {
    let Some(Value::Array(list)) = list else { return };
    for c in list {
        let Some(p) = c.get("parameters").and_then(Value::as_array) else { continue };
        let code = c.get("code").and_then(Value::as_f64);
        if let Some(file) = code.and_then(give).filter(|_| is_zero(p.get(1)) && p.first().is_some_and(Value::is_number)) {
            note(out, format!("{file}:{}", num(&p[0])), wh);
        } else if code == Some(318.0) && is_zero(p.get(1)) && p.get(2).is_some_and(Value::is_number) {
            note(out, format!("Skills.json:{}", num(&p[2])), wh);
        }
    }
}

pub fn build_usage(game: &[GameFile], label_of: &dyn Fn(&str) -> Option<String>) -> Usage {
    let mut out: Usage = IndexMap::new();
    for f in game {
        if MAP_FILE.is_match(&f.name) && f.json.is_object() && f.json.get("events").is_some_and(Value::is_array) {
            let label = label_of(&f.name).filter(|l| !l.is_empty());
            for ev in f.json["events"].as_array().unwrap() {
                let Some(pages) = ev.get("pages").and_then(Value::as_array) else { continue };
                let name = ev.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()).map_or_else(|| format!("EV{}", ev.get("id").filter(|i| i.is_number()).map_or("undefined".to_string(), num)), String::from);
                let wh = format!("{}{} · {name}", f.name, label.as_ref().map_or(String::new(), |l| format!(" ({l})")));
                for pg in pages {
                    scan(&mut out, pg.get("list"), &wh);
                }
            }
        } else if f.name == "CommonEvents.json" {
            if let Value::Array(evs) = &f.json {
                for ev in evs {
                    if ev.is_null() || !ev.is_object() {
                        continue;
                    }
                    let name = match ev.get("name") {
                        Some(Value::String(s)) => s.clone(),
                        Some(n) if n.is_number() => num(n),
                        _ => String::new(),
                    };
                    scan(&mut out, ev.get("list"), &format!("Спільна подія · {name}"));
                }
            }
        }
    }
    out
}

/// Ключ використання для одиниці рядка бази: `Items.json`, `[5].name` → `Items.json:5`.
pub fn usage_key(file: &str, unit_key: &str) -> Option<String> {
    DB_KEY.captures(unit_key).map(|m| format!("{file}:{}", &m[1]))
}
