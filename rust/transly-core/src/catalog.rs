//! `ext/catalog.ts`: каталог — список плагінів, які хтось рекомендує: JSON-файл (`transly-catalog.json`) на будь-якому сервері чи в
//! репозиторії GitHub. Він лише *описує* плагіни й каже, де кожен; установлення йде тими самими кроками, що й для будь-якого іншого
//! (спершу показується, що він додає й про що просить, нічого не пишеться без згоди, кожен файл звіряється з контрольною сумою).
//! Каталог — недовірений текст: кожен запис перевіряється, поганий пропускається, і ніщо з нього ніколи не виконується.
//! Мережеве завантаження каталогу робить платформа.

use crate::collate::locale_compare;
use crate::js;
use crate::manifest::{is_https, js_string, APP_VERSION};
use crate::registry::{match_detect, PluginRegistry};
use crate::semver::{compare_versions, parse_version, satisfies, valid_range};
use crate::sources::{allowed_url, parse_github_ref};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub const CATALOG_FILE: &str = "transly-catalog.json";
pub const CATALOG_VERSION: i64 = 1;
const ENTRIES: usize = 500;
const BYTES: usize = 1_000_000;
const NAME_MAX: usize = 80;
const TEXT_MAX: usize = 600;

pub const CATALOG_TAGS: [&str; 7] = ["language", "engine", "format", "qa", "commands", "glossary", "help"];

/// Де плагін каталогу: репозиторій GitHub, адреса чи сам застосунок (приклади, що він несе).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CatalogSource {
    Github { r#ref: String },
    Url { url: String },
    Bundled { key: String },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detect: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires: Option<Value>,
    pub source: CatalogSource,
    /// Назва каталогу, з якого запис (заповнюється, коли каталоги збираються разом).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CatalogIndex {
    pub name: String,
    pub entries: Vec<CatalogEntry>,
    pub warnings: Vec<String>,
}

static ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$").unwrap());
static LANG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$").unwrap());

fn str_ok(v: Option<&Value>, max: usize) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| !js::trim(s).is_empty() && js::len16(s) <= max)
}

/// `globs`: None — нема поля (`undefined`), Err — недійсне (`null`), Ok(Some) — список.
fn globs(v: Option<&Value>) -> Result<Option<Vec<Value>>, ()> {
    match v {
        None => Ok(None),
        Some(Value::Array(a)) if a.len() <= 16 && a.iter().all(|g| str_ok(Some(g), 120)) => Ok(Some(a.clone())),
        _ => Err(()),
    }
}

fn truthy_str(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)
}

