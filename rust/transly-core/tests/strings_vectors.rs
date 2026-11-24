mod common;

use common::{assert_same, cases};
use serde_json::json;
use transly_core::strings::*;

#[test]
fn strings_match() {
    for (i, c) in cases("strings", "strings").iter().enumerate() {
        let files = c.input["files"].as_object().unwrap();
        let read = |p: &str| files.get(p).and_then(|v| v.as_str()).map(String::from);
        let got = json!({ "strings": plugin_strings(&c.input["m"], &read), "template": plugin_template(&c.input["m"], c.input["lang"].as_str().unwrap(), &read) });
        assert_same("strings", i, &c.input, &got, &c.output);
    }
}
