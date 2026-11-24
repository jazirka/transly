//! `rpgmaker.ts`: читання й запис файлів даних RPG Maker MV/MZ (`data/*.json`). Працює над `serde_json::Value` розібраного
//! JSON (порядок ключів зберігається); файл гри ніколи не змінюється — запис дає змінену копію.
//!
//! Відмінність від TS: числа JSON з дробовою частиною `.0` пишуться як у `serde_json` (`1.0`), а не `1`, як у `JSON.stringify`;
//! для гри це те саме число. Цілі більші за 2^53 у Rust зберігаються точно.

use crate::model::{GameFile, PageInfo, Translations, Unit, UnitKind, VariableCond};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

/// Що витягати понад стандартні поля.
#[derive(Clone, Debug, Default)]
pub struct ExtractOptions {
    /// Команди плагінів (код 356), чиї аргументи — текст для гравця, наприклад `GabText`.
    pub plugin_commands: Vec<String>,
}

fn is_obj(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}
fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(|v| v.as_str())
}

const DB_FIELDS: [(&str, &[&str]); 8] = [
    ("Actors.json", &["name", "nickname", "profile"]),
    ("Armors.json", &["name", "description"]),
    ("Classes.json", &["name"]),
    ("Enemies.json", &["name"]),
    ("Items.json", &["name", "description"]),
    ("Skills.json", &["name", "description", "message1", "message2"]),
    ("States.json", &["name", "message1", "message2", "message3", "message4"]),
    ("Weapons.json", &["name", "description"]),
];
fn db_fields(name: &str) -> Option<&'static [&'static str]> {
    DB_FIELDS.iter().find(|(n, _)| *n == name).map(|(_, f)| *f)
}
fn db_kind(f: &str) -> UnitKind {
    match f {
        "name" | "nickname" => UnitKind::Name,
        "description" | "profile" => UnitKind::Description,
        _ => UnitKind::Message,
    }
}

static MAP_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Map[0-9]+\.json$").unwrap());

/// `EV003`, або `EV003 · Старий солдат`, коли подія має власну назву (подія з назвою, що збігається з її номером, — `EV003`, не `EV003 · EV003`).
pub fn event_label(id: &str, name: &str) -> String {
    let num = format!("EV{id:0>3}");
    if !name.is_empty() && crate::js::trim(name).to_lowercase() != num.to_lowercase() { format!("{num} · {name}") } else { num }
}

/// Файл, що його скопіювали чи надіслали, зазвичай повертається перейменованим: "Map001 (1).json", "map001.json", "Items.json.txt".
/// Повертає ім'я, яке використовує гра, або None, коли це взагалі не файл RPG Maker.
pub fn canonical_rpgmaker_name(name: &str) -> Option<String> {
    static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(txt|bak)$").unwrap());
    static NUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\([0-9]+\)(?:\.[^.]*$|$)").unwrap());
    static JSON_EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.json$").unwrap());
    static MAP_STEM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^map([0-9]+)$").unwrap());
    let base0 = name.rsplit(['\\', '/']).next().unwrap_or(name);
    let base1 = EXT.replace(base0, "").into_owned();
    // `(\d+)` без розширення, що йде далі: у JS це `\s*\(\d+\)(?=\.[^.]*$|$)` (опередження), тож видаляється лише сама група
    let base = match NUM.find(&base1) {
        Some(m) => {
            let tail_start = m.as_str().find(')').map(|i| m.start() + i + 1).unwrap_or(m.end());
            format!("{}{}", &base1[..m.start()], &base1[tail_start..])
        }
        None => base1,
    };
    let stem = JSON_EXT.replace(&base, "").into_owned();
    let canon: Option<String> = if let Some(m) = MAP_STEM.captures(&stem) {
        Some(format!("Map{}.json", &m[1]))
    } else {
        let want = format!("{stem}.json").to_lowercase();
        DB_FIELDS.iter().map(|(n, _)| *n).chain(["MapInfos.json", "CommonEvents.json", "Troops.json", "System.json"]).find(|n| n.to_lowercase() == want).map(String::from)
    };
    canon.filter(|c| is_rpgmaker_file(c))
}

