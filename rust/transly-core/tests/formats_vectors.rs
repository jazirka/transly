mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use std::rc::Rc;
use transly_core::branches::*;
use transly_core::build::*;
use transly_core::engine::*;
use transly_core::journal::SavedFiles;
use transly_core::keys::*;
use transly_core::model::{GameFile, Translations};
use transly_core::project::{empty_project, FileView, SavedProject};
use transly_core::qa::QaOptions;
use transly_core::qaconfig::qa_of;
use transly_core::rpgmaker::*;
use transly_core::wrap::WrapPlan;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn game(v: &Value) -> GameFile {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("файл гри: {e}\n{v}"))
}
fn applied_json(a: &Applied) -> Value {
    match a {
        Applied::Json(j) => j.clone(),
        Applied::Text(t) => json!(t),
    }
}

#[test]
fn small_pieces_match() {
    for (i, c) in cases("formats", "canon").iter().enumerate() {
        let n = c.input.as_str().unwrap();
        let base = n.rsplit(['\\', '/']).next().unwrap();
        assert_same("canon", i, &c.input, &json!({ "canon": canonical_rpgmaker_name(n), "is": is_rpgmaker_file(base) }), &c.output);
    }
    for (i, c) in cases("formats", "hasText").iter().enumerate() {
        assert_same("hasText", i, &c.input, &json!(has_text(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("formats", "splitCmd").iter().enumerate() {
        let (name, prefix, text) = split_plugin_command(c.input.as_str().unwrap());
        assert_same("splitCmd", i, &c.input, &json!({ "name": name, "prefix": prefix, "text": text }), &c.output);
    }
    for (i, c) in cases("formats", "safeKey").iter().enumerate() {
        assert_same("safeKey", i, &c.input, &json!(safe_key(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("formats", "edges").iter().enumerate() {
        let (a, b) = (s(&c.input, "s"), s(&c.input, "t"));
        let (se, te) = (edges_of(a), edges_of(b));
        assert_same("edges", i, &c.input, &json!({ "with": with_edges(a, b), "s": { "lead": se.0, "tail": se.1 }, "t": { "lead": te.0, "tail": te.1 } }), &c.output);
    }
    for (i, c) in cases("formats", "format").iter().enumerate() {
        assert_same("format", i, &c.input, &json!(format_of(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn rpgmaker_matches() {
    for (i, c) in cases("formats", "rpg").iter().enumerate() {
        let file = game(&c.input["file"]);
        let opts = ExtractOptions { plugin_commands: c.input["opts"]["pluginCommands"].as_array().map_or(vec![], |a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect()) };
        let tr: Translations = get(&c.input, "tr");
        let units = extract(&file, &opts);
        let before = file.json.clone();
        let applied = apply(&file, &tr);
        let got = json!({ "units": to_value(&units), "applied": applied_json(&applied), "untouched": file.json == before, "fmt": format_of(&file.name), "text": is_text_format(format_of(&file.name)) });
        assert_same("rpg", i, &c.input, &got, &c.output);
    }
}

#[test]
fn text_formats_match() {
    for (i, c) in cases("formats", "text").iter().enumerate() {
        let file = game(&c.input["file"]);
        let tr: Translations = get(&c.input, "tr");
        let units = extract(&file, &ExtractOptions::default());
        let applied = apply(&file, &tr);
        let got = json!({ "units": to_value(&units), "applied": applied_json(&applied), "fmt": format_of(&file.name) });
        assert_same("text", i, &c.input, &got, &c.output);
    }
}

fn len7() -> transly_core::wrap::Measure {
    Rc::new(|t: &str| (t.chars().count() * 7) as f64)
}

#[test]
fn build_matches() {
    for (i, c) in cases("formats", "build").iter().enumerate() {
        let files: Vec<GameFile> = get(&c.input, "game");
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved: SavedProject = empty_project("x", "en", "uk");
        saved.files = get::<SavedFiles>(&c.input, "files");
        let o = &c.input["opts"];
        let wrap = (!o["qa"]["wrap"].is_null()).then(|| {
            let w = &o["qa"]["wrap"];
            WrapPlan { settings: get(w, "settings"), limit: w["limit"].as_f64().unwrap(), disabled: w["disabled"].as_bool().unwrap(), measure: w["measure"].as_bool().unwrap().then(len7) }
        });
        let rules = (!o["qa"]["settings"].is_null()).then(|| qa_of(Some(&o["qa"]["settings"])));
        let qa = QaOptions { tolerance_pct: 25.0, terms: vec![], line_limit: None, wrap, rules };
        let opts = BuildOptions { only_approved: o["onlyApproved"].as_bool().unwrap(), include_drafts: o["includeDrafts"].as_bool().unwrap(), block_errors: o["blockErrors"].as_bool().unwrap(), qa };
        let r = build(&files, &views, &saved, &opts);
        assert_same("build", i, &c.input, &to_value(&r), &c.output);
    }
}

#[test]
fn branch_diff_matches() {
    for (i, c) in cases("formats", "diff").iter().enumerate() {
        let p: SavedProject = serde_json::from_value(c.input["p"].clone()).unwrap();
        let source = s(&c.input, "source");
        let (rows, err) = match diff_branches(&p, source) {
            Ok(r) => (r, Value::Null),
            Err(e) => (vec![], json!(e)),
        };
        let pick = s(&c.input, "pick").to_string();
        let decide = move |x: &DiffRow| -> Option<Decision> {
            let l = row_id(&x.file, &x.key).encode_utf16().count();
            match pick.as_str() {
                "default" => default_decision(x),
                "all-theirs" => Some(Decision::Theirs),
                "all-custom" => Some(Decision::Custom(if l % 2 == 1 { "cust".into() } else { String::new() })),
                _ => match l % 3 {
                    0 => None,
                    1 => Some(Decision::Mine),
                    _ => Some(Decision::Theirs),
                },
            }
        };
        let plan = plan_merge(&p, &rows, &decide, c.input["now"].as_i64().unwrap());
        let ids: Vec<String> = rows.iter().map(|r| row_id(&r.file, &r.key)).collect();
        let got = json!({ "err": err, "rows": to_value(&rows), "cur": branch_of(&p), "plan": to_value(&plan), "ids": ids });
        assert_same("diff", i, &c.input, &got, &c.output);
    }
}
