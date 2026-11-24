mod common;

use common::{assert_same, cases, to_value};
use serde_json::Value;
use transly_core::glossary::Term;
use transly_core::termusage::*;

#[test]
fn usage_matches() {
    for (i, c) in cases("termusage", "termUsage").iter().enumerate() {
        let views = c.input["views"].as_array().unwrap();
        let mut rows = Vec::new();
        for v in views {
            for u in v["units"].as_array().unwrap() {
                rows.push((v["name"].as_str().unwrap(), u["key"].as_str().unwrap(), u["source"].as_str().unwrap()));
            }
        }
        let index = WordIndex::of(rows);
        let files = &c.input["saved"]["files"];
        let target_of = |f: &str, k: &str| -> Option<&Value> { files.get(f).and_then(|m| m.get(k)).and_then(|e| e.get("target")) };
        let term: Term = serde_json::from_value(c.input["term"].clone()).unwrap();
        let skip = c.input["skip"].as_object().map(|o| TermUse { file: o["file"].as_str().unwrap().into(), key: o["key"].as_str().unwrap().into() });
        let got = term_usage(&index, |f, k| target_of(f, k).and_then(|t| t.as_str()), &term, skip.as_ref());
        assert_same("termUsage", i, &c.input, &to_value(&got), &c.output);
    }
}
