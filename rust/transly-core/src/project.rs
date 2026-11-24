//! `project.ts`: формат збереженого проєкту (`project.json`, НЕ змінюється), розбір із перевіркою й ремонтом, злиття двох копій.
//!
//! Поля, які лише проходять крізь проєкт або порівнюються за `JSON.stringify` (терміни, пам'ять, мовці, знімок, довідка,
//! групи, зв'язки, `base` гілок), зберігаються як `serde_json::Value` із порядком ключів файлу — так і порядок, і невідомі
//! поля вціліють. Невідомі поля верхнього рівня (від новішої версії) лежать у `extra` і проходять без змін.
//!
//! Не перенесено: `readGame` (читання файлів гри) — з модулем форматів; тип `sourceLang` чи `targetLang` не рядок —
//! тут береться типове значення (у TS хибний тип проходив далі).

use crate::branches::{branch_of, checkout_branch, merge_branch_data};
use crate::groups::merge_group_data;
use crate::js;
use crate::links::merge_link_data;
use crate::merge::{merge, OTHER_DEVICE, RESET_WHAT};
use crate::model::{Entry, HistoryItem, Status, Translations, Unit};
use crate::progress::progress_of;
use crate::validate::{clamp_clock, repair_project};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;

/// Версія розкладки, яку пише ця збірка.
pub const SCHEMA: i64 = 2;

/// Одна гілка перекладу (див. `branches`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Branch {
    /// Гілка, з якої зроблено цю.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Коли зроблено.
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    /// Рядки, якими вони були на момент створення гілки чи як їх залагодили злиття: спільна основа порівняння.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<Value>,
    /// Рядки гілки, поки вона не поточна (рядки поточної — це `SavedProject.files`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<IndexMap<String, Translations>>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Збережений вигляд проєкту: дані перекладача. Файли гри тут ніколи не зберігаються.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedProject {
    pub version: i64,
    pub name: String,
    #[serde(rename = "sourceLang")]
    pub source_lang: String,
    #[serde(rename = "targetLang")]
    pub target_lang: String,
    /// Збільшується «скиданням»: записи старіші за це відкидаються при злитті, щоб скидання справді поширилось.
    #[serde(rename = "resetEpoch", deserialize_with = "crate::js::lenient_i64")]
    pub reset_epoch: i64,
    /// Переклади по іменах файлів гри.
    pub files: IndexMap<String, Translations>,
    /// Імпортовані пари пам'яті перекладів `{s, t, mt}`.
    pub memory: Vec<Value>,
    /// Глосарій проєкту.
    pub terms: Vec<Value>,
    pub settings: Map<String, Value>,
    #[serde(default, rename = "settingsAt", deserialize_with = "crate::js::lenient_opt_i64", skip_serializing_if = "Option::is_none")]
    pub settings_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Value>,
    #[serde(default, rename = "sysNames", skip_serializing_if = "Option::is_none")]
    pub sys_names: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speakers: Option<Map<String, Value>>,
    #[serde(default, rename = "assetsRev", deserialize_with = "crate::js::lenient_opt_i64", skip_serializing_if = "Option::is_none")]
    pub assets_rev: Option<i64>,
    /// Версія розкладки даних, яку розуміє застосунок, що записав (нема = 1).
    #[serde(default, deserialize_with = "crate::js::lenient_opt_i64", skip_serializing_if = "Option::is_none")]
    pub schema: Option<i64>,
    /// Видалені терміни: ключ — оригінал малими літерами, значення — коли.
    #[serde(default, rename = "deletedTerms", skip_serializing_if = "Option::is_none")]
    pub deleted_terms: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Map<String, Value>>,
    /// Гілка, чиї рядки лежать у `files`; нема = «main».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branches: Option<IndexMap<String, Branch>>,
    #[serde(default, rename = "goneBranches", skip_serializing_if = "Option::is_none")]
    pub gone_branches: Option<IndexMap<String, i64>>,
    /// Невідомі поля верхнього рівня (від новішої версії) проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Типові налаштування проєкту, у цьому порядку ключів.
pub fn default_settings() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("tolerancePct".into(), json!(25));
    m.insert("blockErrors".into(), json!(true));
    m.insert("who".into(), json!("Ви"));
    m.insert("propagate".into(), json!(true));
    m.insert("pluginCommands".into(), json!([]));
    m.insert("pluginsAsked".into(), json!(false));
    m.insert("lineLimit".into(), json!(0));
    m
}

