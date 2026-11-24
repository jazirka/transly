//! `formats/*.ts`: текстові формати гри: таблиці CSV/TSV, каталоги gettext (.po), скрипти Ren'Py (.rpy), JSON локалізації.
//! Текст переписується на місці: усе, що не переклад, лишається як було.

use crate::keys::safe_key;
use crate::model::{Translations, Unit, UnitKind};
use crate::rpgmaker::has_text;
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

const BOM: char = '\u{feff}';

fn unit(key: String, source: String, speaker: String, kind: UnitKind, context: String) -> Unit {
    Unit { key, source, speaker, face: None, event: None, note: None, db_note: None, page: None, kind, context }
}
fn target_of<'a>(tr: &'a Translations, key: &str) -> Option<&'a str> {
    tr.get(key).map(|e| e.target.as_str()).filter(|t| !crate::js::trim(t).is_empty())
}
/// `text.split(/\r?\n/)`.
fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}

/* ---------- CSV ---------- */

pub mod csv {
    use super::*;

    struct Table {
        rows: Vec<Vec<String>>,
        delim: char,
        eol: &'static str,
        bom: bool,
        has_header: bool,
        key: i64,
        source: usize,
        target: i64,
    }

    fn split(text: &str) -> (Vec<Vec<String>>, char, &'static str, bool) {
        let bom = text.starts_with(BOM);
        let t: Vec<char> = if bom { text.chars().skip(1).collect() } else { text.chars().collect() };
        let ts: String = t.iter().collect();
        let eol = if ts.contains("\r\n") { "\r\n" } else { "\n" };
        let first = split_lines(&ts)[0];
        let delim = if first.contains('\t') { '\t' } else if first.split(';').count() > first.split(',').count() { ';' } else { ',' };
        let mut rows: Vec<Vec<String>> = Vec::new();
        let (mut row, mut cell, mut quoted, mut started): (Vec<String>, String, bool, bool) = (Vec::new(), String::new(), false, false);
        let mut i = 0;
        while i < t.len() {
            let c = t[i];
            if quoted {
                if c == '"' {
                    if t.get(i + 1) == Some(&'"') {
                        cell.push('"');
                        i += 1;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.push(c);
                }
            } else if c == '"' && cell.is_empty() {
                quoted = true;
                started = true;
            } else if c == delim {
                row.push(std::mem::take(&mut cell));
                started = true;
            } else if c == '\n' || c == '\r' {
                if c == '\r' && t.get(i + 1) == Some(&'\n') {
                    i += 1;
                }
                row.push(std::mem::take(&mut cell));
                started = false;
                rows.push(std::mem::take(&mut row));
            } else {
                cell.push(c);
                started = true;
            }
            i += 1;
        }
        if started || !cell.is_empty() || !row.is_empty() {
            row.push(cell);
            rows.push(row);
        }
        (rows, delim, eol, bom)
    }

    static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(key|id|name|identifier|ключ)$").unwrap());
    static SRC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(source|original|text|english|en|msgid|оригінал|string)$").unwrap());
    static TGT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(target|translation|translated|uk|ukrainian|переклад)$").unwrap());

    fn analyse(text: &str) -> Table {
        let (rows, delim, eol, bom) = split(text);
        let head: Vec<String> = rows.first().map(|r| r.iter().map(|c| crate::js::trim(c).to_string()).collect()).unwrap_or_default();
        let src = head.iter().position(|c| SRC.is_match(c));
        if let Some(src) = src {
            let key = head.iter().position(|c| KEY.is_match(c)).map_or(-1, |i| i as i64);
            let tgt = head.iter().enumerate().position(|(i, c)| TGT.is_match(c) && i != src).map_or(-1, |i| i as i64);
            return Table { rows, delim, eol, bom, has_header: true, key, source: src, target: tgt };
        }
        let wide = rows.first().is_some_and(|r| r.len() >= 3);
        Table { rows, delim, eol, bom, has_header: false, key: if wide { 0 } else { -1 }, source: if wide { 1 } else { 0 }, target: if wide { 2 } else { 1 } }
    }

    fn key_of(t: &Table, row: &[String], i: usize) -> String {
        if t.key >= 0 {
            if let Some(c) = row.get(t.key as usize).map(|c| crate::js::trim(c)).filter(|c| !c.is_empty()) {
                return safe_key(c);
            }
        }
        safe_key(&format!("row{}", i + 1))
    }

    pub fn extract_csv(text: &str) -> Vec<Unit> {
        let t = analyse(text);
        let mut out = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for (i, row) in t.rows.iter().enumerate() {
            if t.has_header && i == 0 {
                continue;
            }
            let source = row.get(t.source).map(String::as_str).unwrap_or("");
            if crate::js::trim(source).is_empty() {
                continue;
            }
            let mut key = key_of(&t, row, i);
            if seen.contains(&key) {
                key = format!("{key}#{}", i + 1);
            }
            seen.insert(key.clone());
            out.push(unit(key, source.to_string(), String::new(), UnitKind::Message, if t.key >= 0 { format!("рядок {}", i + 1) } else { String::new() }));
        }
        out
    }

    fn cell_out(c: &str, delim: char) -> String {
        if c.contains(delim) || c.contains(['"', '\n', '\r']) || c != crate::js::trim(c) { format!("\"{}\"", c.replace('"', "\"\"")) } else { c.to_string() }
    }

    pub fn apply_csv(text: &str, tr: &Translations) -> String {
        let t = analyse(text);
        let mut target = t.target;
        let mut rows: Vec<Vec<String>> = t.rows.clone();
        if target < 0 {
            target = rows.iter().map(|r| r.len()).max().unwrap_or(0).max(t.source + 1) as i64;
            if t.has_header {
                let r0 = &mut rows[0];
                while r0.len() <= target as usize {
                    r0.push(String::new());
                }
                r0[target as usize] = "translation".into();
            }
        }
        let target = target as usize;
        let mut seen: HashSet<String> = HashSet::new();
        #[allow(clippy::needless_range_loop)]
        for i in 0..rows.len() {
            if t.has_header && i == 0 {
                continue;
            }
            if crate::js::trim(rows[i].get(t.source).map(String::as_str).unwrap_or("")).is_empty() {
                continue;
            }
            let mut key = key_of(&t, &rows[i], i);
            if seen.contains(&key) {
                key = format!("{key}#{}", i + 1);
            }
            seen.insert(key.clone());
            if let Some(v) = target_of(tr, &key) {
                while rows[i].len() <= target {
                    rows[i].push(String::new());
                }
                rows[i][target] = v.to_string();
            }
        }
        let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
        let delim = t.delim.to_string();
        let body: String = rows
            .iter()
            .map(|r| {
                let mut full = r.clone();
                while full.len() < width {
                    full.push(String::new());
                }
                full.iter().map(|c| cell_out(c, t.delim)).collect::<Vec<_>>().join(&delim)
            })
            .collect::<Vec<_>>()
            .join(t.eol)
            + t.eol;
        format!("{}{body}", if t.bom { BOM.to_string() } else { String::new() })
    }
}

/* ---------- gettext ---------- */

pub mod po {
    use super::*;

