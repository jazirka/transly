//! `ext/manifest.ts`: читання й перевірка опису розширення (`transly-plugin.json`). Опис — недовірений текст: тут його розбирають,
//! кожне поле перевіряють за типом, довжиною й формою, а те, що не відоме, лишають поза (попередження, не помилка, щоб
//! розширення, написане для новішої версії формату, все одно вантажилося тим, що ця версія розуміє).
//!
//! Це варіант 1 з рішення про плагіни: розширення без коду. Поля `main`, `permissions`, `network`, `handler` перевіряються, але
//! код не виконується (див. `HANDOFF.md`). Повідомлення про помилки — мовою-джерелом (українською).

use crate::js;
use crate::semver::{parse_version, satisfies, valid_range};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

/// Файл, що називає розширення.
pub const MANIFEST_FILE: &str = "transly-plugin.json";
/// Версія застосунку й версія API розширень, яку він пропонує.
pub const APP_VERSION: &str = "0.1.0";
pub const API_VERSION: &str = "1.0.0";
pub const MANIFEST_VERSION: i64 = 1;

pub const PERMISSIONS: [&str; 3] = ["network", "storage", "notify"];

/// Ліміти, що тримають опис (і те, що застосунок через нього зберігає) малим.
pub struct Limits;
impl Limits {
    pub const FILES: usize = 200;
    pub const FILE_BYTES: usize = 2_000_000;
    pub const TOTAL_BYTES: usize = 8_000_000;
    pub const MANIFEST_BYTES: usize = 200_000;
    pub const FORMATS: usize = 32;
    pub const ENGINES: usize = 16;
    pub const LANGUAGES: usize = 16;
    pub const HELP: usize = 64;
    pub const SETTINGS: usize = 16;
    pub const FIELDS: usize = 64;
    pub const COMMANDS: usize = 32;
    pub const QA_RULES: usize = 32;
    pub const GLOSSARIES: usize = 16;
    pub const STEPS: usize = 50;
    pub const PATTERNS: usize = 50;
    pub const TERMS: usize = 5000;
    pub const PATTERN: usize = 120;
    pub const NAME: usize = 80;
    pub const TEXT: usize = 600;
    pub const ID: usize = 64;
}

#[derive(Clone, Debug, PartialEq)]
pub enum Checked {
    Ok { manifest: Value, warnings: Vec<String> },
    Err { errors: Vec<String> },
}

static ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$").unwrap());
static LOCAL_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9_-]{0,39}$").unwrap());
static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\.[a-z0-9][a-z0-9_-]{0,15}$").unwrap());
static LANG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$").unwrap());
static SHA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^sha256-[0-9a-f]{64}$").unwrap());
static SEGMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\p{L}\p{N}_ .()+-]+$").unwrap());
static DRIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z]:").unwrap());
const KINDS: [&str; 7] = ["dialogue", "choice", "scroll", "name", "description", "message", "term"];

/// Шлях усередині пакета: відносний, з `/`, без `..`, без прихованих частин, без дивних знаків.
pub fn safe_path(p: &Value) -> bool {
    let Some(p) = p.as_str() else { return false };
    if p.is_empty() || js::len16(p) > 160 || p.starts_with('/') || p.contains('\\') || p.contains('\0') || DRIVE.is_match(p) {
        return false;
    }
    p.split('/').all(|s| !s.is_empty() && s != "." && s != ".." && !s.starts_with('.') && SEGMENT.is_match(s))
}

fn is_str(v: Option<&Value>, max: usize) -> bool {
    v.and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty() && js::len16(s) <= max)
}
fn is_str_t(v: Option<&Value>) -> bool {
    is_str(v, Limits::TEXT)
}
fn defined(v: Option<&Value>) -> bool {
    v.is_some()
}
fn obj(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v.and_then(|v| v.as_object())
}
fn is_int(v: Option<&Value>) -> bool {
    v.and_then(|v| v.as_f64()).is_some_and(|f| f.fract() == 0.0)
}

/// Адреса https (без імені й пароля в ній).
pub fn is_https(u: Option<&Value>) -> bool {
    let Some(s) = u.and_then(|v| v.as_str()) else { return false };
    if js::len16(s) > 300 {
        return false;
    }
    url::Url::parse(s).is_ok_and(|x| x.scheme() == "https" && x.username().is_empty() && x.password().is_none())
}