pub fn empty_project(name: &str, source_lang: &str, target_lang: &str) -> SavedProject {
    SavedProject {
        version: 1,
        schema: Some(SCHEMA),
        name: name.into(),
        source_lang: source_lang.into(),
        target_lang: target_lang.into(),
        reset_epoch: 0,
        files: IndexMap::new(),
        memory: vec![],
        terms: vec![],
        settings: default_settings(),
        settings_at: None,
        snapshot: None,
        reference: None,
        labels: None,
        sys_names: None,
        speakers: None,
        assets_rev: None,
        deleted_terms: None,
        groups: None,
        members: None,
        links: None,
        branch: None,
        branches: None,
        gone_branches: None,
        extra: Map::new(),
    }
}

/// Файл гри з його рядками.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct FileView {
    pub name: String,
    pub units: Vec<Unit>,
    /// Місце, де відбувається файл (назва мапи).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileStats {
    pub total: usize,
    pub translated: usize,
    pub done: usize,
    pub approved: usize,
}

/// Лічильники рядків файлу (`done` = надіслані й ще не вичитані). Визначення — у `progress`.
pub fn stats_of(units: &[Unit], entries: &Translations) -> FileStats {
    let p = progress_of(units, entries);
    FileStats { total: p.total, translated: p.translated, done: p.sent, approved: p.approved }
}

/// Вигляди зі збереженого знімка, щоб проєкт відкривався без теки гри.
pub fn views_from_snapshot(p: &SavedProject) -> Vec<FileView> {
    let Some(Value::Object(snap)) = &p.snapshot else { return Vec::new() };
    let labels = p.labels.as_ref().and_then(|l| l.as_object());
    snap.iter()
        .filter_map(|(name, units)| {
            let units: Vec<Unit> = serde_json::from_value(units.clone()).ok()?;
            let label = labels.and_then(|l| l.get(name)).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(String::from);
            Some(FileView { name: name.clone(), units, label })
        })
        .filter(|v| !v.units.is_empty())
        .collect()
}

pub fn snapshot_of(views: &[FileView]) -> Value {
    Value::Object(views.iter().map(|v| (v.name.clone(), serde_json::to_value(&v.units).unwrap())).collect())
}

pub fn serialize(p: &SavedProject) -> String {
    serde_json::to_string(p).expect("серіалізація проєкту")
}