pub fn is_rpgmaker_file(name: &str) -> bool {
    MAP_FILE.is_match(name) || matches!(name, "MapInfos.json" | "CommonEvents.json" | "Troops.json" | "System.json") || db_fields(name).is_some()
}

fn is_map(n: &str) -> bool {
    MAP_FILE.is_match(n)
}

const SYSTEM_ARRAYS: [&str; 5] = ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"];
const SYSTEM_TERMS: [&str; 3] = ["basic", "commands", "params"];

static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+\[[0-9]+\]|\\[{}.|!><^$]").unwrap());
static LETTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}").unwrap());

/// Рядки без літер (`\p[1]`, `...`, `---`) не потребують перекладу й лише додають шум.
pub fn has_text(source: &str) -> bool {
    LETTER.is_match(&CODE.replace_all(source, ""))
}

fn unit(key: String, source: String, kind: UnitKind, context: String) -> Unit {
    Unit { key, source, speaker: String::new(), face: None, event: None, note: None, db_note: None, page: None, kind, context }
}

static LIST_PREFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.*\.list)\[").unwrap());

/// Витягує кожен рядок для перекладу з одного файлу гри. Невідомі файли не дають рядків.
pub fn extract_rpgmaker(file: &GameFile, opts: &ExtractOptions) -> Vec<Unit> {
    let mut out: Vec<Unit> = Vec::new();
    // умови сторінки стоять на її першому рядку; коли в нього немає власного тексту, їх переймає наступний рядок сторінки
    let mut carried: Option<PageInfo> = None;
    let mut carried_list = String::new();
    for mut u in extract_all(file, opts) {
        let list = LIST_PREFIX.captures(&u.key).map(|m| m[1].to_string()).unwrap_or_default();
        if !has_text(&u.source) {
            if let Some(p) = &u.page {
                carried = Some(p.clone());
                carried_list = list;
            }
            continue;
        }
        if carried.is_some() && u.page.is_none() && list == carried_list {
            u.page = carried.clone();
        }
        if u.page.is_some() || list != carried_list {
            carried = None;
            carried_list = String::new();
        }
        out.push(u);
    }
    out
}

fn extract_all(file: &GameFile, opts: &ExtractOptions) -> Vec<Unit> {
    let n = file.name.as_str();
    if is_map(n) {
        return extract_map(&file.json, opts);
    }
    match n {
        "CommonEvents.json" => return extract_common(&file.json, opts),
        "Troops.json" => return extract_troops(&file.json, opts),
        "System.json" => return extract_system(&file.json),
        _ => {}
    }
    match db_fields(n) {
        Some(f) => extract_db(&file.json, f),
        None => Vec::new(),
    }
}

/// Число з JSON як у JS `String(n)`.
fn num_str(n: &serde_json::Number) -> String {
    match n.as_i64() {
        Some(i) => i.to_string(),
        None => n.as_f64().map_or(String::new(), |f| if f.fract() == 0.0 { format!("{}", f as i64) } else { format!("{f}") }),
    }
}

fn extract_map(json: &Value, opts: &ExtractOptions) -> Vec<Unit> {
    let Some(events) = is_obj(json).and_then(|j| j.get("events")).and_then(|e| e.as_array()) else { return Vec::new() };
    let mut out = Vec::new();
    if let Some(dn) = str_of(json.get("displayName")).filter(|s| !s.is_empty()) {
        out.push(unit("displayName".into(), dn.into(), UnitKind::Name, "Назва місцевості".into()));
    }
    for (ei, ev) in events.iter().enumerate() {
        let Some(pages) = is_obj(ev).and_then(|e| e.get("pages")).and_then(|p| p.as_array()) else { continue };
        let ev_name = str_of(ev.get("name")).unwrap_or("");
        let ev_id = match ev.get("id") {
            Some(Value::Number(n)) => num_str(n),
            _ => ei.to_string(),
        };
        for (pi, page) in pages.iter().enumerate() {
            let Some(list) = is_obj(page).and_then(|p| p.get("list")).and_then(|l| l.as_array()) else { continue };
            let mut rows = extract_list(list, &format!("events[{ei}].pages[{pi}].list"), &event_label(&ev_id, ev_name), ev_name, opts);
            if let Some(first) = rows.first_mut() {
                first.page = Some(page_info(page, ev));
            }
            out.extend(rows);
        }
    }
    out
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}
fn n_of(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as i64),
        _ => 0,
    }
}

