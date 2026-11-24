mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::commands::*;
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};

fn steps_of(v: &Value) -> Vec<ReplaceStep> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| ReplaceStep {
            find: s["find"].as_str().unwrap().into(),
            replace: s["replace"].as_str().unwrap().into(),
            whole_word: s.get("wholeWord").and_then(Value::as_bool) == Some(true),
            case_sensitive: s.get("caseSensitive").and_then(Value::as_bool) == Some(true),
        })
        .collect()
}

#[test]
fn steps_match() {
    for (i, c) in cases("commands", "runSteps").iter().enumerate() {
        let (after, count) = run_steps(c.input["text"].as_str().unwrap(), &steps_of(&c.input["steps"]));
        assert_same("runSteps", i, &c.input, &json!({ "after": after, "count": count }), &c.output);
    }
    for (i, c) in cases("commands", "planSteps").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<indexmap::IndexMap<String, Translations>>(&c.input, "files");
        let got = plan_steps(&views, &saved, &steps_of(&c.input["steps"]), c.input["limit"].as_u64().unwrap() as usize);
        assert_same("planSteps", i, &c.input, &to_value(&got), &c.output);
    }
}