fn entry(raw: &Value, i: usize, warn: &mut Vec<String>) -> Option<CatalogEntry> {
    let mut w = |s: &str| -> Option<CatalogEntry> {
        warn.push(format!("plugins[{i}]: {s}"));
        None
    };
    let Some(o) = raw.as_object() else { return w("має бути об’єктом") };
    let id = o.get("id").and_then(Value::as_str).filter(|id| ID.is_match(id) && js::len16(id) <= 64);
    let Some(id) = id else { return w("«id» — на кшталт автор.назва") };
    if !str_ok(o.get("name"), NAME_MAX) {
        return w("«name» — непорожній рядок");
    }
    let has_repo = o.contains_key("repo");
    let has_url = o.contains_key("url");
    let source = if has_repo == has_url {
        None
    } else if has_repo {
        o["repo"].as_str().filter(|r| parse_github_ref(r).is_some()).map(|r| CatalogSource::Github { r#ref: js::trim(r).to_string() })
    } else {
        o.get("url").filter(|u| is_https(Some(u)) && u.as_str().is_some_and(|s| allowed_url(s).is_some())).and_then(Value::as_str).map(|u| CatalogSource::Url { url: u.to_string() })
    };
    let Some(source) = source else { return w("потрібне одне з «repo» (автор/репозиторій) або «url» (https)") };
    if o.contains_key("description") && !str_ok(o.get("description"), TEXT_MAX) {
        return w("«description» — текст");
    }
    if o.contains_key("author") && !str_ok(o.get("author"), 80) {
        return w("«author» — текст");
    }
    if let Some(v) = o.get("version") {
        if !v.as_str().is_some_and(|s| parse_version(s).is_some()) {
            return w("«version» — версія на кшталт 1.2.0");
        }
    }
    if o.contains_key("homepage") && !is_https(o.get("homepage")) {
        return w("«homepage» — адреса https");
    }
    let tags: Option<Vec<String>> = match o.get("tags") {
        None => Some(vec![]),
        Some(Value::Array(a)) if a.len() <= 8 && a.iter().all(|x| x.as_str().is_some_and(|s| CATALOG_TAGS.contains(&s))) => Some(a.iter().map(|x| x.as_str().unwrap().to_string()).collect()),
        _ => None,
    };
    let Some(tags) = tags else { return w(&format!("«tags» — {}", CATALOG_TAGS.join(", "))) };
    if let Some(l) = o.get("languages") {
        if !l.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|c| c.as_str().is_some_and(|c| LANG.is_match(c)))) {
            return w("«languages» — коди мов");
        }
    }
    let mut detect: Option<Value> = None;
    if let Some(d) = o.get("detect") {
        let mut bad = || w("«detect» — files, anyFiles, excludeFiles (до 16 шаблонів) і min");
        let Some(dobj) = d.as_object() else { return bad() };
        let (Ok(files), Ok(any), Ok(excl)) = (globs(dobj.get("files")), globs(dobj.get("anyFiles")), globs(dobj.get("excludeFiles"))) else { return bad() };
        if let Some(min) = dobj.get("min") {
            let ok = min.as_f64().is_some_and(|m| m.fract() == 0.0 && (1.0..=16.0).contains(&m));
            if !ok {
                return bad();
            }
        }
        let mut m = Map::new();
        if let Some(f) = files {
            m.insert("files".into(), Value::Array(f));
        }
        if let Some(f) = any {
            m.insert("anyFiles".into(), Value::Array(f));
        }
        if let Some(f) = excl {
            m.insert("excludeFiles".into(), Value::Array(f));
        }
        if let Some(min) = dobj.get("min") {
            m.insert("min".into(), min.clone());
        }
        detect = Some(Value::Object(m));
    }
    let mut requires: Option<Value> = None;
    if let Some(r) = o.get("requires") {
        let Some(ro) = r.as_object() else { return w("«requires.transly» — діапазон версій") };
        if let Some(t) = ro.get("transly") {
            if !t.as_str().is_some_and(valid_range) {
                return w("«requires.transly» — діапазон версій");
            }
            requires = Some(json!({ "transly": t }));
        } else {
            requires = Some(json!({}));
        }
    }
    Some(CatalogEntry {
        id: id.to_string(),
        name: js::trim(o["name"].as_str().unwrap()).to_string(),
        description: truthy_str(o.get("description")),
        version: truthy_str(o.get("version")),
        author: truthy_str(o.get("author")),
        homepage: truthy_str(o.get("homepage")),
        tags,
        languages: o.get("languages").and_then(Value::as_array).map(|a| a.iter().filter_map(|c| c.as_str().map(String::from)).collect()),
        detect,
        requires,
        source,
        origin: None,
    })
}

/// Читає й перевіряє каталог. Новіший формат відхиляється, поганий запис пропускається (з попередженням), решта лишається.
pub fn check_catalog(input: &Value, fallback_name: &str) -> Result<CatalogIndex, Vec<String>> {
    let parsed;
    let j: &Value = match input {
        Value::String(text) => {
            if js::len16(text) > BYTES {
                return Err(vec!["Каталог завеликий".into()]);
            }
            match serde_json::from_str::<Value>(text) {
                Ok(v) => {
                    parsed = v;
                    &parsed
                }
                Err(e) => return Err(vec![format!("Каталог — не JSON: {e}")]),
            }
        }
        other => other,
    };
    let Some(o) = j.as_object() else { return Err(vec!["Каталог має бути об’єктом".into()]) };
    if o.get("catalogVersion").and_then(Value::as_f64) != Some(CATALOG_VERSION as f64) {
        return Err(vec![format!("Цей каталог має формат {}, а застосунок знає лише {CATALOG_VERSION}", js_string(o.get("catalogVersion")))]);
    }
    let Some(plugins) = o.get("plugins").and_then(Value::as_array) else { return Err(vec!["«plugins» має бути списком".into()]) };
    let mut warnings: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut entries: Vec<CatalogEntry> = Vec::new();
    if plugins.len() > ENTRIES {
        warnings.push(format!("У каталозі більше {ENTRIES} розширень: решту пропущено"));
    }
    for (i, raw) in plugins.iter().take(ENTRIES).enumerate() {
        let Some(e) = entry(raw, i, &mut warnings) else { continue };
        if seen.contains(&e.id) {
            warnings.push(format!("plugins[{i}]: «{}» уже є вище", e.id));
            continue;
        }
        seen.insert(e.id.clone());
        entries.push(e);
    }
    let name = match o.get("name").and_then(Value::as_str).map(js::trim) {
        Some(n) if !n.is_empty() => js::slice16(n, NAME_MAX),
        _ => fallback_name.to_string(),
    };
    Ok(CatalogIndex { name, entries, warnings })
}

