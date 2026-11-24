mod common;

use common::{assert_same, cases};
use serde_json::{json, Value};
use transly_core::manifest::*;

#[test]
fn manifest_matches() {
    for (i, c) in cases("manifest", "check").iter().enumerate() {
        let got = match check_manifest(&c.input["input"], c.input["builtin"].as_bool().unwrap()) {
            Checked::Ok { manifest, warnings } => json!({ "ok": true, "manifest": manifest, "warnings": warnings }),
            Checked::Err { errors } => json!({ "ok": false, "errors": errors }),
        };
        assert_same("check", i, &c.input, &got, &c.output);
    }
}

#[test]
fn helpers_match() {
    for (i, c) in cases("manifest", "safePath").iter().enumerate() {
        assert_same("safePath", i, &c.input, &json!(safe_path(&c.input)), &c.output);
    }
    for (i, c) in cases("manifest", "https").iter().enumerate() {
        assert_same("https", i, &c.input, &json!(is_https(Some(&c.input))), &c.output);
    }
    for (i, c) in cases("manifest", "compat").iter().enumerate() {
        let res = |r: Result<(), String>| match r {
            Ok(()) => json!({ "ok": true }),
            Err(reason) => json!({ "ok": false, "reason": reason }),
        };
        let got = json!({ "a": res(compatibility(&c.input, APP_VERSION, API_VERSION)), "b": res(compatibility(&c.input, "9.1.0", "2.0.0")) });
        assert_same("compat", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("manifest", "author").iter().enumerate() {
        assert_same("author", i, &c.input, &json!(author_of(&c.input)), &c.output);
    }
}

#[test]
fn json_errors_start_the_same() {
    // повідомлення розбірника JSON у Rust і JS різні: збігається лише початок
    match check_manifest(&Value::String("{broken".into()), false) {
        Checked::Err { errors } => assert!(errors[0].starts_with("Опис розширення не є JSON: ")),
        _ => panic!("мало бути помилкою"),
    }
}
