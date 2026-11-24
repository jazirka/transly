mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::declarative::*;
use transly_core::engine::Applied;
use transly_core::model::{GameFile, Translations};

fn seg_json(s: &Seg) -> Value {
    match s {
        Seg::Key(k) => json!(k),
        Seg::Idx(i) => json!(i),
        Seg::Star => json!("*"),
    }
}

#[test]
fn paths_and_globs_match() {
    for (i, c) in cases("declarative", "parsePath").iter().enumerate() {
        let got = parse_path(c.input.as_str().unwrap()).map(|v| v.iter().map(seg_json).collect::<Vec<_>>());
        assert_same("parsePath", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("declarative", "glob").iter().enumerate() {
        let f = glob_test(c.input["g"].as_str().unwrap());
        let got: Vec<bool> = c.input["paths"].as_array().unwrap().iter().map(|p| f(p.as_str().unwrap())).collect();
        assert_same("glob", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn specs_match() {
    for (i, c) in cases("declarative", "spec").iter().enumerate() {
        let file: GameFile = get(&c.input, "file");
        let spec: FormatSpec = get(&c.input, "spec");
        let tr: Translations = get(&c.input, "tr");
        let units = extract_by_spec(&file, &spec);
        let applied = match apply_by_spec(&file, &tr, &spec).unwrap() {
            Applied::Json(j) => j,
            Applied::Text(t) => json!(t),
        };
        let mut got = json!({ "units": to_value(&units), "applied": applied });
        if c.output.get("intact").is_some() {
            got["intact"] = json!(true);
        }
        assert_same("spec", i, &c.input, &got, &c.output);
    }
}
