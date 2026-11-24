mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::autofill::*;
use transly_core::autolog::*;
use transly_core::compose::*;
use transly_core::journal::SavedFiles;
use transly_core::project::{FileView, SavedProject};

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn pairs<A: serde::Serialize, B: serde::Serialize>(m: impl IntoIterator<Item = (A, B)>) -> Value {
    Value::Array(m.into_iter().map(|(a, b)| json!([a, b])).collect())
}

#[test]
fn small_pieces_match() {
    for (i, c) in cases("autofill", "tokenize").iter().enumerate() {
        assert_same("tokenize", i, &c.input, &to_value(&tokenize(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("autofill", "plausible").iter().enumerate() {
        assert_same("plausible", i, &c.input, &json!(plausible(s(&c.input, "source"), s(&c.input, "target"))), &c.output);
    }
    for (i, c) in cases("autofill", "adjLemma").iter().enumerate() {
        assert_same("adjLemma", i, &c.input, &json!(adj_lemma(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn learning_and_composing_match() {
    for (i, c) in cases("autofill", "learn").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let p: SavedProject = get(&c.input, "p");
        let drafts = c.input["drafts"].as_bool().unwrap();
        let opts = FillOpts { drafts };
        let learned = learn_detailed(&views, &p, opts);
        let rows: Vec<Value> = views
            .iter()
            .flat_map(|v| v.units.iter().map(move |u| (v, u)))
            .map(|(v, u)| {
                let e = p.files.get(&v.name).and_then(|f| f.get(&u.key));
                json!({ "key": u.key, "trusted": trusted(e, drafts), "auto": is_auto_filled(e) })
            })
            .collect();
        let whole: IndexMap<String, String> = c.output["whole"].as_array().unwrap().iter().map(|x| (x[0].as_str().unwrap().to_string(), x[1].as_str().unwrap().to_string())).collect();
        let lex = build_lexicon(&whole, &learned.dict, &p);
        let lines: Vec<Option<String>> = views.iter().flat_map(|v| v.units.iter()).map(|u| compose_line(&u.source, &lex, &p, 10)).collect();
        let got = json!({
            "dict": pairs(learned.dict.iter()),
            "ambiguous": pairs(learned.ambiguous.iter().map(|(k, v)| (k.clone(), v.iter().map(|(a, n)| json!([a, n])).collect::<Vec<_>>()))),
            "whole": c.output["whole"],
            "rows": rows,
            "lex": pairs(lex.iter().map(|(k, e)| (k.clone(), json!({ "uk": e.uk, "adj": e.adj })))),
            "lines": lines,
            "proposals": to_value(&proposals(&views, &p, None, 500, opts)),
            "proposalsSmall": to_value(&proposals(&views, &p, Some(&learned.dict), 3, opts)),
            "almost": to_value(&almost(&views, &p, None, 200)),
            "almostSmall": to_value(&almost(&views, &p, Some(&learned), 2)),
        });
        assert_same("learn", i, &c.input, &got, &c.output);
    }
}

#[test]
fn autolog_matches() {
    for (i, c) in cases("autofill", "autolog").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let mut copy = files.clone();
        let batches = auto_batches(&views, &files, c.input["limit"].as_u64().unwrap() as usize);
        let done: Vec<usize> = batches.iter().map(|b| undo_auto(&mut copy, b, "Анна", 5000)).collect();
        let got = json!({
            "batches": to_value(&batches),
            "done": done,
            "after": to_value(&copy),
            "undone": to_value(&auto_undone(&views, &copy, 10)),
            "undoneSmall": to_value(&auto_undone(&views, &copy, 1)),
            "notes": [auto_note(0), auto_note(3)],
        });
        assert_same("autolog", i, &c.input, &got, &c.output);
    }
}
