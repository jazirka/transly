mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::ingest::*;
use transly_core::model::{Translations, Unit};
use transly_core::project::FileView;
use transly_core::tm::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}

#[test]
fn similarity_matches() {
    for (i, c) in cases("tm", "similarity").iter().enumerate() {
        let min = c.input["min"].as_f64().unwrap();
        assert_same("similarity", i, &c.input, &json!(similarity(s(&c.input, "a"), s(&c.input, "b"), min)), &c.output);
    }
}

#[test]
fn index_matches() {
    for (i, c) in cases("tm", "index").iter().enumerate() {
        let mut idx = TmIndex::new(c.input["flow"].as_bool().unwrap());
        for e in c.input["entries"].as_array().unwrap() {
            idx.add(serde_json::from_value(e.clone()).unwrap());
        }
        let mut results: Vec<Value> = Vec::new();
        for q in c.input["queries"].as_array().unwrap() {
            let excl = q["excl"].as_str().map(String::from);
            let f = |e: &TmEntry| excl.as_deref() == Some(e.t.as_str());
            let opts = FindOpts { min: q["min"].as_f64(), limit: q["limit"].as_u64().map(|l| l as usize), exclude: excl.as_ref().map(|_| &f as &dyn Fn(&TmEntry) -> bool) };
            results.push(to_value(&idx.find(s(q, "q"), &opts)));
        }
        let searches: Vec<Value> = c.input["searches"].as_array().unwrap().iter().map(|q| to_value(&idx.search(s(q, "q"), q["limit"].as_u64().unwrap() as usize))).collect();
        assert_same("index", i, &c.input, &json!({ "size": idx.size(), "results": results, "searches": searches }), &c.output);
    }
}

#[test]
fn align_matches() {
    let k = &cases("ingest", "consts")[0].output;
    assert_eq!(k["GONE"], json!(GONE));
    assert_eq!(k["parked"], json!([is_parked(&format!("a{GONE}")), is_parked("a")]));
    for (i, c) in cases("ingest", "align").iter().enumerate() {
        let (a, b): (Vec<String>, Vec<String>) = (get(&c.input, "a"), get(&c.input, "b"));
        let got = align_sources(&a, &b, c.input["maxEdits"].as_u64().unwrap() as usize);
        assert_same("align", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn plan_matches() {
    for (i, c) in cases("ingest", "plan").iter().enumerate() {
        let snap: Option<IndexMap<String, Vec<Unit>>> = if c.input["snap"].is_null() { None } else { Some(get(&c.input, "snap")) };
        let views: Vec<FileView> = get(&c.input, "views");
        let files: IndexMap<String, Translations> = get(&c.input, "files");
        let plan = plan_ingest(snap.as_ref(), &views, &files, c.input["now"].as_i64().unwrap());
        let got = json!({
            "plan": to_value(&plan),
            "count": ingest_count(&plan.report),
            "quiet": ingest_quiet(&plan.report),
            "note": ingest_note(&plan.report),
            "another": looks_like_another_game(snap.as_ref(), &views, &files),
        });
        assert_same("plan", i, &c.input, &got, &c.output);
    }
}
