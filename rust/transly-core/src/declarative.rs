//! `ext/declarative.ts`: формати, описані даними. Розширення, що несе файл `.lang` чи табличний формат, каже, який вигляд має
//! файл (`spec`), а ці функції, що належать застосунку й тестуються разом із ним, читають і пишуть його. Код розширення не
//! виконується, тож довіряти нічому. Правила ті самі, що й у вбудованих форматів: вхід ніколи не змінюється, текст, якого
//! перекладач не чіпав, виходить таким, яким увійшов.

use crate::keys::safe_key;
use crate::model::{GameFile, Translations, Unit, UnitKind};
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

/// Один рядок файлу не довший за це (у файлі гри нема рядка в мегабайт тексту).
const MAX_CELL: usize = 200_000;

fn unit(key: &str, source: String, kind: UnitKind, speaker: String, context: String) -> Unit {
    Unit { key: safe_key(key), source, speaker, face: None, event: None, note: None, db_note: None, page: None, kind, context }
}

/// Стовпець: назва із заголовка чи номер.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Col {
    Name(String),
    Idx(i64),
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum OneOrMany<T> {
    One(T),
    Many(Vec<T>),
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct KeyValueSpec {
    #[serde(default)]
    pub separator: Option<String>,
    #[serde(default)]
    pub comments: Option<Vec<String>>,
    /// `\n` у значенні — перенос рядка.
    #[serde(default)]
    pub unescape: bool,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct TableSpec {
    #[serde(default)]
    pub delimiter: Option<String>,
    #[serde(default)]
    pub header: Option<bool>,
    pub key: OneOrMany<Col>,
    pub source: Col,
    pub target: Col,
    #[serde(default)]
    pub speaker: Option<Col>,
    #[serde(default)]
    pub context: Option<Col>,
    #[serde(default)]
    pub kind: Option<UnitKind>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct JsonRule {
    pub path: String,
    #[serde(default)]
    pub kind: Option<UnitKind>,
    #[serde(default)]
    pub speaker: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct JsonSpec {
    pub rules: Vec<JsonRule>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FormatSpec {
    KeyValue(KeyValueSpec),
    Table(TableSpec),
    Json(JsonSpec),
}

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}
fn lines_of(text: &str) -> Vec<&str> {
    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}

/* ---------- keyvalue ---------- */

fn unesc(s: &str) -> String {
    static E: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\(n|t|\\)").unwrap());
    E.replace_all(s, |c: &regex::Captures| match &c[1] {
        "n" => "\n".to_string(),
        "t" => "\t".to_string(),
        _ => "\\".to_string(),
    })
    .into_owned()
}
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\n', "\\n").replace('\t', "\\t")
}

struct KvLine {
    key: String,
    head: String,
    value: String,
    line: usize,
}
fn kv_lines(text: &str, spec: &KeyValueSpec) -> Vec<KvLine> {
    let sep = spec.separator.clone().unwrap_or_else(|| "=".into());
    let comments: Vec<String> = spec.comments.clone().unwrap_or_else(|| vec!["#".into(), ";".into(), "//".into()]);
    let mut out = Vec::new();
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    for (i, raw) in lines_of(body).into_iter().enumerate() {
        let t = raw.trim_start_matches(crate::js::is_space);
        if t.is_empty() || comments.iter().any(|c| t.starts_with(c.as_str())) || crate::js::len16(raw) > MAX_CELL {
            continue;
        }
        let Some(at) = raw.find(&sep) else { continue };
        if at == 0 {
            continue;
        }
        let key = crate::js::trim(&raw[..at]).to_string();
        if key.is_empty() {
            continue;
        }
        let rest = &raw[at + sep.len()..];
        let lead_len = rest.len() - rest.trim_start_matches(crate::js::is_space).len();
        out.push(KvLine { key, head: format!("{}{}", &raw[..at + sep.len()], &rest[..lead_len]), value: rest[lead_len..].to_string(), line: i + 1 });
    }
    out
}
/// Ключ, що трапляється двічі, дістає `#2`, `#3`…, щоб кожен рядок мав своє місце.
fn unique_keys(keys: &[&str]) -> Vec<String> {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    keys.iter()
        .map(|k| {
            let n = seen.entry(k).or_insert(0);
            *n += 1;
            if *n == 1 { k.to_string() } else { format!("{k}#{n}") }
        })
        .collect()
}

fn extract_kv(text: &str, spec: &KeyValueSpec) -> Vec<Unit> {
    let rows = kv_lines(text, spec);
    let keys = unique_keys(&rows.iter().map(|r| r.key.as_str()).collect::<Vec<_>>());
    rows.iter().enumerate().filter(|(_, r)| !crate::js::trim(&r.value).is_empty()).map(|(i, r)| unit(&keys[i], if spec.unescape { unesc(&r.value) } else { r.value.clone() }, UnitKind::Message, String::new(), format!("рядок {}", r.line))).collect()
}
fn apply_kv(text: &str, tr: &Translations, spec: &KeyValueSpec) -> String {
    let (bom, body) = match text.strip_prefix('\u{feff}') {
        Some(b) => ("\u{feff}", b),
        None => ("", text),
    };
    let eol = eol_of(body);
    let rows = kv_lines(body, spec);
    let keys = unique_keys(&rows.iter().map(|r| r.key.as_str()).collect::<Vec<_>>());
    let mut by: HashMap<usize, String> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        if let Some(e) = tr.get(&safe_key(&keys[i])).filter(|e| !crate::js::trim(&e.target).is_empty()) {
            by.insert(r.line, format!("{}{}", r.head, if spec.unescape { esc(&e.target) } else { e.target.clone() }));
        }
    }
    let lines: Vec<String> = lines_of(body).into_iter().enumerate().map(|(i, raw)| by.get(&(i + 1)).cloned().unwrap_or_else(|| raw.to_string())).collect();
    format!("{bom}{}", lines.join(eol))
}

/* ---------- table ---------- */

fn parse_table(text: &str, delim: char) -> Option<Vec<Vec<String>>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let (mut row, mut cell, mut q): (Vec<String>, String, bool) = (Vec::new(), String::new(), false);
    let s: Vec<char> = text.strip_prefix('\u{feff}').unwrap_or(text).chars().collect();
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if q {
            if c == '"' {
                if s.get(i + 1) == Some(&'"') {
                    cell.push('"');
                    i += 1;
                } else {
                    q = false;
                }
            } else {
                cell.push(c);
            }
        } else if c == '"' && cell.is_empty() {
            q = true;
        } else if c == delim {
            row.push(std::mem::take(&mut cell));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && s.get(i + 1) == Some(&'\n') {
                i += 1;
            }
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
        } else {
            cell.push(c);
        }
        if cell.len() > MAX_CELL && cell.encode_utf16().count() > MAX_CELL {
            return None; // комірка завелика
        }
        i += 1;
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows.retain(|r| !(r.len() == 1 && r[0].is_empty()));
    Some(rows)
}
fn cell_out(v: &str, d: &str) -> String {
    if v.contains(['"', '\r', '\n']) || v.contains(d) { format!("\"{}\"", v.replace('"', "\"\"")) } else { v.to_string() }
}
fn delimiter_of(text: &str, want: Option<&str>) -> String {
    if let Some(w) = want.filter(|w| *w != "auto") {
        return w.to_string();
    }
    let first = lines_of(text)[0];
    let n = |d: char| first.split(d).count();
    [',', ';', '\t'].iter().copied().fold(',', |a, d| if n(d) > n(a) { d } else { a }).to_string()
}

struct TableView {
    rows: Vec<Vec<String>>,
    head: Option<Vec<String>>,
    delim: String,
}
impl TableView {
    fn at(&self, c: &Col) -> i64 {
        match c {
            Col::Idx(n) => *n,
            Col::Name(s) => self.head.as_ref().and_then(|h| h.iter().position(|x| crate::js::trim(x) == s)).map_or(-1, |i| i as i64),
        }
    }
}
fn view_table(text: &str, spec: &TableSpec) -> Option<TableView> {
    let delim = delimiter_of(text, spec.delimiter.as_deref());
    let mut rows = parse_table(text, delim.chars().next().unwrap_or(','))?;
    let head = if spec.header != Some(false) { Some(if rows.is_empty() { vec![] } else { rows.remove(0) }) } else { None };
    Some(TableView { rows, head, delim })
}
fn key_cols(spec: &TableSpec) -> Vec<&Col> {
    match &spec.key {
        OneOrMany::One(c) => vec![c],
        OneOrMany::Many(v) => v.iter().collect(),
    }
}
fn cell(r: &[String], c: i64) -> &str {
    usize::try_from(c).ok().and_then(|c| r.get(c)).map_or("", |s| s.as_str())
}

fn extract_table(text: &str, spec: &TableSpec) -> Vec<Unit> {
    let Some(v) = view_table(text, spec) else { return Vec::new() };
    let kc: Vec<i64> = key_cols(spec).into_iter().map(|c| v.at(c)).collect();
    let src = v.at(&spec.source);
    if src < 0 || kc.iter().any(|&c| c < 0) {
        return Vec::new();
    }
    let sp = spec.speaker.as_ref().map_or(-1, |c| v.at(c));
    let cx = spec.context.as_ref().map_or(-1, |c| v.at(c));
    let mut out = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (i, r) in v.rows.iter().enumerate() {
        let source = cell(r, src);
        if crate::js::trim(source).is_empty() {
            continue;
        }
        let mut base = kc.iter().map(|&c| cell(r, c)).collect::<Vec<_>>().join(":");
        if base.is_empty() {
            base = format!("#{}", i + 1);
        }
        let n = seen.entry(base.clone()).or_insert(0);
        *n += 1;
        let key = if *n == 1 { base } else { format!("{base}#{n}") };
        let context = if cx >= 0 { cell(r, cx).to_string() } else { format!("рядок {}", i + 1 + usize::from(v.head.is_some())) };
        out.push(unit(&key, source.to_string(), spec.kind.clone().unwrap_or(UnitKind::Message), if sp >= 0 { cell(r, sp).to_string() } else { String::new() }, context));
    }
    out
}

fn apply_table(text: &str, tr: &Translations, spec: &TableSpec) -> Option<String> {
    let v = view_table(text, spec)?;
    let eol = eol_of(text);
    let kc: Vec<i64> = key_cols(spec).into_iter().map(|c| v.at(c)).collect();
    let src = v.at(&spec.source);
    if src < 0 || kc.iter().any(|&c| c < 0) {
        return Some(text.to_string());
    }
    let mut tgt = v.at(&spec.target);
    let mut head = v.head.clone();
    if tgt < 0 {
        let (Some(h), Col::Name(name)) = (head.as_mut(), &spec.target) else { return Some(text.to_string()) };
        tgt = h.len() as i64;
        h.push(name.clone());
    }
    let tgt = tgt as usize;
    let mut seen: HashMap<String, usize> = HashMap::new();
    let rows: Vec<Vec<String>> = v
        .rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let source = cell(r, src);
            if crate::js::trim(source).is_empty() {
                return r.clone();
            }
            let mut base = kc.iter().map(|&c| cell(r, c)).collect::<Vec<_>>().join(":");
            if base.is_empty() {
                base = format!("#{}", i + 1);
            }
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            let key = if *n == 1 { base } else { format!("{base}#{n}") };
            let Some(e) = tr.get(&safe_key(&key)).filter(|e| !crate::js::trim(&e.target).is_empty()) else { return r.clone() };
            let mut next = r.clone();
            while next.len() <= tgt {
                next.push(String::new());
            }
            next[tgt] = e.target.clone();
            next
        })
        .collect();
    let all: Vec<&Vec<String>> = head.iter().chain(rows.iter()).collect();
    let body = all.iter().map(|r| r.iter().map(|c| cell_out(c, &v.delim)).collect::<Vec<_>>().join(&v.delim)).collect::<Vec<_>>().join(eol);
    Some(format!("{}{body}{}", if text.starts_with('\u{feff}') { "\u{feff}" } else { "" }, if text.ends_with('\n') { eol } else { "" }))
}

