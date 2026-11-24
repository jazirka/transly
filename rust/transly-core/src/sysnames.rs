//! `sysnames.ts`: назви, які розробник дав перемикачам і змінним, і валюта: вони пояснюють `\V[12]` та умови подій.

use crate::model::{GameFile, PageInfo};
use crate::js;
use indexmap::IndexMap;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SysNames {
    pub variables: IndexMap<String, String>,
    pub switches: IndexMap<String, String>,
    pub currency: Option<String>,
}

pub fn sys_names_of(files: &[GameFile]) -> Option<SysNames> {
    let j = files.iter().find(|f| f.name == "System.json")?.json.as_object()?;
    let list = |v: Option<&Value>| -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        if let Some(Value::Array(a)) = v {
            for (i, n) in a.iter().enumerate() {
                if let Some(s) = n.as_str().filter(|s| !js::trim(s).is_empty()) {
                    out.insert(i.to_string(), js::trim(s).to_string());
                }
            }
        }
        out
    };
    let variables = list(j.get("variables"));
    let switches = list(j.get("switches"));
    let currency = j.get("currencyUnit").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    if !variables.is_empty() || !switches.is_empty() || currency.is_some() {
        Some(SysNames { variables, switches, currency })
    } else {
        None
    }
}

const TRIGGERS: [&str; 5] = ["кнопка дії", "дотик гравця", "дотик події", "автозапуск", "паралельний процес"];

/// Умови сторінки події короткими українськими фразами.
pub fn describe_page(p: &PageInfo, names: Option<&SysNames>) -> Vec<String> {
    let name_of = |m: Option<&IndexMap<String, String>>, id: i64| m.and_then(|m| m.get(&id.to_string())).cloned();
    let sw = |id: i64| format!("перемикач {id}{} увімкнено", name_of(names.map(|n| &n.switches), id).map_or(String::new(), |n| format!(" «{n}»")));
    let trigger = usize::try_from(p.trigger).ok().and_then(|t| TRIGGERS.get(t)).map_or(p.trigger.to_string(), |s| s.to_string());
    let mut out = vec![format!("запуск: {trigger}"), format!("клітинка {}, {}", p.x, p.y)];
    for id in &p.switches {
        out.push(sw(*id));
    }
    if let Some(v) = &p.variable {
        out.push(format!("змінна {}{} ≥ {}", v.id, name_of(names.map(|n| &n.variables), v.id).map_or(String::new(), |n| format!(" «{n}»")), v.min));
    }
    if let Some(s) = p.self_switch.as_deref().filter(|s| !s.is_empty()) {
        out.push(format!("локальний перемикач {s}"));
    }
    if let Some(i) = p.item.filter(|i| *i != 0) {
        out.push(format!("є предмет {i}"));
    }
    if let Some(a) = p.actor.filter(|a| *a != 0) {
        out.push(format!("в групі персонаж {a}"));
    }
    out
}
