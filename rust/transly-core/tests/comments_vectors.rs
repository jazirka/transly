mod common;

use common::{assert_same, cases, to_value};
use serde_json::{json, Value};
use transly_core::comments::*;
use transly_core::model::{Comment, Entry};

#[test]
fn threads_match() {
    for (i, c) in cases("comments", "threads").iter().enumerate() {
        let comments: Option<Vec<Comment>> = (!c.input.is_null()).then(|| serde_json::from_value(c.input.clone()).unwrap());
        let entry = comments.clone().map(|cs| Entry { comments: Some(cs), ..Entry::blank() });
        let got = json!({ "threads": to_value(&threads_of(comments.as_deref())), "open": open_threads(entry.as_ref()) });
        assert_same("threads", i, &c.input, &got, &c.output);
    }
}

#[test]
fn ops_match() {
    for (i, c) in cases("comments", "ops").iter().enumerate() {
        let mut e: Option<Entry> = (!c.input["entry"].is_null()).then(|| serde_json::from_value(c.input["entry"].clone()).unwrap());
        let mut states: Vec<Value> = Vec::new();
        for o in c.input["ops"].as_array().unwrap() {
            let (id, now) = (o["id"].as_str().unwrap(), o["now"].as_i64().unwrap());
            let s = |k: &str| o[k].as_str().unwrap();
            if o["op"] == "reply" {
                e = Some(reply_to(e.as_ref(), id, s("who"), s("text"), now));
            } else if let Some(cur) = e.as_ref() {
                e = Some(match o["op"].as_str().unwrap() {
                    "resolve" => resolve_thread(cur, id, o["on"].as_bool().unwrap(), s("who"), now),
                    "edit" => edit_comment(cur, id, s("text"), now),
                    _ => delete_comment(cur, id, now),
                });
            } else {
                states.push(Value::Null);
                continue;
            }
            states.push(to_value(e.as_ref().unwrap()));
        }
        let got = json!({ "states": states, "threads": to_value(&threads_of(e.as_ref().and_then(|e| e.comments.as_deref()))) });
        assert_same("ops", i, &c.input, &got, &c.output);
    }
}