/* ---------- json ---------- */

#[derive(Clone, Debug, PartialEq)]
pub enum Seg {
    Key(String),
    Idx(usize),
    Star,
}
#[derive(Clone, Debug, PartialEq)]
pub enum PathSeg {
    Key(String),
    Idx(usize),
}
const MAX_DEPTH: usize = 64;

/// `a.b[0].c` → [a, b, 0, c]; `[*]` і `*` — підстановки. None, коли шлях записано не в такій формі.
pub fn parse_path(path: &str) -> Option<Vec<Seg>> {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?:\.?([A-Za-z_$][A-Za-z0-9_$ -]*|\*)|\[([0-9]+|\*)\])").unwrap());
    let mut segs = Vec::new();
    let mut i = 0;
    while i < path.len() {
        let m = RE.captures(&path[i..])?;
        if let Some(g) = m.get(1) {
            let name = crate::js::trim(g.as_str());
            if matches!(name, "__proto__" | "constructor" | "prototype") {
                return None;
            }
            segs.push(if g.as_str() == "*" { Seg::Star } else { Seg::Key(name.to_string()) });
        } else {
            let g = m.get(2).unwrap().as_str();
            segs.push(if g == "*" { Seg::Star } else { Seg::Idx(g.parse().unwrap_or(0)) });
        }
        i += m.get(0).unwrap().end();
    }
    if segs.is_empty() { None } else { Some(segs) }
}