    /// Запис каталогу gettext (заголовок має порожній msgid).
    #[derive(Clone, Debug)]
    struct PoEntry {
        /// Рядки перед msgid: коментарі, посилання, прапорці. Зберігаються як є.
        lead: Vec<String>,
        ctxt: Option<String>,
        id: String,
        plural: Option<String>,
        strs: Vec<Option<String>>,
        obsolete: bool,
    }
    fn fresh() -> PoEntry {
        PoEntry { lead: vec![], ctxt: None, id: String::new(), plural: None, strs: vec![], obsolete: false }
    }

    static ESC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\\(n|t|r|"|\\)"#).unwrap());
    fn unq(s: &str) -> String {
        let t = crate::js::trim(s);
        let chars: Vec<char> = t.chars().collect();
        let body: String = if chars.len() >= 2 { chars[1..chars.len() - 1].iter().collect() } else { String::new() };
        ESC.replace_all(&body, |c: &regex::Captures| match &c[1] {
            "n" => "\n".to_string(),
            "t" => "\t".to_string(),
            "r" => "\r".to_string(),
            "\"" => "\"".to_string(),
            _ => "\\".to_string(),
        })
        .into_owned()
    }
    fn q(s: &str) -> String {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\t', "\\t").replace('\r', "\\r"))
    }

    static FIELD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^(msgctxt|msgid_plural|msgid|msgstr(?:\[([0-9]+)\])?)\s+(".*")$"#).unwrap());

    #[derive(Clone, Copy, PartialEq)]
    enum Field {
        Ctxt,
        Id,
        Plural,
        Str(usize),
    }

    fn parse(text: &str) -> (Vec<PoEntry>, &'static str) {
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let mut entries: Vec<PoEntry> = Vec::new();
        let mut cur: Option<PoEntry> = None;
        let mut field: Option<Field> = None;
        let flush = |cur: &mut Option<PoEntry>, entries: &mut Vec<PoEntry>, field: &mut Option<Field>| {
            if let Some(c) = cur.take() {
                if !c.id.is_empty() || !c.strs.is_empty() || !c.lead.is_empty() {
                    entries.push(c);
                }
            }
            *field = None;
        };
        let body = text.strip_prefix(BOM).unwrap_or(text);
        for raw in split_lines(body) {
            let line = crate::js::trim(raw);
            if line.is_empty() {
                flush(&mut cur, &mut entries, &mut field);
                continue;
            }
            if line.starts_with("#~") {
                let c = cur.get_or_insert_with(fresh);
                c.lead.push(raw.to_string());
                c.obsolete = true;
                continue;
            }
            if line.starts_with('#') {
                if cur.as_ref().is_some_and(|c| !c.strs.is_empty()) {
                    flush(&mut cur, &mut entries, &mut field);
                }
                cur.get_or_insert_with(fresh).lead.push(raw.to_string());
                continue;
            }
            if let Some(m) = FIELD.captures(line) {
                let kind = &m[1];
                if cur.as_ref().is_some_and(|c| !c.strs.is_empty()) && (kind == "msgid" || kind == "msgctxt") {
                    flush(&mut cur, &mut entries, &mut field);
                }
                let c = cur.get_or_insert_with(fresh);
                let val = unq(&m[3]);
                if kind == "msgctxt" {
                    c.ctxt = Some(val);
                    field = Some(Field::Ctxt);
                } else if kind == "msgid" {
                    c.id = val;
                    field = Some(Field::Id);
                } else if kind == "msgid_plural" {
                    c.plural = Some(val);
                    field = Some(Field::Plural);
                } else {
                    let i = m.get(2).map_or(0, |g| g.as_str().parse::<usize>().unwrap_or(0));
                    if c.strs.len() <= i {
                        c.strs.resize(i + 1, None);
                    }
                    c.strs[i] = Some(val);
                    field = Some(Field::Str(i));
                }
                continue;
            }
            if line.starts_with('"') {
                if let (Some(c), Some(f)) = (cur.as_mut(), field) {
                    let val = unq(line);
                    match f {
                        Field::Ctxt => c.ctxt = Some(c.ctxt.take().unwrap_or_default() + &val),
                        Field::Id => c.id.push_str(&val),
                        Field::Plural => c.plural = Some(c.plural.take().unwrap_or_default() + &val),
                        Field::Str(i) => c.strs[i] = Some(c.strs[i].take().unwrap_or_default() + &val),
                    }
                }
            }
        }
        flush(&mut cur, &mut entries, &mut field);
        (entries, eol)
    }

    fn serialize(entries: &[PoEntry], eol: &str) -> String {
        let blocks: Vec<String> = entries
            .iter()
            .map(|e| {
                let mut out: Vec<String> = e.lead.clone();
                if e.obsolete {
                    return out.join(eol);
                }
                if let Some(c) = &e.ctxt {
                    out.push(format!("msgctxt {}", q(c)));
                }
                out.push(format!("msgid {}", q(&e.id)));
                if let Some(p) = &e.plural {
                    out.push(format!("msgid_plural {}", q(p)));
                    for (i, s) in e.strs.iter().enumerate() {
                        if let Some(s) = s {
                            out.push(format!("msgstr[{i}] {}", q(s)));
                        }
                    }
                } else {
                    out.push(format!("msgstr {}", q(e.strs.first().and_then(|s| s.as_deref()).unwrap_or(""))));
                }
                out.join(eol)
            })
            .collect();
        format!("{}{eol}", blocks.join(&format!("{eol}{eol}")))
    }

    fn base_key(e: &PoEntry) -> String {
        safe_key(&format!("{}{}", e.ctxt.as_ref().map_or(String::new(), |c| format!("{c}::")), e.id))
    }
    fn is_header(e: &PoEntry) -> bool {
        e.id.is_empty() && e.ctxt.is_none()
    }
    fn nplurals(entries: &[PoEntry]) -> usize {
        static N: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"nplurals\s*=\s*([0-9]+)").unwrap());
        entries.iter().find(|e| is_header(e)).and_then(|e| e.strs.first().and_then(|s| s.as_deref())).and_then(|s| N.captures(s)).and_then(|m| m[1].parse().ok()).unwrap_or(2)
    }