/// `String(v)` у JS.
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => format!("{}", n.as_f64().unwrap_or(0.0)),
        },
        Some(Value::Array(a)) => a.iter().map(|x| if x.is_null() { String::new() } else { js_string(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

#[derive(Default)]
struct Report {
    errors: Vec<String>,
    warnings: Vec<String>,
}
impl Report {
    fn bad(&mut self, wh: &str, what: &str) {
        self.errors.push(format!("{wh}: {what}"));
    }
    fn warn(&mut self, wh: &str, what: &str) {
        self.warnings.push(format!("{wh}: {what}"));
    }
}

fn kind_ok(v: &Value) -> bool {
    v.as_str().is_some_and(|k| KINDS.contains(&k))
}
fn col(v: &Value) -> bool {
    match v {
        Value::String(s) => !s.is_empty() && js::len16(s) <= 80,
        Value::Number(_) => is_int(Some(v)) && v.as_f64().is_some_and(|f| (0.0..1000.0).contains(&f)),
        _ => false,
    }
}

fn spec(r: &mut Report, wh: &str, s: Option<&Value>) {
    let Some(s) = obj(s) else {
        r.bad(wh, "опис формату має бути об’єктом");
        return;
    };
    match s.get("type").and_then(|t| t.as_str()) {
        Some("keyvalue") => {
            if let Some(sep) = s.get("separator") {
                if !sep.as_str().is_some_and(|x| (1..=3).contains(&js::len16(x))) {
                    r.bad(wh, "«separator» — рядок від 1 до 3 знаків");
                }
            }
            if let Some(c) = s.get("comments") {
                if !c.as_array().is_some_and(|a| a.len() <= 8 && a.iter().all(|x| is_str(Some(x), 4))) {
                    r.bad(wh, "«comments» — до 8 коротких рядків");
                }
            }
        }
        Some("table") => {
            let keys: Vec<&Value> = match s.get("key") {
                Some(Value::Array(a)) => a.iter().collect(),
                Some(v) => vec![v],
                None => vec![&Value::Null],
            };
            if keys.is_empty() || keys.len() > 4 || !keys.iter().all(|k| col(k)) {
                r.bad(wh, "«key» — назва або номер стовпця (до чотирьох)");
            }
            if !s.get("source").is_some_and(col) {
                r.bad(wh, "«source» — назва або номер стовпця");
            }
            if !s.get("target").is_some_and(col) {
                r.bad(wh, "«target» — назва або номер стовпця");
            }
            for k in ["speaker", "context"] {
                if s.get(k).is_some_and(|v| !col(v)) {
                    r.bad(wh, &format!("«{k}» — назва або номер стовпця"));
                }
            }
            if let Some(d) = s.get("delimiter") {
                if !matches!(d.as_str(), Some("," | ";" | "\t" | "auto")) {
                    r.bad(wh, "«delimiter» — «,», «;», табуляція або «auto»");
                }
            }
            if let Some(k) = s.get("kind") {
                if !kind_ok(k) {
                    r.bad(wh, &format!("невідомий вид рядка «{}»", js_string(Some(k))));
                }
            }
        }
        Some("json") => {
            let rules = s.get("rules").and_then(|r| r.as_array());
            let Some(rules) = rules.filter(|a| !a.is_empty() && a.len() <= 64) else {
                r.bad(wh, "«rules» — від 1 до 64 правил");
                return;
            };
            static PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_$\[\]*.\- ]+$").unwrap());
            for (i, rule) in rules.iter().enumerate() {
                let ro = rule.as_object();
                if !ro.is_some_and(|o| is_str(o.get("path"), 200) && PATH.is_match(o["path"].as_str().unwrap())) {
                    r.bad(&format!("{wh} rules[{i}]"), "«path» — шлях на кшталт a.b[*].text");
                } else if let Some(k) = ro.and_then(|o| o.get("kind")) {
                    if !kind_ok(k) {
                        r.bad(&format!("{wh} rules[{i}]"), &format!("невідомий вид рядка «{}»", js_string(Some(k))));
                    }
                }
            }
        }
        _ => r.bad(wh, &format!("невідомий тип опису формату «{}» (є keyvalue, table, json)", js_string(s.get("type")))),
    }
}

fn list<'a>(r: &mut Report, a: Option<&'a Value>, name: &str, max: usize) -> Option<&'a Vec<Value>> {
    let a = a?;
    match a.as_array().filter(|x| x.len() <= max) {
        Some(x) => Some(x),
        None => {
            r.bad(&format!("contributes.{name}"), &format!("має бути списком (до {max})"));
            None
        }
    }
}