fn show(path: &[PathSeg]) -> String {
    path.iter()
        .enumerate()
        .map(|(i, s)| match s {
            PathSeg::Idx(n) => format!("[{n}]"),
            PathSeg::Key(k) => if i > 0 { format!(".{k}") } else { k.clone() },
        })
        .collect()
}

fn child<'a>(node: &'a Value, s: &Seg) -> Option<(PathSeg, &'a Value)> {
    match (node, s) {
        (Value::Object(o), Seg::Key(k)) => o.get(k).map(|v| (PathSeg::Key(k.clone()), v)),
        (Value::Object(o), Seg::Idx(n)) => o.get(&n.to_string()).map(|v| (PathSeg::Key(n.to_string()), v)),
        (Value::Array(a), Seg::Idx(n)) => a.get(*n).map(|v| (PathSeg::Idx(*n), v)),
        _ => None,
    }
}

/// Конкретні шляхи, яких у `root` досягає шаблон із підстановками.
fn reach(root: &Value, segs: &[Seg]) -> Vec<Vec<PathSeg>> {
    fn go(node: &Value, i: usize, segs: &[Seg], path: &mut Vec<PathSeg>, out: &mut Vec<Vec<PathSeg>>) {
        if i > MAX_DEPTH || !(node.is_object() || node.is_array()) {
            return;
        }
        let last = i == segs.len() - 1;
        let kids: Vec<(PathSeg, &Value)> = match &segs[i] {
            Seg::Star => match node {
                Value::Array(a) => a.iter().enumerate().map(|(k, v)| (PathSeg::Idx(k), v)).collect(),
                Value::Object(o) => o.iter().map(|(k, v)| (PathSeg::Key(k.clone()), v)).collect(),
                _ => vec![],
            },
            s => child(node, s).into_iter().collect(),
        };
        for (k, next) in kids {
            path.push(k);
            if last {
                if next.is_string() {
                    out.push(path.clone());
                }
            } else {
                go(next, i + 1, segs, path, out);
            }
            path.pop();
        }
    }
    let mut out = Vec::new();
    go(root, 0, segs, &mut Vec::new(), &mut out);
    out
}

