mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use transly_core::model::{GameFile, Unit};
use transly_core::project::empty_project;
use transly_core::projname::*;
use transly_core::reference::*;
use transly_core::usage::*;

#[test]
fn usage_matches() {
    for (i, c) in cases("misc2", "usage").iter().enumerate() {
        let game: Vec<GameFile> = get(&c.input, "game");
        let labels: HashMap<String, String> = c.input["labels"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
        let u = build_usage(&game, &|f: &str| labels.get(f).cloned());
        let got: Vec<Value> = u.iter().map(|(k, v)| json!([k, v])).collect();
        assert_same("usage", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("misc2", "usageKey").iter().enumerate() {
        let a = c.input.as_array().unwrap();
        assert_same("usageKey", i, &c.input, &json!(usage_key(a[0].as_str().unwrap(), a[1].as_str().unwrap())), &c.output);
    }
}

#[test]
fn names_match() {
    for (i, c) in cases("misc2", "nameFromFolder").iter().enumerate() {
        assert_same("nameFromFolder", i, &c.input, &json!(name_from_folder(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("misc2", "title").iter().enumerate() {
        let mut p = empty_project(c.input["name"].as_str().unwrap(), "en", "uk");
        p.settings = c.input["settings"].as_object().unwrap().clone().into_iter().collect::<Map<String, Value>>();
        p.snapshot = (!c.input["snapshot"].is_null()).then(|| c.input["snapshot"].clone());
        let got = json!({ "game": game_title_of(p.snapshot.as_ref()), "source": name_source_of(&p).as_str(), "title": project_title(&p), "icon": icon_letters(&p) });
        assert_same("title", i, &c.input, &got, &c.output);
    }
}

#[test]
fn references_match() {
    for (i, c) in cases("misc2", "bundle").iter().enumerate() {
        let mut b: Option<ReferenceBundle> = (!c.input["start"].is_null()).then(|| get(&c.input, "start"));
        let mut states = Vec::new();
        for o in c.input["ops"].as_array().unwrap() {
            let lang = o["lang"].as_str().unwrap();
            if o["op"] == "add" {
                let set: ReferenceSet = serde_json::from_value(json!({ "lang": lang, "texts": { "a.json": { "k1": format!("{lang}1"), "k2": "x" } } })).unwrap();
                b = Some(with_reference(b.as_ref(), set));
            } else {
                b = without_reference(b.as_ref(), lang);
            }
            states.push(json!({ "b": b, "sets": reference_sets(b.as_ref()) }));
        }
        assert_same("bundle", i, &c.input, &json!(states), &c.output);
    }
    for (i, c) in cases("misc2", "align").iter().enumerate() {
        let units: Vec<Unit> = get(&c.input, "units");
        let r: Vec<Unit> = get(&c.input, "ref");
        assert_same("align", i, &c.input, &to_value(&align_reference(&units, &r)), &c.output);
    }
}