    pub fn extract_po(text: &str) -> Vec<Unit> {
        let (entries, _) = parse(text);
        let mut out = Vec::new();
        for e in &entries {
            if is_header(e) || e.obsolete || crate::js::trim(&e.id).is_empty() {
                continue;
            }
            let reference = e.lead.iter().find(|l| l.starts_with("#:")).map(|l| crate::js::trim(&l[2..]).to_string()).unwrap_or_default();
            let context = e.ctxt.clone().unwrap_or(reference);
            if let Some(pl) = &e.plural {
                out.push(unit(format!("{}#0", base_key(e)), e.id.clone(), String::new(), UnitKind::Message, context.clone()));
                out.push(unit(format!("{}#1", base_key(e)), pl.clone(), String::new(), UnitKind::Message, context));
            } else {
                out.push(unit(base_key(e), e.id.clone(), String::new(), UnitKind::Message, context));
            }
        }
        out
    }

    /// Заповнює msgstr з перекладів; усе інше в каталозі зберігається. Форми множини після другої беруть текст другої.
    pub fn apply_po(text: &str, tr: &Translations) -> String {
        let (mut entries, eol) = parse(text);
        let n = nplurals(&entries);
        for e in entries.iter_mut() {
            if is_header(e) || e.obsolete {
                continue;
            }
            if e.plural.is_some() {
                let (one, many) = (target_of(tr, &format!("{}#0", base_key(e))), target_of(tr, &format!("{}#1", base_key(e))));
                if one.is_none() && many.is_none() {
                    continue;
                }
                let old = e.strs.clone();
                let at = |i: usize| old.get(i).and_then(|s| s.clone());
                e.strs = (0..n.max(2))
                    .map(|i| {
                        Some(if i == 0 {
                            one.map(String::from).or_else(|| at(0)).unwrap_or_default()
                        } else {
                            many.map(String::from).or_else(|| at(i)).or_else(|| at(1)).unwrap_or_default()
                        })
                    })
                    .collect();
            } else if let Some(t) = target_of(tr, &base_key(e)) {
                e.strs = vec![Some(t.to_string())];
            }
        }
        serialize(&entries, eol)
    }
}