/// Запис для плагіна, що під рукою (опис каже все, що каже запис, тож запис з нього не може відрізнятися від того, що встановлюється).
pub fn entry_of_manifest(m: &Value, source: CatalogSource) -> CatalogEntry {
    let list = |k: &str| m.get("contributes").and_then(|c| c.get(k)).and_then(Value::as_array).cloned().unwrap_or_default();
    let tags: Vec<String> = [("languages", "language"), ("engines", "engine"), ("formats", "format"), ("qaRules", "qa"), ("commands", "commands"), ("glossaries", "glossary"), ("help", "help")]
        .iter()
        .filter(|(k, _)| !list(k).is_empty())
        .map(|(_, t)| t.to_string())
        .collect();
    let detect = list("engines").into_iter().find_map(|e| e.get("detect").filter(|d| !d.is_null()).cloned());
    let author = match m.get("author") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(a) => a.get("name").and_then(Value::as_str).map(String::from),
        None => None,
    }
    .filter(|a| !a.is_empty());
    let langs = list("languages");
    CatalogEntry {
        id: m.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
        name: m.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
        description: truthy_str(m.get("description")),
        version: m.get("version").and_then(Value::as_str).map(String::from),
        author,
        homepage: truthy_str(m.get("homepage")),
        tags,
        languages: (!langs.is_empty()).then(|| langs.iter().filter_map(|l| l.get("code").and_then(Value::as_str).map(String::from)).collect()),
        detect,
        requires: truthy_str(m.get("requires").and_then(|r| r.get("transly"))).map(|t| json!({ "transly": t })),
        source,
        origin: None,
    }
}

/// Каталог, який додав користувач: репозиторій GitHub (файл `transly-catalog.json` у ньому) чи адреса файла.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CatalogRef {
    pub id: String,
    pub kind: String,
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

static HTTPS_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https://").unwrap());
static GITHUB_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https://github\.com/").unwrap());

/// Що набрав користувач: `owner/repo[@ref][#folder]`, адреса GitHub чи адреса https файла каталогу. None, коли ні те, ні те.
pub fn parse_catalog_ref(input: &str) -> Option<CatalogRef> {
    let s = js::trim(input);
    if HTTPS_START.is_match(s) && !GITHUB_START.is_match(s) {
        return allowed_url(s).map(|u| CatalogRef { id: format!("url:{}", u.as_str()), kind: "url".into(), location: u.as_str().to_string(), name: None });
    }
    parse_github_ref(s).map(|_| CatalogRef { id: format!("github:{s}"), kind: "github".into(), location: s.to_string(), name: None })
}