pub fn page_info(page: &Value, ev: &Value) -> PageInfo {
    let empty = Map::new();
    let c = page.get("conditions").and_then(|c| c.as_object()).unwrap_or(&empty);
    let mut info = PageInfo { trigger: n_of(page.get("trigger")), x: n_of(ev.get("x")), y: n_of(ev.get("y")), switches: vec![], variable: None, self_switch: None, item: None, actor: None };
    if truthy(c.get("switch1Valid")) {
        info.switches.push(n_of(c.get("switch1Id")));
    }
    if truthy(c.get("switch2Valid")) {
        info.switches.push(n_of(c.get("switch2Id")));
    }
    if truthy(c.get("variableValid")) {
        info.variable = Some(VariableCond { id: n_of(c.get("variableId")), min: c.get("variableValue").and_then(|v| v.as_f64()).unwrap_or(0.0) });
    }
    if truthy(c.get("selfSwitchValid")) {
        if let Some(ch) = str_of(c.get("selfSwitchCh")) {
            info.self_switch = Some(ch.to_string());
        }
    }
    if truthy(c.get("itemValid")) {
        info.item = Some(n_of(c.get("itemId")));
    }
    if truthy(c.get("actorValid")) {
        info.actor = Some(n_of(c.get("actorId")));
    }
    info
}

fn extract_common(json: &Value, opts: &ExtractOptions) -> Vec<Unit> {
    let Some(arr) = json.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for (i, ev) in arr.iter().enumerate() {
        let Some(list) = is_obj(ev).and_then(|e| e.get("list")).and_then(|l| l.as_array()) else { continue };
        let name = str_of(ev.get("name")).unwrap_or("");
        out.extend(extract_list(list, &format!("[{i}].list"), &format!("Common {i}{}", if name.is_empty() { String::new() } else { format!(" · {name}") }), name, opts));
    }
    out
}

fn extract_troops(json: &Value, opts: &ExtractOptions) -> Vec<Unit> {
    let Some(arr) = json.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for (i, t) in arr.iter().enumerate() {
        let Some(pages) = is_obj(t).and_then(|e| e.get("pages")).and_then(|l| l.as_array()) else { continue };
        let name = str_of(t.get("name")).unwrap_or("");
        for (pi, page) in pages.iter().enumerate() {
            if let Some(list) = is_obj(page).and_then(|p| p.get("list")).and_then(|l| l.as_array()) {
                out.extend(extract_list(list, &format!("[{i}].pages[{pi}].list"), &format!("Бій {i}{}", if name.is_empty() { String::new() } else { format!(" · {name}") }), "", opts));
            }
        }
    }
    out
}

fn extract_system(json: &Value) -> Vec<Unit> {
    let Some(j) = is_obj(json) else { return Vec::new() };
    let mut out = Vec::new();
    let mut add = |key: String, v: Option<&Value>, ctx: &str| {
        if let Some(s) = str_of(v).filter(|s| !s.is_empty()) {
            out.push(unit(key, s.into(), UnitKind::Term, ctx.into()));
        }
    };
    add("gameTitle".into(), j.get("gameTitle"), "Назва гри");
    add("currencyUnit".into(), j.get("currencyUnit"), "Валюта");
    for name in SYSTEM_ARRAYS {
        if let Some(arr) = j.get(name).and_then(|a| a.as_array()) {
            for (i, v) in arr.iter().enumerate() {
                add(format!("{name}[{i}]"), Some(v), name);
            }
        }
    }
    if let Some(terms) = j.get("terms").and_then(|t| t.as_object()) {
        for name in SYSTEM_TERMS {
            if let Some(arr) = terms.get(name).and_then(|a| a.as_array()) {
                for (i, v) in arr.iter().enumerate() {
                    add(format!("terms.{name}[{i}]"), Some(v), &format!("terms.{name}"));
                }
            }
        }
        if let Some(m) = terms.get("messages").and_then(|m| m.as_object()) {
            for (k, v) in m {
                add(format!("terms.messages.{k}"), Some(v), "terms.messages");
            }
        }
    }
    out
}

static LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z][A-Z0-9_ ]{2,30}$").unwrap());
static PLUGIN_CMD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)^(\S+)(\s+(?:[0-9]+\s+)*)?(.*)$").unwrap());

/// Команда плагіна — `Name arg arg text…`. Початкові числові аргументи (`choice_text 2 Hello`) лишаються як є; решта — текст для гравця.
pub fn split_plugin_command(cmd: &str) -> (String, String, String) {
    match PLUGIN_CMD.captures(cmd) {
        Some(m) => {
            let name = m[1].to_string();
            let prefix = format!("{name}{}", m.get(2).map_or(" ", |g| g.as_str()));
            (name, prefix, m.get(3).map_or("", |g| g.as_str()).to_string())
        }
        None => (String::new(), String::new(), String::new()),
    }
}

fn code_of(c: &Value) -> Option<i64> {
    c.get("code").and_then(|x| x.as_f64()).map(|f| f as i64)
}
fn param(c: &Value, i: usize) -> Option<&Value> {
    c.get("parameters").and_then(|p| p.as_array()).and_then(|p| p.get(i))
}

fn extract_list(list: &[Value], base: &str, context: &str, ev_name: &str, opts: &ExtractOptions) -> Vec<Unit> {
    let mut out = Vec::new();
    let plugins: HashSet<&str> = opts.plugin_commands.iter().map(|s| s.as_str()).collect();
    let mut note = String::new();
    for (i, c) in list.iter().enumerate() {
        if !c.is_object() {
            continue;
        }
        let code = code_of(c);
        if matches!(code, Some(108) | Some(408)) {
            if let Some(t) = str_of(param(c, 0)) {
                let t = crate::js::trim(t);
                if LABEL.is_match(t) {
                    note = t.to_string();
                }
            }
        }
        if code == Some(356) && !plugins.is_empty() {
            if let Some(cmd) = str_of(param(c, 0)) {
                let (name, _, text) = split_plugin_command(cmd);
                if plugins.contains(name.as_str()) && has_text(&text) {
                    let mut u = unit(format!("{base}[{i}].cmd"), text, UnitKind::Message, context.into());
                    if !ev_name.is_empty() {
                        u.event = Some(ev_name.into());
                    }
                    out.push(u);
                }
            }
        }
        if code == Some(101) {
            let (lines, _) = text_run(list, i + 1, 401);
            if !lines.is_empty() {
                let speaker = str_of(param(c, 4)).unwrap_or("").to_string();
                let face = match str_of(param(c, 0)).filter(|s| !s.is_empty()) {
                    Some(f) => format!("{f}#{}", match param(c, 1) { Some(Value::Number(n)) => num_str(n), _ => "0".into() }),
                    None => String::new(),
                };
                let mut u = unit(format!("{base}[{i}]"), lines.join("\n"), UnitKind::Dialogue, context.into());
                u.speaker = speaker;
                if !face.is_empty() {
                    u.face = Some(face);
                }
                if !ev_name.is_empty() {
                    u.event = Some(ev_name.into());
                }
                if !note.is_empty() {
                    u.note = Some(note.clone());
                }
                out.push(u);
            }
        } else if code == Some(105) {
            let (lines, _) = text_run(list, i + 1, 405);
            if !lines.is_empty() {
                out.push(unit(format!("{base}[{i}]"), lines.join("\n"), UnitKind::Scroll, context.into()));
            }
        } else if code == Some(102) {
            if let Some(opts_arr) = param(c, 0).and_then(|p| p.as_array()) {
                for (oi, opt) in opts_arr.iter().enumerate() {
                    if let Some(s) = opt.as_str().filter(|s| !s.is_empty()) {
                        out.push(unit(format!("{base}[{i}].choice[{oi}]"), s.into(), UnitKind::Choice, context.into()));
                    }
                }
            }
        }
    }
    out
}