fn at_path<'a>(root: &'a Value, path: &[PathSeg]) -> Option<&'a Value> {
    let mut cur = root;
    for s in path {
        cur = match (cur, s) {
            (Value::Object(o), PathSeg::Key(k)) => o.get(k)?,
            (Value::Array(a), PathSeg::Idx(i)) => a.get(*i)?,
            _ => return None,
        };
    }
    Some(cur)
}

fn extract_json(json: &Value, spec: &JsonSpec) -> Vec<Unit> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for rule in &spec.rules {
        let Some(segs) = parse_path(&rule.path) else { continue };
        for path in reach(json, &segs) {
            let key = show(&path);
            let value = at_path(json, &path).and_then(|v| v.as_str()).unwrap_or("").to_string();
            if crate::js::trim(&value).is_empty() || !seen.insert(key.clone()) {
                continue;
            }
            let parent = at_path(json, &path[..path.len() - 1]);
            let sib = |name: &Option<String>| -> String {
                match (name.as_deref().filter(|n| !n.is_empty()), parent) {
                    (Some(n), Some(Value::Object(o))) => o.get(n).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    _ => String::new(),
                }
            };
            let context = Some(sib(&rule.context)).filter(|c| !c.is_empty()).unwrap_or_else(|| key.clone());
            out.push(unit(&key, value, rule.kind.clone().unwrap_or(UnitKind::Message), sib(&rule.speaker), context));
        }
    }
    out
}

