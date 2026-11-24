mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::json;
use transly_core::mine::mine_constructions;
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};

#[test]
fn mine_matches() {
    for (i, c) in cases("mine", "mine").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<IndexMap<String, Translations>>(&c.input, "files");
        let terms: Vec<String> = c.input["terms"].as_array().unwrap().iter().map(|t| t["en"].as_str().unwrap().to_string()).collect();
        let mut pauses = 0;
        let res = mine_constructions(&views, &saved, &terms, &mut || pauses += 1, c.input["limit"].as_u64().unwrap() as usize, c.input["slice"].as_u64().unwrap() as usize);
        assert_same("mine", i, &json!({ "limit": c.input["limit"], "slice": c.input["slice"] }), &json!({ "res": to_value(&res), "pauses": pauses }), &c.output);
    }
}