/// Збирає рядки-продовження (401 / 405), що йдуть за командою-заголовком тексту.
fn text_run(list: &[Value], from: usize, code: i64) -> (Vec<String>, usize) {
    let mut lines = Vec::new();
    let mut i = from;
    while list.get(i).is_some_and(|c| c.is_object() && code_of(c) == Some(code)) {
        lines.push(str_of(param(&list[i], 0)).unwrap_or("").to_string());
        i += 1;
    }
    (lines, i)
}

fn extract_db(json: &Value, fields: &[&str]) -> Vec<Unit> {
    let Some(arr) = json.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for (i, row) in arr.iter().enumerate() {
        let Some(r) = is_obj(row) else { continue };
        let label = match str_of(r.get("name")).filter(|s| !s.is_empty()) {
            Some(n) => n.to_string(),
            None => format!("#{i}"),
        };
        for f in fields {
            if let Some(v) = str_of(r.get(*f)).filter(|s| !s.is_empty()) {
                let mut u = unit(format!("[{i}].{f}"), v.into(), db_kind(f), label.clone());
                if *f == fields[0] {
                    if let Some(note) = str_of(r.get("note")).map(crate::js::trim).filter(|n| !n.is_empty()) {
                        let units: Vec<u16> = note.encode_utf16().take(400).collect();
                        u.db_note = Some(String::from_utf16_lossy(&units));
                    }
                }
                out.push(u);
            }
        }
    }
    out
}

/// Глибока копія файлу з записаним перекладом. Рядки без непорожнього перекладу не чіпаються.
pub fn apply_rpgmaker(file: &GameFile, translations: &Translations) -> Value {
    let mut copy = file.json.clone();
    let get = |key: &str| -> Option<String> { translations.get(key).map(|e| e.target.clone()).filter(|t| !crate::js::trim(t).is_empty()) };
    let n = file.name.as_str();
    if is_map(n) && copy.get("events").is_some_and(|e| e.is_array()) {
        if let Some(dn) = get("displayName") {
            copy["displayName"] = json!(dn);
        }
        if let Some(events) = copy.get_mut("events").and_then(|e| e.as_array_mut()) {
            for (ei, ev) in events.iter_mut().enumerate() {
                let Some(pages) = ev.get_mut("pages").and_then(|p| p.as_array_mut()) else { continue };
                for (pi, page) in pages.iter_mut().enumerate() {
                    if let Some(list) = page.get_mut("list").and_then(|l| l.as_array_mut()) {
                        apply_list(list, &format!("events[{ei}].pages[{pi}].list"), &get);
                    }
                }
            }
        }
    } else if n == "CommonEvents.json" && copy.is_array() {
        for (i, ev) in copy.as_array_mut().unwrap().iter_mut().enumerate() {
            if let Some(list) = ev.get_mut("list").and_then(|l| l.as_array_mut()) {
                apply_list(list, &format!("[{i}].list"), &get);
            }
        }
    } else if n == "Troops.json" && copy.is_array() {
        for (i, t) in copy.as_array_mut().unwrap().iter_mut().enumerate() {
            let Some(pages) = t.get_mut("pages").and_then(|p| p.as_array_mut()) else { continue };
            for (pi, page) in pages.iter_mut().enumerate() {
                if let Some(list) = page.get_mut("list").and_then(|l| l.as_array_mut()) {
                    apply_list(list, &format!("[{i}].pages[{pi}].list"), &get);
                }
            }
        }
    } else if n == "System.json" && copy.is_object() {
        if let Some(t) = get("gameTitle") {
            copy["gameTitle"] = json!(t);
        }
        if let Some(t) = get("currencyUnit") {
            copy["currencyUnit"] = json!(t);
        }
        for name in SYSTEM_ARRAYS {
            if let Some(arr) = copy.get_mut(name).and_then(|a| a.as_array_mut()) {
                for (i, slot) in arr.iter_mut().enumerate() {
                    if let Some(t) = get(&format!("{name}[{i}]")) {
                        *slot = json!(t);
                    }
                }
            }
        }
        if let Some(terms) = copy.get_mut("terms").and_then(|t| t.as_object_mut()) {
            for name in SYSTEM_TERMS {
                if let Some(arr) = terms.get_mut(name).and_then(|a| a.as_array_mut()) {
                    for (i, slot) in arr.iter_mut().enumerate() {
                        if let Some(t) = get(&format!("terms.{name}[{i}]")) {
                            *slot = json!(t);
                        }
                    }
                }
            }
            if let Some(msg) = terms.get_mut("messages").and_then(|m| m.as_object_mut()) {
                let keys: Vec<String> = msg.keys().cloned().collect();
                for k in keys {
                    if let Some(t) = get(&format!("terms.messages.{k}")) {
                        msg.insert(k, json!(t));
                    }
                }
            }
        }
    } else if let Some(fields) = db_fields(n).filter(|_| copy.is_array()) {
        for (i, row) in copy.as_array_mut().unwrap().iter_mut().enumerate() {
            let Some(r) = row.as_object_mut() else { continue };
            for f in fields {
                if let Some(t) = get(&format!("[{i}].{f}")) {
                    if r.get(*f).is_some_and(|v| v.is_string()) {
                        r.insert((*f).to_string(), json!(t));
                    }
                }
            }
        }
    }
    copy
}