fn apply_json(json: &Value, tr: &Translations, spec: &JsonSpec) -> Value {
    let mut copy = json.clone();
    for rule in &spec.rules {
        let Some(segs) = parse_path(&rule.path) else { continue };
        for path in reach(&copy, &segs) {
            let Some(e) = tr.get(&safe_key(&show(&path))).filter(|e| !crate::js::trim(&e.target).is_empty()) else { continue };
            let mut cur = &mut copy;
            for s in &path {
                cur = match (cur, s) {
                    (Value::Object(o), PathSeg::Key(k)) => o.get_mut(k).unwrap(),
                    (Value::Array(a), PathSeg::Idx(i)) => &mut a[*i],
                    _ => unreachable!(),
                };
            }
            *cur = Value::String(e.target.clone());
        }
    }
    copy
}

/* ---------- входи ---------- */

/// Рядки файлу за описом. Файл, що не читається (завелика комірка), не дає рядків.
pub fn extract_by_spec(file: &GameFile, spec: &FormatSpec) -> Vec<Unit> {
    match spec {
        FormatSpec::KeyValue(s) => file.text.as_deref().map_or(vec![], |t| extract_kv(t, s)),
        FormatSpec::Table(s) => file.text.as_deref().map_or(vec![], |t| extract_table(t, s)),
        FormatSpec::Json(s) => extract_json(&file.json, s),
    }
}

/// Результат запису за описом: розібраний JSON чи текст. Err, коли файл не вдалося записати (завелика комірка).
pub fn apply_by_spec(file: &GameFile, tr: &Translations, spec: &FormatSpec) -> Result<crate::engine::Applied, String> {
    use crate::engine::Applied;
    Ok(match spec {
        FormatSpec::KeyValue(s) => Applied::Text(apply_kv(file.text.as_deref().unwrap_or(""), tr, s)),
        FormatSpec::Table(s) => Applied::Text(apply_table(file.text.as_deref().unwrap_or(""), tr, s).ok_or("cell too long")?),
        FormatSpec::Json(s) => Applied::Json(apply_json(&file.json, tr, s)),
    })
}

/// Шаблон імені (`*.lang`, `data/**/*.json`) як перевірка шляху; `*` — будь-які знаки в імені, `**` — будь-які теки. Регістр не важливий.
pub fn glob_test(pattern: &str) -> impl Fn(&str) -> bool {
    let cs: Vec<char> = pattern.chars().collect();
    let mut src = String::new();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c == '*' && cs.get(i + 1) == Some(&'*') {
            if cs.get(i + 2) == Some(&'/') {
                src.push_str("(?:.*/)?");
                i += 2;
            } else {
                src.push_str(".*");
                i += 1;
            }
        } else if c == '*' {
            src.push_str("[^/]*");
        } else if c == '?' {
            src.push_str("[^/]");
        } else {
            src.push_str(&regex::escape(&c.to_string()));
        }
        i += 1;
    }
    let re = Regex::new(&format!("(?i)^{src}$")).ok();
    move |p: &str| re.as_ref().is_some_and(|r| r.is_match(&p.replace('\\', "/")))
}

/// Для вектора: опис як `Value` у `FormatSpec`.
pub fn spec_of(v: &Value) -> Option<FormatSpec> {
    serde_json::from_value(v.clone()).ok()
}