fn formats(r: &mut Report, a: Option<&Value>, has_code: bool, builtin: bool) -> Vec<Value> {
    let Some(arr) = list(r, a, "formats", Limits::FORMATS) else { return vec![] };
    static HANDLER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z_$][A-Za-z0-9_$]{0,60}$").unwrap());
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (i, f) in arr.iter().enumerate() {
        let w = format!("contributes.formats[{i}]");
        let Some(fo) = f.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        match fo.get("id").and_then(|x| x.as_str()).filter(|x| LOCAL_ID.is_match(x)) {
            None => r.bad(&w, "«id» — латиниця, цифри, «-» і «_», до 40 знаків"),
            Some(id) => {
                if !seen.insert(id.to_string()) {
                    r.bad(&w, &format!("«id» «{id}» повторюється"));
                }
            }
        }
        if !is_str(fo.get("label"), Limits::NAME) {
            r.bad(&w, "«label» — непорожній рядок");
        }
        if !fo.get("extensions").and_then(|e| e.as_array()).is_some_and(|e| !e.is_empty() && e.len() <= 8 && e.iter().all(|x| x.as_str().is_some_and(|s| EXT.is_match(s)))) {
            r.bad(&w, "«extensions» — розширення з крапкою малими літерами, наприклад .lang");
        }
        if let Some(files) = fo.get("files") {
            if !files.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|p| is_str(Some(p), 120) && !p.as_str().unwrap().contains('\\') && !p.as_str().unwrap().contains(".."))) {
                r.bad(&w, "«files» — до 16 шаблонів імен");
            }
        }
        if !fo.get("text").is_some_and(|t| t.is_boolean()) {
            r.bad(&w, "«text» — true (текстовий файл) або false (JSON)");
        }
        if let Some(p) = fo.get("priority") {
            let max = if builtin { 200.0 } else { 50.0 };
            if !p.as_f64().is_some_and(|f| f.is_finite() && f >= -50.0 && f <= max) {
                r.bad(&w, "«priority» — число від −50 до 50");
            }
        }
        if fo.contains_key("spec") {
            spec(r, &format!("{w}.spec"), fo.get("spec"));
        } else if !fo.contains_key("handler") {
            r.bad(&w, "потрібен «spec» (опис даними) або «handler» (код)");
        }
        if let Some(h) = fo.get("handler") {
            if !h.as_str().is_some_and(|s| HANDLER.is_match(s)) {
                r.bad(&w, "«handler» — назва функції");
            } else if !has_code && !builtin {
                r.bad(&w, "«handler» потребує коду («main»)");
            }
        }
        if fo.contains_key("spec") && fo.contains_key("handler") {
            r.bad(&w, "вкажіть або «spec», або «handler», не обидва");
        }
        out.push(f.clone());
    }
    out
}

fn globs(v: Option<&Value>) -> bool {
    v.and_then(|v| v.as_array()).is_some_and(|a| a.len() <= 32 && a.iter().all(|p| is_str(Some(p), 120) && !p.as_str().unwrap().contains('\\') && !p.as_str().unwrap().contains("..") && !p.as_str().unwrap().starts_with('/')))
}

fn engines(r: &mut Report, a: Option<&Value>, local_formats: &HashSet<String>) -> Vec<Value> {
    let Some(arr) = list(r, a, "engines", Limits::ENGINES) else { return vec![] };
    let mut out = Vec::new();
    for (i, e) in arr.iter().enumerate() {
        let w = format!("contributes.engines[{i}]");
        let Some(eo) = e.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        if !eo.get("id").and_then(|x| x.as_str()).is_some_and(|x| LOCAL_ID.is_match(x)) {
            r.bad(&w, "«id» — латиниця, цифри, «-» і «_»");
        }
        if !is_str(eo.get("label"), Limits::NAME) {
            r.bad(&w, "«label» — непорожній рядок");
        }
        if defined(eo.get("description")) && !is_str_t(eo.get("description")) {
            r.bad(&w, "«description» — рядок");
        }
        if let Some(f) = eo.get("formats") {
            match f.as_array().filter(|a| a.len() <= 16 && a.iter().all(|x| x.is_string())) {
                None => r.bad(&w, "«formats» — список id форматів"),
                Some(a) => {
                    for x in a {
                        let id = x.as_str().unwrap();
                        if !local_formats.contains(id) {
                            r.bad(&w, &format!("формат «{id}» не оголошено в «formats»"));
                        }
                    }
                }
            }
        }
        if let Some(d) = eo.get("detect") {
            match d.as_object() {
                None => r.bad(&w, "«detect» має бути об’єктом"),
                Some(d) => {
                    for k in ["files", "anyFiles", "excludeFiles"] {
                        if d.contains_key(k) && !globs(d.get(k)) {
                            r.bad(&w, &format!("«detect.{k}» — до 32 шаблонів шляхів"));
                        }
                    }
                    if let Some(m) = d.get("min") {
                        if !is_int(Some(m)) || m.as_f64().is_some_and(|f| !(1.0..=32.0).contains(&f)) {
                            r.bad(&w, "«detect.min» — ціле від 1 до 32");
                        }
                    }
                }
            }
        }
        if let Some(df) = eo.get("dataFolders") {
            if !df.as_array().is_some_and(|a| a.len() <= 8 && a.iter().all(|f| is_str(Some(f), 80) && !f.as_str().unwrap().contains("..") && !f.as_str().unwrap().starts_with('/'))) {
                r.bad(&w, "«dataFolders» — до 8 відносних папок");
            }
        }
        if let Some(f) = eo.get("features") {
            if !f.as_array().is_some_and(|a| a.len() <= 32 && a.iter().all(|x| is_str(Some(x), 40))) {
                r.bad(&w, "«features» — список назв");
            }
        }
        out.push(e.clone());
    }
    out
}