/// Чи цей текст — файл проєкту (а не JSON гри)? Початку досить для файлів цього застосунку; решта — запасний шлях, що не залежить від порядку ключів.
pub fn looks_like_project(text: &str) -> bool {
    let units: Vec<u16> = text.encode_utf16().take(4000).collect();
    let head64 = String::from_utf16_lossy(&units[..units.len().min(64)]);
    if !head64.trim_start_matches(js::is_space).starts_with('{') {
        return false;
    }
    let head = String::from_utf16_lossy(&units);
    let ver = regex::Regex::new(r#""version"\s*:\s*1(?-u:\b)"#).unwrap();
    let lang = regex::Regex::new(r#""sourceLang"\s*:"#).unwrap();
    if ver.is_match(&head) && lang.is_match(&head) {
        return true;
    }
    text.contains("\"sourceLang\"") && text.contains("\"targetLang\"") && text.contains("\"resetEpoch\"") && text.contains("\"files\"")
}

/// Проєкт, прочитаний з тексту, і що в ньому довелося лагодити (порожньо, коли все було гаразд).
#[derive(Clone, Debug, PartialEq)]
pub struct Deserialized {
    pub project: SavedProject,
    pub notes: Vec<String>,
}

fn js_string_of(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => format!("{}", n.as_f64().unwrap_or(0.0)),
        },
        Some(Value::Array(_)) => "[object Array]".into(),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

const KNOWN: [&str; 24] = ["version", "name", "sourceLang", "targetLang", "resetEpoch", "files", "memory", "terms", "settings", "settingsAt", "snapshot", "reference", "labels", "sysNames", "speakers", "assetsRev", "schema", "deletedTerms", "groups", "members", "links", "branch", "branches", "goneBranches"];

/// Розбирає, перевіряє й лагодить; кидає зрозумілу помилку для непридатного вводу замість завантаження сміття. Хибні типи
/// всередині виправляються чи відкидаються (`repair_project`). З `now` часові мітки з майбутнього повертаються до нього.
pub fn deserialize_checked(text: &str, now: Option<i64>) -> Result<Deserialized, String> {
    let raw: Value = serde_json::from_str(text).map_err(|_| "Файл проєкту пошкоджено: це не JSON".to_string())?;
    let Value::Object(mut o) = raw else { return Err("Файл проєкту пошкоджено".into()) };
    if o.get("version").and_then(|v| v.as_f64()) != Some(1.0) {
        return Err(format!("Непідтримувана версія проєкту: {}", js_string_of(o.get("version"))));
    }
    if !o.get("name").is_some_and(|n| n.is_string()) || !o.get("files").is_some_and(|f| f.is_object()) {
        return Err("Файл проєкту пошкоджено".into());
    }
    let mut notes = repair_project(&mut o);
    if let Some(now) = now {
        let n = clamp_clock(&mut o, now, crate::validate::MAX_AHEAD_MS);
        if n > 0 {
            notes.push(format!("часових міток із майбутнього (годинник пристрою поспішає): {n}"));
        }
    }
    let get = |k: &str| o.get(k);
    let mut out: Map<String, Value> = Map::new();
    for (k, v) in &o {
        if !KNOWN.contains(&k.as_str()) {
            out.insert(k.clone(), v.clone());
        }
    }
    out.insert("version".into(), json!(1));
    out.insert("name".into(), get("name").cloned().unwrap());
    let lang = |k: &str, d: &str| match get(k) {
        Some(Value::String(s)) => json!(s),
        _ => json!(d),
    };
    out.insert("sourceLang".into(), lang("sourceLang", "en"));
    out.insert("targetLang".into(), lang("targetLang", "uk"));
    out.insert("resetEpoch".into(), get("resetEpoch").filter(|v| !v.is_null()).cloned().unwrap_or(json!(0)));
    out.insert("files".into(), get("files").cloned().unwrap());
    out.insert("memory".into(), get("memory").filter(|v| !v.is_null()).cloned().unwrap_or(json!([])));
    out.insert("terms".into(), get("terms").filter(|v| !v.is_null()).cloned().unwrap_or(json!([])));
    let mut settings = default_settings();
    if let Some(Value::Object(s)) = get("settings") {
        for (k, v) in s {
            settings.insert(k.clone(), v.clone());
        }
    }
    out.insert("settings".into(), Value::Object(settings));
    for k in ["snapshot", "reference", "assetsRev", "speakers", "labels", "sysNames", "settingsAt", "schema", "deletedTerms", "groups", "members", "links", "branches", "goneBranches"] {
        if truthy(get(k)) {
            out.insert(k.into(), get(k).cloned().unwrap());
        }
    }
    if let Some(Value::String(b)) = get("branch") {
        if !b.is_empty() {
            out.insert("branch".into(), json!(b));
        }
    }
    let project: SavedProject = serde_json::from_value(Value::Object(out)).map_err(|_| "Файл проєкту пошкоджено".to_string())?;
    Ok(Deserialized { project, notes })
}

/// `deserialize_checked` без приміток.
pub fn deserialize(text: &str, now: Option<i64>) -> Result<SavedProject, String> {
    deserialize_checked(text, now).map(|d| d.project)
}

/// Що рядок лишає після скидання на `epoch`: нічого, коли він старший, а інакше лише новіші коментарі й історію.
fn live_entry(e: &Entry, epoch: i64) -> Option<Entry> {
    if epoch <= 0 {
        return Some(e.clone());
    }
    let new_comments = e.comments.as_ref().is_some_and(|c| c.iter().any(|c| c.at > epoch));
    if e.mt <= epoch && !new_comments {
        return None;
    }
    let mut out = e.clone();
    if let Some(v) = &e.votes {
        let kept: Vec<_> = v.iter().filter(|x| x.at > epoch).cloned().collect();
        if kept.len() != v.len() {
            out.votes = if kept.is_empty() { None } else { Some(kept) };
        }
    }
    if let Some(d) = &e.drops {
        let kept: Vec<_> = d.iter().filter(|x| x.at > epoch).cloned().collect();
        if kept.len() != d.len() {
            out.drops = if kept.is_empty() { None } else { Some(kept) };
        }
    }
    if let Some(c) = &e.comments {
        let kept: Vec<_> = c.iter().filter(|x| x.at > epoch).cloned().collect();
        if kept.len() != c.len() {
            out.comments = if kept.is_empty() { None } else { Some(kept) };
        }
    }
    if let Some(h) = &e.history {
        let kept: Vec<_> = h.iter().filter(|x| x.at > epoch).cloned().collect();
        if kept.len() != h.len() {
            out.history = if kept.is_empty() { None } else { Some(kept) };
        }
    }
    Some(out)
}

fn mt_of(v: &Value) -> Option<f64> {
    v.get("mt").and_then(|m| m.as_f64())
}

/// Запис, що складається з елементів із числовим `mt`: `Object.values(v).every(e => об'єкт з числовим mt)`; порожній — теж.
fn is_mt_record(v: &Value) -> bool {
    v.as_object().is_some_and(|o| o.values().all(|e| e.as_object().is_some_and(|e| e.get("mt").is_some_and(|m| m.is_number()))))
}

/// Поле верхнього рівня, якого ця збірка не знає (написане новішою). Записи елементів із `mt` зливаються поелементно, новіший
/// перемагає, а старше за останнє скидання відкидається; усе інше лишає локальне значення, тож нічого не губиться.
fn merge_unknown(x: Option<&Value>, y: Option<&Value>, epoch: i64) -> Option<Value> {
    let (Some(xv), Some(yv)) = (x, y) else { return x.or(y).cloned() };
    if is_mt_record(xv) && is_mt_record(yv) {
        let mut out: Map<String, Value> = Map::new();
        for src in [xv, yv] {
            for (k, v) in src.as_object().unwrap() {
                let m = mt_of(v).unwrap();
                if m > epoch as f64 && out.get(k).is_none_or(|o| m > mt_of(o).unwrap()) {
                    out.insert(k.clone(), v.clone());
                }
            }
        }
        return Some(Value::Object(out));
    }
    Some(xv.clone())
}

/// Назви файлів у дереві не мають мітки: коли два пристрої дали файлу різні назви, перемагає більша на обох.
fn merge_labels(a: Option<&Value>, b: Option<&Value>) -> Value {
    let empty = Map::new();
    let (am, bm) = (a.and_then(|v| v.as_object()).unwrap_or(&empty), b.and_then(|v| v.as_object()).unwrap_or(&empty));
    let mut out: Map<String, Value> = Map::new();
    for (k, v) in bm.iter().chain(am.iter()) {
        out.insert(k.clone(), v.clone());
    }
    for (k, av) in am {
        if let (Some(bv), Some(a_s)) = (bm.get(k), av.as_str()) {
            if let Some(b_s) = bv.as_str() {
                if js::cmp(b_s, a_s) == Ordering::Greater {
                    out.insert(k.clone(), bv.clone());
                }
            }
        }
    }
    Value::Object(out)
}

/// Що сказати перекладачеві, коли скидання відкинуло рядки (див. `ProjectMerge::dropped_by_reset`).
pub fn reset_note(n: usize) -> String {
    format!("скидання проєкту очистило рядків: {n} (їх позначено менш ніж за добу до скидання: якщо годинник пристрою, що скидав, спішив, це може бути ваша нова робота). Текст кожного збережено в історії рядка")
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProjectMerge {
    pub project: SavedProject,
    pub conflicts: Vec<(String, String)>,
    /// Другий проєкт записала старіша збірка (без `schema`): даних, які тримає лише новіша, у ньому може не бути.
    pub older_peer: bool,
    /// Рядки з перекладом, які найновіше скидання відкинуло, хоч їх позначено менш ніж за добу до нього.
    pub dropped_by_reset: usize,
}

/// Скільки до скидання відкинутий рядок ще вважається таким, що міг бути зроблений після нього.
const RESET_SKEW_MS: i64 = 24 * 3600 * 1000;

fn stringify(v: &Value) -> String {
    serde_json::to_string(v).unwrap()
}

/// Пізніший із двох значень з `mt`; за рівних міток — більша серіалізована форма, щоб відповідь не залежала від порядку. true — береться `y`.
fn later_is_y(x: &Value, y: &Value) -> bool {
    let (mx, my) = (mt_of(x), mt_of(y));
    if my != mx {
        my.unwrap_or(f64::NAN) > mx.unwrap_or(f64::NAN)
    } else {
        js::cmp(&stringify(y), &stringify(x)) == Ordering::Greater
    }
}

fn type_name(v: Option<&Value>) -> &'static str {
    match v {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Bool(_)) => "boolean",
    }
}

/// Цілковитий порядок на простих даних (об'єкти за відсортованими ключами), лише щоб однаково розв'язувати нічиї, чия б копія не була `a`.
pub fn deep_cmp(x: Option<&Value>, y: Option<&Value>) -> i32 {
    let (tx, ty) = (type_name(x), type_name(y));
    if tx == "undefined" && ty == "undefined" {
        return 0;
    }
    if tx != ty {
        return if tx < ty { -1 } else { 1 };
    }
    let (xv, yv) = (x.unwrap(), y.unwrap());
    match (xv, yv) {
        (Value::Array(p), Value::Array(q)) => {
            for i in 0..p.len().min(q.len()) {
                let c = deep_cmp(Some(&p[i]), Some(&q[i]));
                if c != 0 {
                    return c;
                }
            }
            match p.len().cmp(&q.len()) {
                Ordering::Less => -1,
                Ordering::Greater => 1,
                Ordering::Equal => 0,
            }
        }
        (Value::Object(p), Value::Object(q)) => {
            let mut ks: Vec<&String> = Vec::new();
            for k in p.keys().chain(q.keys()) {
                if !ks.contains(&k) {
                    ks.push(k);
                }
            }
            ks.sort_by(|a, b| js::cmp(a, b));
            for k in ks {
                match (p.get(k), q.get(k)) {
                    (None, _) => return -1,
                    (_, None) => return 1,
                    (a, b) => {
                        let c = deep_cmp(a, b);
                        if c != 0 {
                            return c;
                        }
                    }
                }
            }
            0
        }
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if a == b { 0 } else if a < b { -1 } else { 1 }
        }
        (Value::String(a), Value::String(b)) => match js::cmp(a, b) {
            Ordering::Equal => 0,
            Ordering::Less => -1,
            Ordering::Greater => 1,
        },
        (Value::Bool(a), Value::Bool(b)) => {
            if a == b { 0 } else if !*a { -1 } else { 1 }
        }
        _ => 0,
    }
}

