mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::model::Translations;
use transly_core::project::empty_project;
use transly_core::stamps::*;

fn kind(s: &str) -> StampKind {
    if s == "copy" { StampKind::Copy } else { StampKind::Build }
}
fn st(s: Option<Stamp>) -> Value {
    s.map_or(Value::Null, |s| {
        let mut m = json!({ "mt": s.mt, "how": s.how });
        if let Some(n) = s.n {
            m["n"] = json!(n);
        }
        m
    })
}

#[test]
fn ago_matches() {
    for (i, c) in cases("stamps", "ago").iter().enumerate() {
        assert_same("ago", i, &c.input, &json!(ago(c.input["mt"].as_f64().unwrap(), c.input["now"].as_f64().unwrap())), &c.output);
    }
}

#[test]
fn read_matches() {
    for (i, c) in cases("stamps", "read").iter().enumerate() {
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<indexmap::IndexMap<String, Translations>>(&c.input, "files");
        if !c.input["stamps"].is_null() {
            saved.extra.insert("stamps".into(), c.input["stamps"].clone());
        }
        let now = c.input["now"].as_f64().unwrap();
        let (text, warn) = copy_line(&saved, now, c.input["translated"].as_u64().unwrap() as usize);
        let got = json!({ "copy": st(stamp_of(&saved, StampKind::Copy)), "build": st(stamp_of(&saved, StampKind::Build)), "line": { "text": text, "warn": warn }, "drift": to_value(&built_drift(&saved, c.input["since"].as_i64().unwrap())) });
        assert_same("read", i, &c.input, &got, &c.output);
    }
}

#[test]
fn stamp_matches() {
    for (i, c) in cases("stamps", "stamp").iter().enumerate() {
        let mut saved = empty_project("p", "en", "uk");
        if !c.input["stamps"].is_null() {
            saved.extra.insert("stamps".into(), c.input["stamps"].clone());
        }
        for o in c.input["ops"].as_array().unwrap() {
            stamp(&mut saved, kind(o["kind"].as_str().unwrap()), o["how"].as_str().unwrap(), o["now"].as_i64().unwrap(), o.get("n").and_then(Value::as_i64));
        }
        assert_same("stamp", i, &c.input, &json!({ "stamps": saved.extra.get("stamps") }), &c.output);
    }
}