/* ---------- Ren'Py ---------- */

pub mod renpy {
    use super::*;

    static NOT_SPEECH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(define|default|image|label|menu|python|init|scene|show|hide|play|queue|stop|pause|return|jump|call|if|elif|else|while|transform|screen|style|translate|voice|nvl|window|with|pass|renpy|config|gui|text|textbutton|action|add|use|key|layout|at|on|label|old|new)(?-u:\b)").unwrap());
    const STR: &str = r#""((?:[^"\\]|\\.)*)""#;
    static SPEECH: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^(\s*)(?:([A-Za-z_][A-Za-z0-9_.]*)\s+|{STR}\s+)?{STR}(\s+with\s+[A-Za-z0-9_]+)?\s*$")).unwrap());
    static CHOICE: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^(\s*){STR}(\s+if\s+.+?)?\s*:\s*$")).unwrap());
    static PYBLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(init\s+(-?[0-9]+\s+)?)?python(?-u:\b).*:\s*$").unwrap());

    /// Екранування рядків Ren'Py ↔ текст, який редагує перекладач (справжні лапки й переноси).
    pub fn unescape_renpy(s: &str) -> String {
        static E: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\\(n|"|\\|')"#).unwrap());
        E.replace_all(s, |c: &regex::Captures| if &c[1] == "n" { "\n".to_string() } else { c[1].to_string() }).into_owned()
    }
    pub fn escape_renpy(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    }

    struct Hit {
        line: usize,
        choice: bool,
        speaker: String,
        text: String,
        start: usize,
        end: usize,
    }

    fn scan(text: &str) -> (Vec<String>, &'static str, Vec<Hit>) {
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let body = text.strip_prefix(BOM).unwrap_or(text);
        let lines: Vec<String> = split_lines(body).into_iter().map(String::from).collect();
        let mut hits = Vec::new();
        let (mut triple, mut py_indent): (bool, i64) = (false, -1);
        for (i, raw) in lines.iter().enumerate() {
            if raw.matches("\"\"\"").count() % 2 == 1 {
                triple = !triple;
                continue;
            }
            if triple {
                continue;
            }
            let trimmed = crate::js::trim(raw);
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let indent = (raw.chars().count() - raw.trim_start_matches(crate::js::is_space).chars().count()) as i64;
            if py_indent >= 0 {
                if indent > py_indent {
                    continue;
                }
                py_indent = -1;
            }
            if PYBLOCK.is_match(trimmed) {
                py_indent = indent;
                continue;
            }
            if trimmed.starts_with('$') {
                continue;
            }
            if let Some(c) = CHOICE.captures(raw) {
                if !NOT_SPEECH.is_match(trimmed) {
                    let g = c.get(2).unwrap();
                    hits.push(Hit { line: i, choice: true, speaker: String::new(), text: unescape_renpy(g.as_str()), start: g.start(), end: g.end() });
                    continue;
                }
            }
            if let Some(m) = SPEECH.captures(raw) {
                if !(m.get(2).is_some() && NOT_SPEECH.is_match(trimmed)) {
                    let g = m.get(4).unwrap();
                    let speaker = match (m.get(2), m.get(3)) {
                        (Some(s), _) => s.as_str().to_string(),
                        (None, Some(q)) => unescape_renpy(q.as_str()),
                        _ => String::new(),
                    };
                    hits.push(Hit { line: i, choice: false, speaker, text: unescape_renpy(g.as_str()), start: g.start(), end: g.end() });
                }
            }
        }
        (lines, eol, hits)
    }

    pub fn extract_renpy(text: &str) -> Vec<Unit> {
        scan(text).2.into_iter().filter(|h| has_text(&h.text)).map(|h| unit(format!("L{}", h.line + 1), h.text, h.speaker, if h.choice { UnitKind::Choice } else { UnitKind::Dialogue }, format!("рядок {}", h.line + 1))).collect()
    }

    pub fn apply_renpy(text: &str, tr: &Translations) -> String {
        let (mut lines, eol, hits) = scan(text);
        for h in hits {
            let Some(t) = target_of(tr, &format!("L{}", h.line + 1)) else { continue };
            let raw = lines[h.line].clone();
            lines[h.line] = format!("{}{}{}", &raw[..h.start], escape_renpy(t), &raw[h.end..]);
        }
        lines.join(eol)
    }
}

/* ---------- JSON локалізації ---------- */

pub mod localejson {
    use super::*;

