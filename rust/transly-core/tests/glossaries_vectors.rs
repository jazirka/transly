mod common;

use common::{assert_same, cases};
use serde_json::{json, Value};
use transly_core::glossaries::*;
use transly_core::project::empty_project;

fn brought(v: &Value) -> Vec<BroughtTerm> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|t| BroughtTerm {
            en: t["en"].as_str().unwrap().into(),
            uk: t["uk"].as_str().unwrap().into(),
            alt: t.get("alt").map(|a| a.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()),
            note: t.get("note").map(|n| n.as_str().unwrap().to_string()),
        })
        .collect()
}

#[test]
fn glossary_terms_match() {
    for (i, c) in cases("glossaries", "glossaryTerms").iter().enumerate() {
        let (terms, skipped) = glossary_terms(&c.input["g"], c.input["text"].as_str().unwrap());
        assert_same("glossaryTerms", i, &c.input, &json!({ "terms": terms, "skipped": skipped }), &c.output);
    }
}

#[test]
fn import_matches() {
    for (i, c) in cases("glossaries", "import").iter().enumerate() {
        let terms: Vec<Value> = c.input["terms"].as_array().unwrap().clone();
        let b = brought(&c.input["brought"]);
        let plan = plan_glossary_import(&terms, &b);
        let mut saved = empty_project("p", "en", "uk");
        saved.terms = terms;
        let n = apply_glossary_import(&mut saved, &plan, 500);
        let got = json!({ "plan": plan, "n": n, "terms": saved.terms, "deletedTerms": saved.deleted_terms.map_or(Value::Null, Value::Object) });
        assert_same("import", i, &c.input, &got, &c.output);
    }
}
