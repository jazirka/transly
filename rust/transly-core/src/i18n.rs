//! `ext/i18n.ts`: локалізація інтерфейсу. Рядки програми написані українською (мова-джерело), а пакет мови — каталог, що каже,
//! чим кожен з них є іншою мовою. Рядок шукається за його текстом («id повідомлення») у контексті: `core` для самої програми й
//! `plugin:<id>` для рядків плагіна. Каталог мови — сума шарів, які приносять її пакети (пізніше встановлений перемагає). Рядок,
//! якого в каталозі немає, показується мовою-джерелом, тож в інтерфейсі ніколи не буває дірки, і запам'ятовується, щоб перекладачеві
//! можна було дати список того, чого бракує.
//!
//! Переосмислено для рідного інтерфейсу: немає `translateText` (підстановка в уже намальований текст DOM), шаблонів з числами,
//! слів-лічильників і слухачів змін — рідний інтерфейс просто питає `t`/`tn` під час малювання.

use crate::collate::locale_compare;
use crate::pluralexpr::{known_plural, plural_fn, PluralFn};
use indexmap::IndexMap;
use regex::Regex;
use std::sync::LazyLock;

pub const CORE: &str = "core";
pub const SOURCE_LANGUAGE: &str = "uk";
const SEP: char = '\u{4}';

/// Параметри підстановки (`{name}` → значення), уже як рядки.
pub type Params = Vec<(String, String)>;

/// Один каталог, прочитаний з файла: записи мови за `контекстом` + id повідомлення.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CatalogData {
    pub language: Option<String>,
    pub name: Option<String>,
    pub plural: Option<String>,
    /// ключ (`контекст` + SEP + msgid) → форми перекладу (одна чи по одній на форму множини).
    pub entries: IndexMap<String, Vec<String>>,
}

pub fn key_of(msgid: &str, ctx: &str) -> String {
    format!("{ctx}{SEP}{msgid}")
}

static ESC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\\(n|t|r|"|\\)"#).unwrap());
fn unq(s: &str) -> String {
    let t = crate::js::trim(s);
    let ch: Vec<char> = t.chars().collect();
    let body: String = if ch.len() >= 2 { ch[1..ch.len() - 1].iter().collect() } else { String::new() };
    ESC.replace_all(&body, |c: &regex::Captures| match &c[1] {
        "n" => "\n".to_string(),
        "t" => "\t".to_string(),
        "r" => "\r".to_string(),
        "\"" => "\"".to_string(),
        _ => "\\".to_string(),
    })
    .into_owned()
}

static FIELD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^(msgctxt|msgid_plural|msgid|msgstr(?:\[([0-9]+)\])?)\s+(".*")$"#).unwrap());
static LANG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^Language:\s*(.+)$").unwrap());
static PLURAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"plural=([^;]+)").unwrap());
static TEAM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^Language-Team:\s*(.+)$").unwrap());
static FUZZY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#,.*(?-u:\b)fuzzy(?-u:\b)").unwrap());

#[derive(Default)]
struct Cur {
    ctx: Option<String>,
    id: String,
    strs: Vec<Option<String>>,
    fuzzy: bool,
    obsolete: bool,
}
#[derive(Clone, Copy)]
enum Field {
    Ctx,
    Id,
    Plural,
    Str(usize),
}