fn apply_list(list: &mut Vec<Value>, base: &str, get: &dyn Fn(&str) -> Option<String>) {
    // задом наперед, щоб вставка рядків-продовжень не зсувала індекси, які ще не відвідано
    for i in (0..list.len()).rev() {
        if !list[i].is_object() {
            continue;
        }
        let code = code_of(&list[i]);
        if matches!(code, Some(101) | Some(105)) {
            let Some(t) = get(&format!("{base}[{i}]")) else { continue };
            let cont = if code == Some(101) { 401 } else { 405 };
            let (_, end) = text_run(list, i + 1, cont);
            let indent = list[i].get("indent").cloned();
            let lines: Vec<Value> = t
                .split('\n')
                .map(|line| {
                    let mut o = Map::new();
                    o.insert("code".into(), json!(cont));
                    if let Some(ind) = &indent {
                        o.insert("indent".into(), ind.clone());
                    }
                    o.insert("parameters".into(), json!([line]));
                    Value::Object(o)
                })
                .collect();
            list.splice(i + 1..end, lines);
        } else if code == Some(356) {
            if let Some(cmd) = str_of(param(&list[i], 0)).map(String::from) {
                if let Some(t) = get(&format!("{base}[{i}].cmd")) {
                    static WS_NL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\n\s*").unwrap());
                    let joined = format!("{}{}", split_plugin_command(&cmd).1, WS_NL.replace_all(&t, " "));
                    if let Some(p) = list[i].get_mut("parameters").and_then(|p| p.as_array_mut()) {
                        p[0] = json!(joined);
                    }
                }
            }
        } else if code == Some(102) {
            if let Some(opts) = list[i].get_mut("parameters").and_then(|p| p.as_array_mut()).and_then(|p| p.get_mut(0)).and_then(|o| o.as_array_mut()) {
                for (oi, slot) in opts.iter_mut().enumerate() {
                    if let Some(t) = get(&format!("{base}[{i}].choice[{oi}]")) {
                        *slot = json!(t);
                    }
                }
            }
        }
    }
}