fn languages(r: &mut Report, a: Option<&Value>) -> Vec<Value> {
    let Some(arr) = list(r, a, "languages", Limits::LANGUAGES) else { return vec![] };
    static CTX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(core|plugin:[a-z0-9.-]{1,64})$").unwrap());
    static CAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(po|pot|json)$").unwrap());
    let mut out = Vec::new();
    for (i, l) in arr.iter().enumerate() {
        let w = format!("contributes.languages[{i}]");
        let Some(lo) = l.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        if !lo.get("code").and_then(|c| c.as_str()).is_some_and(|c| LANG.is_match(c)) {
            r.bad(&w, "«code» — код мови на кшталт en, pl, pt-BR");
        }
        if !is_str(lo.get("name"), Limits::NAME) {
            r.bad(&w, "«name» — непорожній рядок");
        }
        match lo.get("catalogs").and_then(|c| c.as_array()).filter(|c| !c.is_empty() && c.len() <= 16) {
            None => r.bad(&w, "«catalogs» — від 1 до 16 файлів"),
            Some(cats) => {
                for c in cats {
                    let co = c.as_object();
                    let file = co.and_then(|o| o.get("file"));
                    if !co.is_some() || !file.is_some_and(safe_path) || !CAT.is_match(&js_string(file)) {
                        r.bad(&w, "файл каталогу має бути .po або .json усередині пакета");
                    } else if let Some(ctx) = co.and_then(|o| o.get("context")) {
                        if !ctx.as_str().is_some_and(|s| CTX.is_match(s)) {
                            r.bad(&w, "«context» — core або plugin:<id>");
                        }
                    }
                }
            }
        }
        if let Some(p) = lo.get("plural") {
            if !p.as_str().is_some_and(|s| js::len16(s) <= 300) {
                r.bad(&w, "«plural» — правило множини gettext");
            }
        }
        if let Some(f) = lo.get("fallback") {
            if !f.as_array().is_some_and(|a| a.len() <= 4 && a.iter().all(|c| c.as_str().is_some_and(|s| LANG.is_match(s)))) {
                r.bad(&w, "«fallback» — до 4 кодів мов");
            }
        }
        out.push(l.clone());
    }
    out
}

fn help(r: &mut Report, a: Option<&Value>) -> Vec<Value> {
    let Some(arr) = list(r, a, "help", Limits::HELP) else { return vec![] };
    static TOPIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(general|engine:[a-z0-9_-]{1,40})$").unwrap());
    let mut out = Vec::new();
    for (i, h) in arr.iter().enumerate() {
        let w = format!("contributes.help[{i}]");
        let Some(ho) = h.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        if !ho.get("id").and_then(|x| x.as_str()).is_some_and(|x| LOCAL_ID.is_match(x)) {
            r.bad(&w, "«id» — латиниця, цифри, «-» і «_»");
        }
        if !is_str(ho.get("title"), Limits::NAME) {
            r.bad(&w, "«title» — непорожній рядок");
        }
        if !defined(ho.get("body")) && !defined(ho.get("file")) {
            r.bad(&w, "потрібен «body» або «file»");
        }
        if let Some(b) = ho.get("body") {
            if !b.as_str().is_some_and(|s| js::len16(s) <= 20_000) {
                r.bad(&w, "«body» — текст до 20 000 знаків");
            }
        }
        if let Some(f) = ho.get("file") {
            if !safe_path(f) {
                r.bad(&w, "«file» — шлях усередині пакета");
            }
        }
        if let Some(t) = ho.get("topic") {
            if !t.as_str().is_some_and(|s| TOPIC.is_match(s)) {
                r.bad(&w, "«topic» — general або engine:<id>");
            }
        }
        out.push(h.clone());
    }
    out
}

fn settings(r: &mut Report, a: Option<&Value>) -> Vec<Value> {
    let Some(arr) = list(r, a, "settings", Limits::SETTINGS) else { return vec![] };
    static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z][A-Za-z0-9_]{0,39}$").unwrap());
    let mut out = Vec::new();
    for (i, s) in arr.iter().enumerate() {
        let w = format!("contributes.settings[{i}]");
        let Some(so) = s.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        if !so.get("id").and_then(|x| x.as_str()).is_some_and(|x| LOCAL_ID.is_match(x)) {
            r.bad(&w, "«id» — латиниця, цифри, «-» і «_»");
        }
        if !is_str(so.get("title"), Limits::NAME) {
            r.bad(&w, "«title» — непорожній рядок");
        }
        let Some(fields) = so.get("fields").and_then(|f| f.as_array()).filter(|f| !f.is_empty() && f.len() <= Limits::FIELDS) else {
            r.bad(&w, &format!("«fields» — від 1 до {} полів", Limits::FIELDS));
            continue;
        };
        let mut keys: HashSet<String> = HashSet::new();
        for (j, f) in fields.iter().enumerate() {
            let x = format!("{w}.fields[{j}]");
            let Some(fo) = f.as_object() else {
                r.bad(&x, "має бути об’єктом");
                continue;
            };
            match fo.get("key").and_then(|k| k.as_str()).filter(|k| KEY.is_match(k)) {
                None => r.bad(&x, "«key» — латиниця, цифри, «_»"),
                Some(k) => {
                    if !keys.insert(k.to_string()) {
                        r.bad(&x, &format!("«key» «{k}» повторюється"));
                    }
                }
            }
            if !matches!(fo.get("type").and_then(|t| t.as_str()), Some("boolean" | "string" | "number" | "select")) {
                r.bad(&x, "«type» — boolean, string, number або select");
            }
            if !is_str(fo.get("label"), Limits::NAME) {
                r.bad(&x, "«label» — непорожній рядок");
            }
            if fo.get("type").and_then(|t| t.as_str()) == Some("select") {
                let ok = fo.get("options").and_then(|o| o.as_array()).is_some_and(|o| !o.is_empty() && o.len() <= 64 && o.iter().all(|p| p.as_object().is_some_and(|po| is_str(po.get("value"), 80) && is_str(po.get("label"), Limits::NAME))));
                if !ok {
                    r.bad(&x, "«options» — список {«value», «label»}");
                }
            }
            if let Some(sc) = fo.get("scope") {
                if !matches!(sc.as_str(), Some("app" | "project")) {
                    r.bad(&x, "«scope» — app або project");
                }
            }
        }
        out.push(s.clone());
    }
    out
}