/// Читає каталог gettext `.po`/`.pot`. Записи з fuzzy, застарілі й без перекладу пропускаються.
pub fn parse_po_catalog(text: &str) -> CatalogData {
    let mut out = CatalogData::default();
    let mut cur: Option<Cur> = None;
    let mut field: Option<Field> = None;
    let mut any = false;
    fn flush(cur: &mut Option<Cur>, field: &mut Option<Field>, any: &mut bool, out: &mut CatalogData) {
        if let Some(c) = cur.take() {
            if *any && !c.obsolete {
                if c.id.is_empty() {
                    let head = c.strs.first().and_then(|s| s.as_deref()).unwrap_or("");
                    if let Some(l) = LANG.captures(head).map(|m| crate::js::trim(&m[1]).to_string()).filter(|l| !l.is_empty()) {
                        out.language = Some(l.replacen('_', "-", 1));
                    }
                    if let Some(p) = PLURAL.captures(head).map(|m| crate::js::trim(&m[1]).to_string()).filter(|p| !p.is_empty()) {
                        out.plural = Some(p);
                    }
                    if let Some(n) = TEAM.captures(head).map(|m| crate::js::trim(&m[1]).to_string()).filter(|n| !n.is_empty()) {
                        if out.name.is_none() {
                            out.name = Some(n);
                        }
                    }
                } else if !c.fuzzy && c.strs.iter().flatten().any(|s| !s.is_empty()) {
                    out.entries.insert(key_of(&c.id, c.ctx.as_deref().unwrap_or(CORE)), c.strs.iter().map(|s| s.clone().unwrap_or_default()).collect());
                }
            }
        }
        *field = None;
        *any = false;
    }
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    for raw in body.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)) {
        let line = crate::js::trim(raw);
        if line.is_empty() {
            flush(&mut cur, &mut field, &mut any, &mut out);
            continue;
        }
        if line.starts_with("#~") {
            cur.get_or_insert_with(Cur::default).obsolete = true;
            continue;
        }
        if line.starts_with('#') {
            if cur.is_some() && any {
                flush(&mut cur, &mut field, &mut any, &mut out);
            }
            let c = cur.get_or_insert_with(Cur::default);
            if FUZZY.is_match(line) {
                c.fuzzy = true;
            }
            continue;
        }
        if let Some(m) = FIELD.captures(line) {
            let kind = &m[1];
            if cur.as_ref().is_some_and(|c| !c.strs.is_empty()) && (kind == "msgid" || kind == "msgctxt") {
                flush(&mut cur, &mut field, &mut any, &mut out);
            }
            let c = cur.get_or_insert_with(Cur::default);
            any = true;
            let v = unq(&m[3]);
            if kind == "msgctxt" {
                c.ctx = Some(v);
                field = Some(Field::Ctx);
            } else if kind == "msgid" {
                c.id = v;
                field = Some(Field::Id);
            } else if kind == "msgid_plural" {
                field = Some(Field::Plural);
            } else {
                let i = m.get(2).map_or(0, |g| g.as_str().parse::<usize>().unwrap_or(0));
                if c.strs.len() <= i {
                    c.strs.resize(i + 1, None);
                }
                c.strs[i] = Some(v);
                field = Some(Field::Str(i));
            }
            continue;
        }
        if line.starts_with('"') {
            if let (Some(c), Some(f)) = (cur.as_mut(), field) {
                let v = unq(line);
                match f {
                    Field::Ctx => c.ctx = Some(c.ctx.take().unwrap_or_default() + &v),
                    Field::Id => c.id.push_str(&v),
                    Field::Plural => {}
                    Field::Str(i) => c.strs[i] = Some(c.strs[i].take().unwrap_or_default() + &v),
                }
            }
        }
    }
    flush(&mut cur, &mut field, &mut any, &mut out);
    out
}

/// Читає каталог, записаний як JSON: `{ language, plural, messages: { id: text | [forms] }, contexts: { "plugin:x": { id: text } } }`.
pub fn parse_json_catalog(text: &str) -> CatalogData {
    let mut out = CatalogData::default();
    let Ok(serde_json::Value::Object(o)) = serde_json::from_str::<serde_json::Value>(text) else { return out };
    if let Some(s) = o.get("language").and_then(|v| v.as_str()) {
        out.language = Some(s.into());
    }
    if let Some(s) = o.get("name").and_then(|v| v.as_str()) {
        out.name = Some(s.into());
    }
    if let Some(s) = o.get("plural").and_then(|v| v.as_str()) {
        out.plural = Some(s.into());
    }
    let mut take = |ctx: &str, m: Option<&serde_json::Value>| {
        let Some(serde_json::Value::Object(m)) = m else { return };
        for (id, v) in m {
            let forms: Vec<String> = match v {
                serde_json::Value::String(s) => vec![s.clone()],
                serde_json::Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                _ => vec![],
            };
            if !id.is_empty() && forms.iter().any(|s| !s.is_empty()) {
                out.entries.insert(key_of(id, ctx), forms);
            }
        }
    };
    take(CORE, o.get("messages"));
    if let Some(serde_json::Value::Object(c)) = o.get("contexts") {
        for (ctx, m) in c {
            take(ctx, Some(m));
        }
    }
    out
}

