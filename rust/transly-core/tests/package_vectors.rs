mod common;

use common::{assert_same, cases};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::package::*;
use transly_core::zipread::read_zip;

fn bytes(v: &Value) -> Vec<u8> {
    v.as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u8).collect()
}

#[test]
fn zip_matches() {
    for (i, c) in cases("package", "readZip").iter().enumerate() {
        let got = match read_zip(&bytes(&c.input)) {
            Ok(m) => json!({ "ok": m.iter().map(|(n, b)| json!([n, b])).collect::<Vec<_>>() }),
            Err(e) => json!({ "error": e }),
        };
        assert_same("readZip", i, &json!(format!("{} байтів", c.input.as_array().unwrap().len())), &got, &c.output);
    }
}

#[test]
fn package_matches() {
    for (i, c) in cases("package", "package").iter().enumerate() {
        let entries: IndexMap<String, Vec<u8>> = c.input["entries"].as_array().unwrap().iter().map(|e| (e[0].as_str().unwrap().to_string(), bytes(&e[1]))).collect();
        let got = match build_package(&entries, false) {
            Built::Ok(p) => json!({ "ok": true, "manifest": p.manifest, "manifestText": p.manifest_text, "files": p.files.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(), "warnings": p.warnings }),
            Built::Err(errors) => json!({ "ok": false, "errors": errors }),
        };
        assert_same("package", i, &json!(entries.keys().collect::<Vec<_>>()), &got, &c.output);
    }
}