fn ident(p: &SavedProject) -> String {
    format!("{}\u{1}{}\u{1}{}", p.name, p.source_lang, p.target_lang)
}

/// Об'єднання двох списків елементів із `mt` за ключем: пізніший перемагає, потім відкидається все, що не новіше за скидання.
fn union_items(x: &[Value], y: &[Value], id: &dyn Fn(&Value) -> String, epoch: i64) -> Vec<Value> {
    let mut order: Vec<String> = Vec::new();
    let mut m: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    for v in x.iter().chain(y.iter()) {
        let k = id(v);
        match m.get(&k) {
            None => {
                order.push(k.clone());
                m.insert(k, v.clone());
            }
            Some(o) => {
                if later_is_y(o, v) {
                    m.insert(k, v.clone());
                }
            }
        }
    }
    order.into_iter().map(|k| m.remove(&k).unwrap()).filter(|v| mt_of(v).is_some_and(|m| m > epoch as f64)).collect()
}

fn lower_en(v: &Value) -> String {
    v.get("en").and_then(|e| e.as_str()).unwrap_or("").to_lowercase()
}

/// Зливає дві копії одного проєкту (наприклад, ПК і телефон). Записи з-перед найновішого скидання відкидаються.
pub fn merge_projects(a0: &SavedProject, b0: &SavedProject, since: i64) -> ProjectMerge {
    let (mut a, mut b) = (a0.clone(), b0.clone());
    // дві копії стоять на різних гілках: обидві ставляться на ту, на якій стоїть новіша, щоб рядки двох гілок ніколи не змішувалися
    if branch_of(&a) != branch_of(&b) {
        let rank = |p: &SavedProject| format!("{}\u{1}{}\u{1}{}\u{1}{}", p.name, p.source_lang, p.target_lang, branch_of(p));
        let pick = if a.reset_epoch != b.reset_epoch {
            if a.reset_epoch > b.reset_epoch { &a } else { &b }
        } else if js::cmp(&rank(&b), &rank(&a)) == Ordering::Greater {
            &b
        } else {
            &a
        };
        let cur = branch_of(pick);
        a = checkout_branch(&a, &cur);
        b = checkout_branch(&b, &cur);
    }
    let epoch = a.reset_epoch.max(b.reset_epoch);
    let dropped = std::cell::Cell::new(0usize);
    let live = |t: &Translations| -> Translations {
        if epoch <= 0 {
            return t.clone();
        }
        let mut out = Translations::new();
        for (k, e) in t {
            match live_entry(e, epoch) {
                Some(l) => {
                    out.insert(k.clone(), l);
                }
                None if !js::trim(&e.target).is_empty() && epoch - e.mt <= RESET_SKEW_MS => {
                    // відкинуто скиданням, але міг бути зроблений після нього: рядок починається знову, порожній, і тримає текст в історії
                    dropped.set(dropped.get() + 1);
                    out.insert(
                        k.clone(),
                        Entry {
                            target: String::new(),
                            status: Status::New,
                            mt: epoch + 1,
                            history: Some(vec![HistoryItem { at: 0, who: OTHER_DEVICE.into(), what: RESET_WHAT.into(), text: e.target.clone(), batch: None, prev: None, extra: Map::new() }]),
                            ..Entry::blank()
                        },
                    );
                }
                None => {}
            }
        }
        out
    };
    let mut files: IndexMap<String, Translations> = IndexMap::new();
    let mut conflicts: Vec<(String, String)> = Vec::new();
    let empty = Translations::new();
    let mut names: Vec<&String> = Vec::new();
    for n in a.files.keys().chain(b.files.keys()) {
        if !names.contains(&n) {
            names.push(n);
        }
    }
    for name in names {
        let r = merge(&live(a.files.get(name).unwrap_or(&empty)), &live(b.files.get(name).unwrap_or(&empty)), since);
        files.insert(name.clone(), r.merged);
        for key in r.conflicts {
            conflicts.push((name.clone(), key));
        }
    }
    let newer: &SavedProject = if a.reset_epoch != b.reset_epoch {
        if a.reset_epoch > b.reset_epoch { &a } else { &b }
    } else if js::cmp(&ident(&b), &ident(&a)) == Ordering::Greater {
        &b
    } else {
        &a
    };
    let (a_sa, b_sa) = (a.settings_at.unwrap_or(0), b.settings_at.unwrap_or(0));
    let settings_from: &SavedProject = if b_sa != a_sa {
        if b_sa > a_sa { &b } else { &a }
    } else if js::cmp(&stringify(&Value::Object(b.settings.clone())), &stringify(&Value::Object(a.settings.clone()))) == Ordering::Greater {
        &b
    } else {
        &a
    };
    let settings_at = a_sa.max(b_sa);
    // Знімок і довідка описують гру, а не роботу перекладача: перемагає сторона з новішою ревізією, а коли лише одна несе їх
    // (полегшена копія із синхронізації), вони лишаються. На тій самій ревізії з різним вмістом перемагає більший вміст.
    let (a_ar, b_ar) = (a.assets_rev.unwrap_or(0), b.assets_rev.unwrap_or(0));
    let has = |p: &SavedProject| truthy(p.snapshot.as_ref()) || truthy(p.reference.as_ref());
    let owner: &SavedProject = if b_ar != a_ar {
        if b_ar > a_ar && has(&b) { &b } else { &a }
    } else {
        let c = if has(&b) && has(&a) {
            let c = deep_cmp(b.snapshot.as_ref(), a.snapshot.as_ref());
            if c != 0 { c } else { deep_cmp(b.reference.as_ref(), a.reference.as_ref()) }
        } else {
            0
        };
        if has(&b) && has(&a) && c > 0 { &b } else { &a }
    };
    let snapshot = owner.snapshot.clone().or_else(|| a.snapshot.clone()).or_else(|| b.snapshot.clone());
    let reference = owner.reference.clone().or_else(|| a.reference.clone()).or_else(|| b.reference.clone());
    let assets_rev = a_ar.max(b_ar);
    let mut speakers: Map<String, Value> = Map::new();
    for src in [a.speakers.as_ref(), b.speakers.as_ref()].into_iter().flatten() {
        for (k, v) in src {
            if mt_of(v).is_some_and(|m| m > epoch as f64) && speakers.get(k).is_none_or(|o| later_is_y(o, v)) {
                speakers.insert(k.clone(), v.clone());
            }
        }
    }
    let mut deleted: Map<String, Value> = Map::new();
    for src in [a.deleted_terms.as_ref(), b.deleted_terms.as_ref()].into_iter().flatten() {
        for (k, t) in src {
            let t = t.as_f64().unwrap_or(f64::NAN);
            if t > epoch as f64 && t > deleted.get(k).and_then(|d| d.as_f64()).unwrap_or(0.0) {
                deleted.insert(k.clone(), json!(t as i64));
            }
        }
    }
    let terms: Vec<Value> = union_items(&a.terms, &b.terms, &lower_en, epoch).into_iter().filter(|t| deleted.get(&lower_en(t)).and_then(|d| d.as_f64()).unwrap_or(0.0) < mt_of(t).unwrap_or(f64::NAN)).collect();
    let mut extra: Map<String, Value> = Map::new();
    let mut keys: Vec<&String> = Vec::new();
    for k in a.extra.keys().chain(b.extra.keys()) {
        if !keys.contains(&k) {
            keys.push(k);
        }
    }
    for k in keys {
        if let Some(v) = merge_unknown(a.extra.get(k), b.extra.get(k), epoch) {
            extra.insert(k.clone(), v);
        }
    }
    let (grp_groups, grp_members) = merge_group_data((a.groups.as_ref(), a.members.as_ref()), (b.groups.as_ref(), b.members.as_ref()), epoch);
    let lnk = merge_link_data(a.links.as_ref(), b.links.as_ref(), epoch);

    let mut project = newer.clone();
    project.extra = extra;
    project.schema = Some(a.schema.unwrap_or(1).max(b.schema.unwrap_or(1)).max(SCHEMA));
    let mut settings = settings_from.settings.clone();
    let asked = |p: &SavedProject| truthy(p.settings.get("pluginsAsked"));
    settings.insert("pluginsAsked".into(), json!(asked(&a) || asked(&b)));
    project.settings = settings;
    if settings_at != 0 {
        project.settings_at = Some(settings_at);
    }
    project.reset_epoch = epoch;
    project.files = files;
    if truthy(snapshot.as_ref()) {
        project.snapshot = snapshot;
    }
    if truthy(reference.as_ref()) {
        project.reference = reference;
    }
    if assets_rev != 0 {
        project.assets_rev = Some(assets_rev);
    }
    if !speakers.is_empty() {
        project.speakers = Some(speakers);
    }
    if truthy(a.sys_names.as_ref()) || truthy(b.sys_names.as_ref()) {
        project.sys_names = match (&a.sys_names, &b.sys_names) {
            (Some(x), Some(y)) => Some(if deep_cmp(Some(y), Some(x)) > 0 { y.clone() } else { x.clone() }),
            (x, y) => x.clone().or_else(|| y.clone()),
        };
    }
    if truthy(a.labels.as_ref()) || truthy(b.labels.as_ref()) {
        project.labels = Some(merge_labels(a.labels.as_ref(), b.labels.as_ref()));
    }
    project.memory = union_items(&a.memory, &b.memory, &|v| format!("{}\u{1}{}", v.get("s").and_then(|s| s.as_str()).unwrap_or(""), v.get("t").and_then(|s| s.as_str()).unwrap_or("")), epoch);
    project.terms = terms;
    project.deleted_terms = if deleted.is_empty() { None } else { Some(deleted) };
    project.groups = grp_groups;
    project.members = grp_members;
    project.links = lnk;
    project.branches = None;
    project.gone_branches = None;
    project.branch = None;
    let (branches, gone) = merge_branch_data(&a, &b, &branch_of(&a), epoch, &live);
    project.branches = branches;
    project.gone_branches = gone;
    if branch_of(&a) != "main" {
        project.branch = Some(branch_of(&a));
    }
    ProjectMerge { project, conflicts, older_peer: b.schema.unwrap_or(1) < SCHEMA, dropped_by_reset: dropped.get() }
}