/// Каталог у файлі за його назвою.
pub fn parse_catalog(name: &str, text: &str) -> CatalogData {
    if name.to_lowercase().ends_with(".json") { parse_json_catalog(text) } else { parse_po_catalog(text) }
}

fn subst(s: &str, p: &Params) -> String {
    static P: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{([A-Za-z0-9_]+)\}").unwrap());
    if p.is_empty() {
        return s.to_string();
    }
    P.replace_all(s, |c: &regex::Captures| p.iter().find(|(k, _)| k == &c[1]).map_or_else(|| c[0].to_string(), |(_, v)| v.clone())).into_owned()
}

struct Layer {
    origin: String,
    entries: IndexMap<String, Vec<String>>,
}
struct Lang {
    code: String,
    name: String,
    plural: PluralFn,
    plural_expr: String,
    layers: Vec<Layer>,
}

fn is_cyrillic(s: &str) -> bool {
    s.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
}

/// Стан мови інтерфейсу.
pub struct I18n {
    langs: IndexMap<String, Lang>,
    active: String,
    chain: Vec<String>,
    miss: IndexMap<String, Missing>,
    /// Коли false, рядки, яких не знайдено, не запам'ятовуються.
    pub capture: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Missing {
    pub ctx: String,
    pub id: String,
    pub sample: String,
}

impl Default for I18n {
    fn default() -> Self {
        I18n { langs: IndexMap::new(), active: SOURCE_LANGUAGE.into(), chain: vec![], miss: IndexMap::new(), capture: true }
    }
}

impl I18n {
    pub fn new() -> I18n {
        I18n::default()
    }

    /// Мова й шар її каталога (рядки одного пакета). Той самий `origin` заміняє свій попередній шар.
    pub fn add(&mut self, code: &str, data: CatalogData, origin: &str, name: Option<&str>) {
        let base = code.split('-').next().unwrap_or(code);
        let l = self.langs.entry(code.to_string()).or_insert_with(|| Lang { code: code.to_string(), name: name.map(String::from).or_else(|| data.name.clone()).unwrap_or_else(|| code.to_string()), plural: plural_fn("0").unwrap(), plural_expr: String::new(), layers: vec![] });
        let expr = data.plural.clone().unwrap_or_else(|| l.plural_expr.clone());
        l.plural_expr = if !expr.is_empty() { expr } else { known_plural(base).map_or_else(|| "n != 1".to_string(), String::from) };
        l.plural = plural_fn(&l.plural_expr).or_else(|| plural_fn(known_plural(base).unwrap_or("n != 1"))).unwrap_or_else(|| plural_fn("0").unwrap());
        if let Some(n) = name.filter(|n| !n.is_empty()) {
            l.name = n.to_string();
        }
        l.layers.retain(|x| x.origin != origin);
        l.layers.push(Layer { origin: origin.to_string(), entries: data.entries });
        // мова-код у `Lang` лишається ключем
        let _ = &l.code;
    }

    /// Рядки, які приніс пакет, забираються (плагін вимкнено чи видалено).
    pub fn remove(&mut self, origin: &str) {
        for l in self.langs.values_mut() {
            l.layers.retain(|x| x.origin != origin);
        }
        self.langs.retain(|_, l| !l.layers.is_empty());
        if !self.langs.contains_key(&self.active) && self.active != SOURCE_LANGUAGE {
            self.set_language(SOURCE_LANGUAGE, &[]);
        }
    }

    /// Мови, що мають каталог, мова-джерело першою.
    pub fn languages(&self) -> Vec<(String, String)> {
        let mut rest: Vec<(String, String)> = self.langs.values().filter(|l| l.code != SOURCE_LANGUAGE).map(|l| (l.code.clone(), l.name.clone())).collect();
        rest.sort_by(|a, b| locale_compare(&a.1, &b.1));
        let mut out = vec![(SOURCE_LANGUAGE.to_string(), "Українська".to_string())];
        out.extend(rest);
        out
    }

    pub fn language(&self) -> &str {
        &self.active
    }

