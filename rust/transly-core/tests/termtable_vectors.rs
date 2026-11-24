mod common;

use common::{assert_same, cases, to_value};
use serde_json::{json, Value};
use transly_core::termtable::*;

fn rows_of(v: &Value) -> Vec<Vec<String>> {
    v.as_array().unwrap().iter().map(|r| r.as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect()).collect()
}

#[test]
fn parsers_match() {
    for (i, c) in cases("termtable", "delimited").iter().enumerate() {
        assert_same("delimited", i, &c.input, &json!(parse_delimited(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("termtable", "html").iter().enumerate() {
        assert_same("html", i, &c.input, &json!(parse_html_table(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn terms_match() {
    for (i, c) in cases("termtable", "terms").iter().enumerate() {
        let t = terms_from_table(&rows_of(&c.input["rows"]), c.input["now"].as_i64().unwrap(), c.input["qa"].as_bool().unwrap());
        assert_same("terms", i, &c.input, &json!({ "terms": to_value(&t.terms), "skipped": t.skipped }), &c.output);
    }
}
