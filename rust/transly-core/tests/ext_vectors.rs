mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::i18n::*;
use transly_core::model::GameFile;
use transly_core::pluralexpr::plural_fn;
use transly_core::readgame::{labels_of, read_game};
use transly_core::rpgmaker::ExtractOptions;
use transly_core::semver::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn entries(c: &CatalogData) -> Value {
    json!({ "language": c.language, "name": c.name, "plural": c.plural, "entries": c.entries.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>() })
}

#[test]
fn versions_match() {
    for (i, c) in cases("ext", "parseVersion").iter().enumerate() {
        let got = parse_version(c.input.as_str().unwrap()).map(|v| json!({ "major": v.major, "minor": v.minor, "patch": v.patch, "pre": v.pre }));
        assert_same("parseVersion", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("ext", "compare").iter().enumerate() {
        assert_same("compare", i, &c.input, &json!(compare_versions(s(&c.input, "a"), s(&c.input, "b"))), &c.output);
    }
    for (i, c) in cases("ext", "validRange").iter().enumerate() {
        assert_same("validRange", i, &c.input, &json!(valid_range(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("ext", "satisfies").iter().enumerate() {
        assert_same("satisfies", i, &c.input, &json!(satisfies(s(&c.input, "v"), s(&c.input, "rg"))), &c.output);
    }
}

#[test]
fn plural_matches() {
    for (i, c) in cases("ext", "plural").iter().enumerate() {
        let got = plural_fn(c.input.as_str().unwrap()).map(|f| {
            let mut v: Vec<usize> = (0..130).map(|n| f.call(n as f64)).collect();
            v.extend([f.call(1000.0), f.call(1001.0), f.call(-3.0), f.call(2.7)]);
            v
        });
        assert_same("plural", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn catalogs_match() {
    for (i, c) in cases("ext", "catalog").iter().enumerate() {
        let (name, text) = (s(&c.input, "name"), s(&c.input, "text"));
        let got = json!({ "parsed": entries(&parse_catalog(name, text)), "po": entries(&parse_po_catalog(text)), "json": entries(&parse_json_catalog(text)) });
        assert_same("catalog", i, &c.input, &got, &c.output);
    }
}

#[test]
fn i18n_matches() {
    for (i, c) in cases("ext", "i18n").iter().enumerate() {
        let mut l = I18n::new();
        let mut log: Vec<Value> = Vec::new();
        for op in c.input["ops"].as_array().unwrap() {
            match s(op, "kind") {
                "add" => {
                    l.add(s(op, "code"), parse_catalog(s(op, "file"), s(op, "text")), s(op, "origin"), op["name"].as_str());
                    log.push(Value::Null);
                }
                "remove" => {
                    l.remove(s(op, "origin"));
                    log.push(json!({ "lang": l.language() }));
                }
                "set" => {
                    let fb: Vec<String> = get(op, "fb");
                    l.set_language(s(op, "code"), &fb);
                    log.push(json!({ "lang": l.language() }));
                }
                _ => {
                    let (word, ctx, num) = (s(op, "word"), s(op, "ctx"), op["num"].as_i64().unwrap());
                    let params: Params = if op["withParams"].as_bool().unwrap() { vec![("n".into(), num.to_string()), ("name".into(), "Zed".into()), ("count".into(), "3".into()), ("total".into(), "9".into())] } else { vec![] };
                    let (w2, w3) = (format!("{word}и"), format!("{word}ів"));
                    log.push(json!({ "t": l.t(word, &params, ctx), "tn": l.tn(&[word, &w2, &w3], num, &params, ctx), "has": l.has(word, ctx) }));
                }
            }
        }
        let missing: Vec<Value> = l.missing().iter().map(|m| json!({ "ctx": m.ctx, "id": m.id, "sample": m.sample })).collect();
        let got = json!({
            "log": log, "language": l.language(),
            "languages": l.languages().iter().map(|(c, n)| json!({ "code": c, "name": n })).collect::<Vec<_>>(),
            "missing": missing, "template": l.template("xx", &l.missing()),
        });
        assert_same("i18n", i, &c.input, &got, &c.output);
    }
}

#[test]
fn read_game_matches() {
    for (i, c) in cases("ext", "readGame").iter().enumerate() {
        let files: Vec<GameFile> = get(&c.input, "files");
        let opts = ExtractOptions { plugin_commands: c.input["opts"]["pluginCommands"].as_array().map_or(vec![], |a| a.iter().map(|x| x.as_str().unwrap().into()).collect()) };
        let views = read_game(&files, &opts);
        let got = json!({ "views": to_value(&views), "labels": labels_of(&views) });
        assert_same("readGame", i, &c.input, &got, &c.output);
    }
}