/// Адреса, з якої читається файл каталогу.
pub fn catalog_address(r: &CatalogRef) -> Option<String> {
    if r.kind == "url" {
        return allowed_url(&r.location).map(|u| u.as_str().to_string());
    }
    let g = parse_github_ref(&r.location)?;
    let dir = g.dir.as_deref().filter(|d| !d.is_empty()).map_or(String::new(), |d| format!("{}/", d.trim_end_matches('/')));
    let enc = dir.split('/').map(crate::dictlinks::encode_uri_component).collect::<Vec<_>>().join("/").replace("%2F", "/");
    Some(format!("https://raw.githubusercontent.com/{}/{}/{}/{}{CATALOG_FILE}", g.owner, g.repo, g.r#ref.as_deref().unwrap_or("HEAD"), enc))
}

/// Зібрані каталоги: плагін, що є в кількох, подається раз (найновіша версія, на рівних — раніший каталог). Кожен запис знає свій каталог.
pub fn merge_catalogs(indexes: &[CatalogIndex]) -> Vec<CatalogEntry> {
    let mut by: indexmap::IndexMap<String, CatalogEntry> = indexmap::IndexMap::new();
    for idx in indexes {
        for e in &idx.entries {
            let replace = match by.get(&e.id) {
                None => true,
                Some(have) => match (&e.version, &have.version) {
                    (Some(a), Some(b)) => compare_versions(a, b) > 0,
                    (Some(_), None) => true,
                    _ => false,
                },
            };
            if replace {
                by.insert(e.id.clone(), CatalogEntry { origin: Some(idx.name.clone()), ..e.clone() });
            }
        }
    }
    by.into_values().collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogStatus {
    Available,
    Installed,
    Update,
    Incompatible,
}
impl CatalogStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CatalogStatus::Available => "available",
            CatalogStatus::Installed => "installed",
            CatalogStatus::Update => "update",
            CatalogStatus::Incompatible => "incompatible",
        }
    }
}

/// Де запис стоїть для цього застосунку: не встановлений, встановлений (і чи є в каталозі новіша версія) чи не для цієї версії Transly.
pub fn catalog_status(e: &CatalogEntry, reg: &PluginRegistry, app: Option<&str>) -> (CatalogStatus, Option<String>, Option<String>) {
    if let Some(have) = reg.get(&e.id) {
        let hv = have.manifest.get("version").and_then(Value::as_str).unwrap_or("");
        let newer = e.version.as_deref().is_some_and(|v| compare_versions(v, hv) > 0);
        return (if newer { CatalogStatus::Update } else { CatalogStatus::Installed }, Some(hv.to_string()), None);
    }
    if let Some(range) = e.requires.as_ref().and_then(|r| r.get("transly")).and_then(Value::as_str).filter(|r| !r.is_empty()) {
        if !satisfies(app.unwrap_or(APP_VERSION), range) {
            return (CatalogStatus::Incompatible, None, Some(format!("Потрібен Transly {range}")));
        }
    }
    (CatalogStatus::Available, None, None)
}

pub struct Suggestion {
    pub entry: CatalogEntry,
    pub score: f64,
    pub matched: Vec<String>,
}

/// Записи, чий `detect` пасує до файлів теки, найкращі першими, для теки, якої застосунок не розуміє. Уже встановлені не пропонуються знову.
pub fn suggest_from_catalog(entries: &[CatalogEntry], paths: &[String], reg: &PluginRegistry, app: Option<&str>) -> Vec<Suggestion> {
    let mut out: Vec<Suggestion> = Vec::new();
    for e in entries {
        let Some(d) = e.detect.as_ref() else { continue };
        if reg.get(&e.id).is_some() || catalog_status(e, reg, app).0 == CatalogStatus::Incompatible {
            continue;
        }
        if let Some((score, matched)) = match_detect(d, paths) {
            out.push(Suggestion { entry: e.clone(), score, matched });
        }
    }
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then_with(|| locale_compare(&a.entry.name, &b.entry.name)));
    out
}

/// Записи, відфільтровані за міткою й словами (назва, id, опис, автор, мови).
pub fn filter_catalog(entries: &[CatalogEntry], tag: Option<&str>, q: &str) -> Vec<CatalogEntry> {
    let words: Vec<String> = q.to_lowercase().split(js::is_space).filter(|w| !w.is_empty()).map(String::from).collect();
    entries
        .iter()
        .filter(|e| {
            let hay = format!("{} {} {} {} {}", e.name, e.id, e.description.as_deref().unwrap_or(""), e.author.as_deref().unwrap_or(""), e.languages.as_deref().unwrap_or(&[]).join(" ")).to_lowercase();
            tag.is_none_or(|t| e.tags.iter().any(|x| x == t)) && words.iter().all(|w| hay.contains(w.as_str()))
        })
        .cloned()
        .collect()
}