    /// Назви, що зазвичай тримають рядки інтерфейсу чи діалоги (en.json, locales/uk.json, strings.json, i18n/messages.json).
    pub fn looks_like_locale_file(name: &str) -> bool {
        static A: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|[\\/._-])(en|uk|ru|de|fr|es|lang|languages?|locales?|i18n|strings?|texts?|translations?|messages?|dialog(ue)?s?)([\\/._-]|$)").unwrap());
        static B: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(package(-lock)?|tsconfig|composer|manifest)\.json$").unwrap());
        let base = name.rsplit(['\\', '/']).next().unwrap_or(name);
        A.is_match(name) && !B.is_match(base)
    }

    pub fn extract_locale_json(json: &Value) -> Vec<Unit> {
        fn walk(v: &Value, path: &str, ctx: &str, out: &mut Vec<Unit>) {
            match v {
                Value::String(s) => {
                    if has_text(s) {
                        out.push(unit(safe_key(path), s.clone(), String::new(), UnitKind::Message, ctx.to_string()));
                    }
                }
                Value::Array(a) => {
                    for (i, x) in a.iter().enumerate() {
                        walk(x, &format!("{path}[{i}]"), ctx, out);
                    }
                }
                Value::Object(o) => {
                    for (k, x) in o {
                        walk(x, &if path.is_empty() { k.clone() } else { format!("{path}.{k}") }, if path.is_empty() { k } else { path }, out);
                    }
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(json, "", "", &mut out);
        out
    }

    pub fn apply_locale_json(json: &Value, tr: &Translations) -> Value {
        fn walk(v: &Value, path: &str, tr: &Translations) -> Value {
            match v {
                Value::String(s) => Value::String(target_of(tr, &safe_key(path)).map_or_else(|| s.clone(), String::from)),
                Value::Array(a) => Value::Array(a.iter().enumerate().map(|(i, x)| walk(x, &format!("{path}[{i}]"), tr)).collect()),
                Value::Object(o) => {
                    let mut m = Map::new();
                    for (k, x) in o {
                        m.insert(k.clone(), walk(x, &if path.is_empty() { k.clone() } else { format!("{path}.{k}") }, tr));
                    }
                    Value::Object(m)
                }
                other => other.clone(),
            }
        }
        walk(json, "", tr)
    }
}