fn match_ok(r: &mut Report, w: &str, m: Option<&Value>, extra: &[&str]) -> bool {
    let Some(mo) = obj(m) else {
        r.bad(w, "має бути об’єктом");
        return false;
    };
    if !is_str(mo.get("find"), Limits::PATTERN) {
        r.bad(w, &format!("«find» — текст від 1 до {} знаків (не регулярний вираз)", Limits::PATTERN));
        return false;
    }
    for k in ["wholeWord", "caseSensitive"] {
        if mo.get(k).is_some_and(|v| !v.is_boolean()) {
            r.bad(w, &format!("«{k}» — true або false"));
        }
    }
    for k in extra {
        if mo.get(*k).is_some_and(|v| !v.is_string()) {
            r.bad(w, &format!("«{k}» — текст"));
        }
    }
    true
}

fn commands(r: &mut Report, a: Option<&Value>, help_ids: &HashSet<String>) -> Vec<Value> {
    let Some(arr) = list(r, a, "commands", Limits::COMMANDS) else { return vec![] };
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (i, c) in arr.iter().enumerate() {
        let w = format!("contributes.commands[{i}]");
        let Some(co) = c.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        match co.get("id").and_then(|x| x.as_str()).filter(|x| LOCAL_ID.is_match(x)) {
            None => r.bad(&w, "«id» — латиниця, цифри, «-» і «_»"),
            Some(id) => {
                if !seen.insert(id.to_string()) {
                    r.bad(&w, &format!("«id» «{id}» повторюється"));
                }
            }
        }
        if !is_str(co.get("title"), Limits::NAME) {
            r.bad(&w, "«title» — непорожній рядок");
        }
        if defined(co.get("description")) && !is_str_t(co.get("description")) {
            r.bad(&w, "«description» — текст");
        }
        match co.get("action").and_then(|a| a.as_str()) {
            Some("replace") => match co.get("steps").and_then(|s| s.as_array()).filter(|s| !s.is_empty() && s.len() <= Limits::STEPS) {
                None => r.bad(&w, &format!("«steps» — від 1 до {} кроків", Limits::STEPS)),
                Some(steps) => {
                    for (j, st) in steps.iter().enumerate() {
                        let x = format!("{w}.steps[{j}]");
                        if match_ok(r, &x, Some(st), &[]) && !st.get("replace").and_then(|v| v.as_str()).is_some_and(|s| js::len16(s) <= Limits::PATTERN) {
                            r.bad(&x, &format!("«replace» — текст до {} знаків", Limits::PATTERN));
                        }
                    }
                }
            },
            Some("help") => {
                if !co.get("help").and_then(|h| h.as_str()).is_some_and(|h| help_ids.contains(h)) {
                    r.bad(&w, "«help» — id однієї з довідок цього розширення");
                }
            }
            Some("link") => {
                if !is_https(co.get("url")) {
                    r.bad(&w, "«url» — адреса https");
                }
            }
            _ => r.bad(&w, "«action» — replace, help або link"),
        }
        out.push(c.clone());
    }
    out
}