    /// Перемикає мову інтерфейсу; рядки шукаються в ній, далі в мовах після неї (`fr-CA` → `fr`), далі в джерелі.
    pub fn set_language(&mut self, code: &str, fallback: &[String]) {
        let base: Vec<String> = if self.active == code && code.contains('-') { vec![code.split('-').next().unwrap().to_string()] } else { vec![] };
        let short = code.split('-').next().unwrap().to_string();
        self.active = [code.to_string(), short].into_iter().find(|c| c == SOURCE_LANGUAGE || self.langs.contains_key(c)).unwrap_or_else(|| SOURCE_LANGUAGE.to_string());
        let mut chain: Vec<String> = Vec::new();
        for c in std::iter::once(self.active.clone()).chain(base).chain(fallback.iter().cloned()) {
            if !chain.contains(&c) && self.langs.contains_key(&c) {
                chain.push(c);
            }
        }
        self.chain = chain;
    }

    fn lookup(&self, key: &str) -> Option<&Vec<String>> {
        for code in &self.chain {
            let l = &self.langs[code];
            for layer in l.layers.iter().rev() {
                if let Some(f) = layer.entries.get(key).filter(|f| f.iter().any(|s| !s.is_empty())) {
                    return Some(f);
                }
            }
        }
        None
    }

    /// Рядок мовою інтерфейсу, з `{name}`, заміненим на `params`.
    pub fn t(&mut self, msgid: &str, params: &Params, ctx: &str) -> String {
        let f = if self.chain.is_empty() { None } else { self.lookup(&key_of(msgid, ctx)).cloned() };
        if f.is_none() && self.active != SOURCE_LANGUAGE {
            self.remember(msgid, ctx, msgid);
        }
        subst(f.as_ref().and_then(|f| f.first()).map_or(msgid, |s| s.as_str()), params)
    }

    /// Рядок із числом: `forms` — форми мови-джерела (одна, кілька, багато), переклад має форми своєї мови.
    pub fn tn(&mut self, forms: &[&str], n: i64, params: &Params, ctx: &str) -> String {
        let mut p: Params = vec![("n".into(), n.to_string())];
        p.extend(params.iter().cloned());
        let key = key_of(forms[0], ctx);
        let f = if self.chain.is_empty() { None } else { self.lookup(&key).cloned() };
        if let Some(f) = f {
            let code = self.chain.iter().find(|c| self.langs[*c].layers.iter().any(|x| x.entries.get(&key).is_some_and(|v| v.iter().any(|s| !s.is_empty())))).unwrap();
            let idx = self.langs[code].plural.call(n as f64).min(f.len() - 1);
            return subst(f.get(idx).or(f.first()).unwrap(), &p);
        }
        if self.active != SOURCE_LANGUAGE {
            self.remember(forms[0], ctx, forms[0]);
        }
        let (m10, m100) = (n % 10, n % 100);
        let i = if m10 == 1 && m100 != 11 { 0 } else if (2..=4).contains(&m10) && !(12..=14).contains(&m100) { 1 } else { 2 };
        subst(forms[i.min(forms.len() - 1)], &p)
    }

    pub fn has(&self, msgid: &str, ctx: &str) -> bool {
        self.lookup(&key_of(msgid, ctx)).is_some()
    }

    fn remember(&mut self, id: &str, ctx: &str, sample: &str) {
        if !self.capture || !is_cyrillic(id) {
            return;
        }
        let key = key_of(id, ctx);
        if self.miss.contains_key(&key) || self.miss.len() >= 5000 {
            return;
        }
        self.miss.insert(key, Missing { ctx: ctx.into(), id: id.into(), sample: sample.into() });
    }

    /// Рядки, яких питали й не знайшли, — для перекладача.
    pub fn missing(&self) -> Vec<Missing> {
        self.miss.values().cloned().collect()
    }
    pub fn forget_missing(&mut self) {
        self.miss.clear();
    }

    /// Пакет мови як шаблон `.po`.
    pub fn template(&self, lang: &str, items: &[Missing]) -> String {
        let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\t', "\\t"));
        let head = format!("msgid \"\"\nmsgstr \"\"\n\"Content-Type: text/plain; charset=UTF-8\\n\"\n\"Language: {lang}\\n\"\n\"Plural-Forms: nplurals=2; plural=(n != 1);\\n\"\n\"X-Source-Language: {SOURCE_LANGUAGE}\\n\"\n");
        let body: String = items
            .iter()
            .map(|i| format!("\n{}msgctxt {}\nmsgid {}\nmsgstr \"\"\n", if i.id != i.sample { format!("#. {}\n", i.sample.replace('\n', " ")) } else { String::new() }, q(&i.ctx), q(&i.id)))
            .collect();
        head + &body
    }
}
