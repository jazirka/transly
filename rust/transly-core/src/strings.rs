//! `ext/strings.ts`: рядки, які плагін показує користувачеві (з маніфесту й файлів довідки), і шаблон `.po` для їх перекладу.
//! Власні рядки плагіна живуть у контексті `plugin:<id>`; мовний пакет може їх перекласти без участі автора плагіна.

use crate::js;
use indexmap::IndexSet;
use serde_json::Value;

/// Рядки плагіна в порядку появи, без повторів. `read` читає файл пакета за шляхом.
pub fn plugin_strings(m: &Value, read: &dyn Fn(&str) -> Option<String>) -> Vec<String> {
    let mut out: IndexSet<String> = IndexSet::new();
    let mut add = |v: Option<&Value>| {
        if let Some(s) = v.and_then(Value::as_str).filter(|s| !js::trim(s).is_empty()) {
            out.insert(s.to_string());
        }
    };
    add(m.get("name"));
    add(m.get("description"));
    let c = m.get("contributes");
    let list = |k: &str| c.and_then(|c| c.get(k)).and_then(Value::as_array).cloned().unwrap_or_default();
    for f in list("formats") {
        add(f.get("label"));
    }
    for e in list("engines") {
        add(e.get("label"));
        add(e.get("description"));
    }
    for h in list("help") {
        add(h.get("title"));
        let body = h.get("body").filter(|b| !b.is_null());
        match body {
            Some(b) => add(Some(b)),
            None => {
                let file = h.get("file").and_then(Value::as_str).filter(|f| !f.is_empty());
                let text = file.and_then(read).map(Value::from);
                add(text.as_ref());
            }
        }
    }
    for s in list("settings") {
        add(s.get("title"));
        add(s.get("description"));
        for f in s.get("fields").and_then(Value::as_array).into_iter().flatten() {
            add(f.get("label"));
            add(f.get("description"));
            for o in f.get("options").and_then(Value::as_array).into_iter().flatten() {
                add(o.get("label"));
            }
        }
    }
    out.into_iter().collect()
}

fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\t', "\\t"))
}

/// Шаблон `.po` рядків плагіна, щоб перекласти їх мовою `lang`.
pub fn plugin_template(m: &Value, lang: &str, read: &dyn Fn(&str) -> Option<String>) -> String {
    let s = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let source = m.get("sourceLanguage").and_then(Value::as_str).map_or("en".to_string(), String::from);
    let head = format!(
        "msgid \"\"\nmsgstr \"\"\n\"Content-Type: text/plain; charset=UTF-8\\n\"\n\"Language: {lang}\\n\"\n\"Plural-Forms: nplurals=2; plural=(n != 1);\\n\"\n\"X-Source-Language: {source}\\n\"\n\"X-Plugin: {} {}\\n\"\n",
        s("id"),
        s("version")
    );
    let ctx = q(&format!("plugin:{}", s("id")));
    let body: String = plugin_strings(m, read).iter().map(|t| format!("\nmsgctxt {ctx}\nmsgid {}\nmsgstr \"\"\n", q(t))).collect();
    head + &body
}