fn qa_rules(r: &mut Report, a: Option<&Value>) -> Vec<Value> {
    let Some(arr) = list(r, a, "qaRules", Limits::QA_RULES) else { return vec![] };
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (i, q) in arr.iter().enumerate() {
        let w = format!("contributes.qaRules[{i}]");
        let Some(qo) = q.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        match qo.get("id").and_then(|x| x.as_str()).filter(|x| LOCAL_ID.is_match(x)) {
            None => r.bad(&w, "«id» — латиниця, цифри, «-» і «_»"),
            Some(id) => {
                if !seen.insert(id.to_string()) {
                    r.bad(&w, &format!("«id» «{id}» повторюється"));
                }
            }
        }
        if !is_str(qo.get("title"), Limits::NAME) {
            r.bad(&w, "«title» — непорожній рядок");
        }
        if defined(qo.get("description")) && !is_str_t(qo.get("description")) {
            r.bad(&w, "«description» — текст");
        }
        if let Some(s) = qo.get("severity") {
            if !matches!(s.as_str(), Some("warn" | "bad")) {
                r.bad(&w, "«severity» — warn або bad");
            }
        }
        if let Some(k) = qo.get("kinds") {
            if !k.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(kind_ok)) {
                r.bad(&w, &format!("«kinds» — види рядків: {}", KINDS.join(", ")));
            }
        }
        let x = format!("{w}.check");
        match obj(qo.get("check")) {
            None => r.bad(&x, "має бути об’єктом"),
            Some(ch) => {
                if defined(ch.get("message")) && !is_str(ch.get("message"), 200) {
                    r.bad(&x, "«message» — текст до 200 знаків");
                }
                match ch.get("type").and_then(|t| t.as_str()) {
                    Some("forbid") => match ch.get("items").and_then(|i| i.as_array()).filter(|i| !i.is_empty() && i.len() <= Limits::PATTERNS) {
                        None => r.bad(&x, &format!("«items» — від 1 до {} шаблонів", Limits::PATTERNS)),
                        Some(items) => {
                            for (j, it) in items.iter().enumerate() {
                                let y = format!("{x}.items[{j}]");
                                if match_ok(r, &y, Some(it), &["replace"]) && it.get("replace").and_then(|v| v.as_str()).is_some_and(|s| js::len16(s) > Limits::PATTERN) {
                                    r.bad(&y, &format!("«replace» — текст до {} знаків", Limits::PATTERN));
                                }
                            }
                        }
                    },
                    Some("require") => {
                        match_ok(r, &format!("{x}.when"), ch.get("when"), &[]);
                        match_ok(r, &format!("{x}.then"), ch.get("then"), &[]);
                    }
                    Some("maxLength") => {
                        let m = ch.get("max");
                        if !is_int(m) || m.and_then(|v| v.as_f64()).is_some_and(|f| !(1.0..=10_000.0).contains(&f)) {
                            r.bad(&x, "«max» — ціле число від 1 до 10000");
                        }
                    }
                    Some("sameAsSource") => {}
                    _ => r.bad(&x, "«type» — forbid, require, maxLength або sameAsSource"),
                }
            }
        }
        out.push(q.clone());
    }
    out
}

fn glossaries(r: &mut Report, a: Option<&Value>) -> Vec<Value> {
    let Some(arr) = list(r, a, "glossaries", Limits::GLOSSARIES) else { return vec![] };
    static FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(json|tsv)$").unwrap());
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (i, g) in arr.iter().enumerate() {
        let w = format!("contributes.glossaries[{i}]");
        let Some(go) = g.as_object() else {
            r.bad(&w, "має бути об’єктом");
            continue;
        };
        match go.get("id").and_then(|x| x.as_str()).filter(|x| LOCAL_ID.is_match(x)) {
            None => r.bad(&w, "«id» — латиниця, цифри, «-» і «_»"),
            Some(id) => {
                if !seen.insert(id.to_string()) {
                    r.bad(&w, &format!("«id» «{id}» повторюється"));
                }
            }
        }
        if !is_str(go.get("title"), Limits::NAME) {
            r.bad(&w, "«title» — непорожній рядок");
        }
        if defined(go.get("description")) && !is_str_t(go.get("description")) {
            r.bad(&w, "«description» — текст");
        }
        if !defined(go.get("terms")) && !defined(go.get("file")) {
            r.bad(&w, "потрібні «terms» або «file»");
        }
        if let Some(f) = go.get("file") {
            if !safe_path(f) || !FILE.is_match(&js_string(Some(f))) {
                r.bad(&w, "«file» — .json або .tsv усередині пакета");
            }
        }
        if let Some(t) = go.get("terms") {
            match t.as_array().filter(|a| a.len() <= Limits::TERMS) {
                None => r.bad(&w, &format!("«terms» — список до {} термінів", Limits::TERMS)),
                Some(terms) => {
                    for (j, tm) in terms.iter().enumerate() {
                        let ok = tm.as_object().is_some_and(|o| {
                            is_str(o.get("en"), 200)
                                && is_str(o.get("uk"), 200)
                                && o.get("alt").is_none_or(|a| a.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|x| is_str(Some(x), 200))))
                                && o.get("note").is_none_or(|n| is_str(Some(n), 300))
                        });
                        if !ok {
                            r.bad(&format!("{w}.terms[{j}]"), "потрібні «en» і «uk» (текст), «alt» — список, «note» — текст");
                            break;
                        }
                    }
                }
            }
        }
        out.push(g.clone());
    }
    out
}

