mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Map, Value};
use transly_core::findreplace::*;
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};
use transly_core::termedit::*;

#[test]
fn find_replace_matches() {
    for (i, c) in cases("findreplace", "findReplace").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        let files: indexmap::IndexMap<String, Translations> = get(&c.input, "files");
        saved.files = files;
        let o = &c.input["o"];
        let opts = FindOptions { find: o["find"].as_str().unwrap().into(), replace: o["replace"].as_str().unwrap().into(), case_sensitive: o["caseSensitive"].as_bool().unwrap(), whole_word: o["wholeWord"].as_bool().unwrap() };
        let got = find_replace(&views, &saved, &opts, c.input["limit"].as_u64().unwrap() as usize);
        assert_same("findReplace", i, &c.input, &to_value(&got), &c.output);
    }
}

#[test]
fn literal_pattern_matches() {
    for (i, c) in cases("findreplace", "literal").iter().enumerate() {
        let re = literal_pattern(c.input["f"].as_str().unwrap(), c.input["ww"].as_bool().unwrap(), c.input["cs"].as_bool().unwrap());
        let got: Vec<Value> = c.input["hay"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| {
                let h = h.as_str().unwrap();
                json!(re.find_iter(h).flatten().map(|m| json!([h[..m.start()].encode_utf16().count(), m.as_str()])).collect::<Vec<_>>())
            })
            .collect();
        assert_same("literal", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn terms_match() {
    for (i, c) in cases("findreplace", "terms").iter().enumerate() {
        let mut terms: Vec<Value> = get(&c.input, "terms");
        let mut deleted: Option<Map<String, Value>> = c.input.get("deleted").and_then(|d| d.as_object().cloned());
        let mut results = Vec::new();
        let mut now = 100;
        for op in c.input["ops"].as_array().unwrap() {
            now += 1;
            if op["op"] == "remove" {
                results.push(json!(remove_term_in(&mut terms, &mut deleted, op["en"].as_str().unwrap(), now)));
            } else {
                let f = &op["form"];
                let s = |k: &str| f.get(k).and_then(Value::as_str).map(String::from);
                let form = TermForm { en: s("en").unwrap(), uk: s("uk").unwrap(), alt: s("alt"), kind: s("kind"), note: s("note"), qa: f.get("qa").and_then(Value::as_bool), gender: s("gender") };
                let r = save_term_in(&mut terms, &mut deleted, &form, now, op.get("was").and_then(Value::as_str));
                results.push(match r {
                    None => Value::Null,
                    Some(SaveResult::Added) => json!("added"),
                    Some(SaveResult::Changed) => json!("changed"),
                    Some(SaveResult::Exists) => json!("exists"),
                });
            }
        }
        let got = json!({ "results": results, "terms": terms, "deletedTerms": deleted.map_or(Value::Null, Value::Object) });
        assert_same("terms", i, &c.input, &got, &c.output);
    }
}
