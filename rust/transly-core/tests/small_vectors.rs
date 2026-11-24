mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::codes::explain_codes;
use transly_core::dictlinks::*;
use transly_core::gamenames::GameNameIndex;
use transly_core::hints::*;
use transly_core::model::{GameFile, PageInfo};
use transly_core::project::FileView;
use transly_core::qa::IssueCat;
use transly_core::sysnames::*;

fn names_json(n: &Option<SysNames>) -> Value {
    n.as_ref().map_or(Value::Null, |n| {
        let mut m = json!({ "variables": n.variables, "switches": n.switches });
        if let Some(c) = &n.currency {
            m["currency"] = json!(c);
        }
        m
    })
}

fn names_of(v: &Value) -> Option<SysNames> {
    (!v.is_null()).then(|| {
        let map = |k: &str| -> IndexMap<String, String> { v[k].as_object().unwrap().iter().map(|(a, b)| (a.clone(), b.as_str().unwrap().to_string())).collect() };
        SysNames { variables: map("variables"), switches: map("switches"), currency: v.get("currency").and_then(Value::as_str).map(String::from) }
    })
}

fn cat_of(s: &str) -> IssueCat {
    match s {
        "error" => IssueCat::Error,
        "term" => IssueCat::Term,
        "context" => IssueCat::Context,
        "style" => IssueCat::Style,
        _ => IssueCat::Info,
    }
}

#[test]
fn sysnames_match() {
    for (i, c) in cases("small", "sysNamesOf").iter().enumerate() {
        let files: Vec<GameFile> = serde_json::from_value(c.input.clone()).unwrap();
        assert_same("sysNamesOf", i, &c.input, &names_json(&sys_names_of(&files)), &c.output);
    }
    for (i, c) in cases("small", "describePage").iter().enumerate() {
        let p: PageInfo = get(&c.input, "p");
        let names = names_of(&c.input["names"]);
        assert_same("describePage", i, &c.input, &json!(describe_page(&p, names.as_ref())), &c.output);
    }
}

#[test]
fn codes_match() {
    for (i, c) in cases("small", "explainCodes").iter().enumerate() {
        let actors = c.input["actors"].as_object().unwrap().clone();
        let actor = |n: u64| actors.get(&n.to_string()).and_then(Value::as_str).map(String::from);
        let names = names_of(&c.input["names"]);
        let got = explain_codes(c.input["text"].as_str().unwrap(), &actor, names.as_ref());
        assert_same("explainCodes", i, &c.input, &to_value(&got), &c.output);
    }
}

#[test]
fn dictionaries_match() {
    for (i, c) in cases("small", "urls").iter().enumerate() {
        let w = c.input.as_str().unwrap();
        assert_same("urls", i, &c.input, &json!({ "goroh": goroh_url(w, "Тлумачення"), "syn": goroh_url(w, "Синоніми"), "mt": multitran_url(w) }), &c.output);
    }
    for (i, c) in cases("small", "wordsOf").iter().enumerate() {
        let got = words_of(c.input["t"].as_str().unwrap(), c.input["limit"].as_u64().unwrap() as usize);
        assert_same("wordsOf", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn hints_match() {
    for (i, c) in cases("small", "hintTables").iter().enumerate() {
        let order: Vec<&str> = HINT_ORDER.iter().map(|c| serde_json::to_value(c).unwrap().as_str().unwrap().to_string()).map(|s| &*Box::leak(s.into_boxed_str())).collect();
        let by = |f: fn(IssueCat) -> &'static str| -> Value { json!(HINT_ORDER.iter().map(|c| (serde_json::to_value(c).unwrap().as_str().unwrap().to_string(), f(*c))).collect::<IndexMap<_, _>>()) };
        let got = json!({ "order": order, "label": by(hint_label), "group": by(hint_group), "glyph": by(hint_glyph) });
        assert_same("hintTables", i, &Value::Null, &got, &c.output);
    }
    for (i, c) in cases("small", "hints").iter().enumerate() {
        let items: Vec<Value> = c.input.as_array().unwrap().clone();
        let cat = |v: &Value| cat_of(v["cat"].as_str().unwrap());
        let groups: Vec<Value> = group_hints(&items, cat).into_iter().map(|(k, v)| json!({ "cat": k, "items": v })).collect();
        assert_same("hints", i, &c.input, &json!({ "ordered": by_hint_order(&items, cat), "groups": groups }), &c.output);
    }
}

#[test]
fn game_names_match() {
    for (i, c) in cases("small", "gameNames").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let idx = GameNameIndex::new(&views, c.input["min"].as_u64().unwrap() as usize);
        let found: Vec<Value> = c.input["texts"].as_array().unwrap().iter().map(|t| to_value(&idx.find(t.as_str().unwrap()))).collect();
        assert_same("gameNames", i, &c.input, &json!({ "size": idx.size(), "found": found }), &c.output);
    }
}