/// Читає й перевіряє опис. `input` — текст JSON або вже розібране значення.
pub fn check_manifest(input: &Value, builtin: bool) -> Checked {
    let mut r = Report::default();
    let parsed;
    let j: &Value = match input {
        Value::String(text) => {
            if js::len16(text) > Limits::MANIFEST_BYTES {
                return Checked::Err { errors: vec!["Опис розширення завеликий".into()] };
            }
            match serde_json::from_str::<Value>(text) {
                Ok(v) => {
                    parsed = v;
                    &parsed
                }
                Err(e) => return Checked::Err { errors: vec![format!("Опис розширення не є JSON: {e}")] },
            }
        }
        other => other,
    };
    let Some(m) = j.as_object() else { return Checked::Err { errors: vec!["Опис розширення має бути об’єктом".into()] } };
    if m.get("manifestVersion").and_then(|v| v.as_f64()) != Some(MANIFEST_VERSION as f64) {
        r.bad("manifestVersion", &format!("очікується {MANIFEST_VERSION}, а в розширенні {}: воно написане для іншої версії застосунку", js_string(m.get("manifestVersion"))));
    }
    match m.get("id").and_then(|v| v.as_str()).filter(|s| js::len16(s) <= Limits::ID && ID.is_match(s)) {
        None => r.bad("id", "має бути на кшталт «автор.назва»: малі латинські літери, цифри, «-», не менше двох частин через крапку"),
        Some(id) => {
            if !builtin && id.split('.').next() == Some("transly") {
                r.bad("id", "частина «transly» зарезервована для вбудованих розширень");
            }
        }
    }
    if !is_str(m.get("name"), Limits::NAME) {
        r.bad("name", &format!("потрібна назва до {} знаків", Limits::NAME));
    }
    if !m.get("version").and_then(|v| v.as_str()).is_some_and(|v| parse_version(v).is_some() && js::len16(v) <= 40) {
        r.bad("version", "має бути версією на кшталт 1.2.3");
    }
    if defined(m.get("description")) && !is_str_t(m.get("description")) {
        r.bad("description", &format!("має бути рядком до {} знаків", Limits::TEXT));
    }
    if let Some(sl) = m.get("sourceLanguage") {
        if !sl.as_str().is_some_and(|s| LANG.is_match(s)) {
            r.bad("sourceLanguage", "має бути кодом мови");
        }
    }
    if let Some(a) = m.get("author") {
        let ok = is_str(Some(a), Limits::NAME) || a.as_object().is_some_and(|o| is_str(o.get("name"), Limits::NAME) && (o.get("url").is_none() || is_https(o.get("url"))));
        if !ok {
            r.bad("author", "має бути ім’ям або {name, url} з https-адресою");
        }
    }
    if defined(m.get("license")) && !is_str(m.get("license"), 80) {
        r.bad("license", "має бути рядком");
    }
    if defined(m.get("homepage")) && !is_https(m.get("homepage")) {
        r.bad("homepage", "має бути https-адресою");
    }
    if let Some(rep) = m.get("repository") {
        static REPO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$").unwrap());
        if !(is_https(Some(rep)) || rep.as_str().is_some_and(|s| REPO.is_match(s))) {
            r.bad("repository", "має бути owner/repo або https-адресою");
        }
    }
    if let Some(k) = m.get("keywords") {
        if !k.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|x| is_str(Some(x), 40))) {
            r.bad("keywords", "до 16 коротких слів");
        }
    }
    if let Some(req) = m.get("requires") {
        match req.as_object() {
            None => r.bad("requires", "має бути об’єктом"),
            Some(ro) => {
                for k in ["transly", "api"] {
                    if let Some(v) = ro.get(k) {
                        if !v.as_str().is_some_and(valid_range) {
                            r.bad(&format!("requires.{k}"), "діапазон версій не розпізнано");
                        }
                    }
                }
            }
        }
    }
    if let Some(d) = m.get("dependencies") {
        match d.as_object().filter(|o| o.len() <= 16) {
            None => r.bad("dependencies", "має бути об’єктом (до 16 розширень)"),
            Some(o) => {
                for (id, range) in o {
                    if !ID.is_match(id) || !range.as_str().is_some_and(valid_range) {
                        r.bad("dependencies", &format!("«{id}»: потрібні id розширення та діапазон версій"));
                    }
                }
            }
        }
    }
    let mut perms: Vec<String> = Vec::new();
    if let Some(p) = m.get("permissions") {
        match p.as_array().filter(|a| a.len() <= PERMISSIONS.len() && a.iter().all(|x| x.as_str().is_some_and(|s| PERMISSIONS.contains(&s)))) {
            None => r.bad("permissions", &format!("дозволи: {}", PERMISSIONS.join(", "))),
            Some(a) => {
                for x in a {
                    let s = x.as_str().unwrap().to_string();
                    if !perms.contains(&s) {
                        perms.push(s);
                    }
                }
            }
        }
    }
    if let Some(n) = m.get("network") {
        static HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9]([a-z0-9.-]{0,120}[a-z0-9])?$").unwrap());
        let h = n.as_object().and_then(|o| o.get("hosts"));
        if !h.and_then(|h| h.as_array()).is_some_and(|a| !a.is_empty() && a.len() <= 8 && a.iter().all(|x| x.as_str().is_some_and(|s| HOST.is_match(s) && s.contains('.')))) {
            r.bad("network", "«hosts» — до 8 доменних імен");
        }
    }
    if let Some(mn) = m.get("main") {
        static JS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.m?js$").unwrap());
        if !(safe_path(mn) && JS.is_match(mn.as_str().unwrap_or(""))) {
            r.bad("main", "має бути шляхом до .js усередині пакета");
        }
    }
    let has_main = m.contains_key("main");
    if (perms.iter().any(|p| p == "network") || m.contains_key("network")) && !has_main {
        r.bad("permissions", "дозвіл «network» має сенс лише для розширення з кодом");
    }
    if perms.iter().any(|p| p == "network") && !m.contains_key("network") {
        r.bad("network", "дозвіл «network» потребує переліку «hosts»");
    }
    let mut contributes: Option<Value> = None;
    if let Some(cv) = m.get("contributes") {
        match cv.as_object() {
            None => r.bad("contributes", "має бути об’єктом"),
            Some(c) => {
                for k in c.keys() {
                    if !["formats", "engines", "languages", "help", "settings", "commands", "qaRules", "glossaries"].contains(&k.as_str()) {
                        r.warn("contributes", &format!("«{k}» цій версії застосунку невідоме й буде пропущене"));
                    }
                }
                let f = formats(&mut r, c.get("formats"), has_main, builtin);
                let helps = help(&mut r, c.get("help"));
                let local: HashSet<String> = f.iter().filter_map(|x| x.get("id").and_then(|i| i.as_str()).map(String::from)).collect();
                let help_ids: HashSet<String> = helps.iter().filter_map(|x| x.get("id").and_then(|i| i.as_str()).map(String::from)).collect();
                let mut out = Map::new();
                out.insert("formats".into(), Value::Array(f));
                out.insert("engines".into(), Value::Array(engines(&mut r, c.get("engines"), &local)));
                out.insert("languages".into(), Value::Array(languages(&mut r, c.get("languages"))));
                out.insert("help".into(), Value::Array(helps));
                out.insert("settings".into(), Value::Array(settings(&mut r, c.get("settings"))));
                out.insert("commands".into(), Value::Array(commands(&mut r, c.get("commands"), &help_ids)));
                out.insert("qaRules".into(), Value::Array(qa_rules(&mut r, c.get("qaRules"))));
                out.insert("glossaries".into(), Value::Array(glossaries(&mut r, c.get("glossaries"))));
                contributes = Some(Value::Object(out));
            }
        }
    }
    let files_obj: Option<&Map<String, Value>> = m.get("files").and_then(|f| f.as_object());
    if let Some(f) = m.get("files") {
        match f.as_object().filter(|o| o.len() <= Limits::FILES) {
            None => r.bad("files", &format!("має бути об’єктом (до {} файлів)", Limits::FILES)),
            Some(o) => {
                for (p, h) in o {
                    if !safe_path(&Value::String(p.clone())) || !h.as_str().is_some_and(|s| SHA.is_match(s)) {
                        r.bad("files", &format!("«{p}»: потрібні безпечний шлях і sha256-<64 символи>"));
                    }
                }
            }
        }
    }
    if r.errors.is_empty() && has_main && !builtin && !files_obj.is_some_and(|f| m.get("main").and_then(|x| x.as_str()).is_some_and(|mn| f.contains_key(mn))) {
        r.bad("files", "розширення з кодом має мати контрольну суму файлу «main»");
    }
    if r.errors.is_empty() {
        let has = |p: &str| files_obj.is_some_and(|f| f.contains_key(p));
        if let Some(c) = contributes.as_ref().and_then(|c| c.as_object()) {
            // вбудовані розширення мають файли всередині застосунку, звіряти їх нема з чим
            if !builtin {
                for l in c["languages"].as_array().unwrap() {
                    for cat in l.get("catalogs").and_then(|c| c.as_array()).into_iter().flatten() {
                        let f = cat.get("file").and_then(|f| f.as_str()).unwrap_or("");
                        if !has(f) {
                            r.bad("files", &format!("файл «{f}» не має контрольної суми"));
                        }
                    }
                }
            }
            for key in ["glossaries", "help"] {
                for g in c[key].as_array().unwrap() {
                    if let Some(f) = g.get("file").and_then(|f| f.as_str()).filter(|f| !f.is_empty()) {
                        if !has(f) {
                            r.bad("files", &format!("файл «{f}» не має контрольної суми"));
                        }
                    }
                }
            }
        }
    }
    if !r.errors.is_empty() {
        return Checked::Err { errors: r.errors };
    }
    let mut manifest = m.clone();
    if let Some(c) = contributes {
        manifest.insert("contributes".into(), c);
    }
    if !perms.is_empty() {
        manifest.insert("permissions".into(), Value::Array(perms.into_iter().map(Value::String).collect()));
    }
    Checked::Ok { manifest: Value::Object(manifest), warnings: r.warnings }
}

/// Чи може розширення працювати в цій версії застосунку: діапазон застосунку й діапазон API розширень.
pub fn compatibility(m: &Value, app: &str, api: &str) -> Result<(), String> {
    if let Some(range) = m.get("requires").and_then(|r| r.get("transly")).and_then(|r| r.as_str()).filter(|r| !r.is_empty()) {
        if !satisfies(app, range) {
            return Err(format!("Потрібен Transly {range}, а встановлено {app}"));
        }
    }
    if let Some(range) = m.get("requires").and_then(|r| r.get("api")).and_then(|r| r.as_str()).filter(|r| !r.is_empty()) {
        if !satisfies(api, range) {
            return Err(format!("Потрібен програмний інтерфейс {range}, а застосунок пропонує {api}"));
        }
    }
    Ok(())
}

/// Автор рядком.
pub fn author_of(m: &Value) -> String {
    match m.get("author") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        _ => String::new(),
    }
}
