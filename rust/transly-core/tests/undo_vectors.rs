mod common;

use common::{assert_same, cases, get};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};
use transly_core::undosend::*;
use transly_core::undostack::UndoStack;

#[test]
fn sends_match() {
    for (i, c) in cases("undo", "send").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<IndexMap<String, Translations>>(&c.input, "files");
        let limit = c.input["limit"].as_u64().unwrap() as usize;
        let batches = send_batches(&views, &saved, limit);
        let undone = undone_batches(&views, &saved, c.input["undoneLimit"].as_u64().unwrap() as usize);
        let counts: Vec<usize> = c.input["which"].as_array().unwrap().iter().enumerate().map(|(k, bi)| undo_batch(&mut saved, &batches[bi.as_u64().unwrap() as usize], "me", 1_700_000_000_000 + 10_000_000 + k as i64)).collect();
        let got = json!({
            "batches": batches, "undone": undone, "counts": counts, "after": saved.files,
            "again": send_batches(&views, &saved, limit), "undoneAfter": undone_batches(&views, &saved, 10),
        });
        assert_same("send", i, &c.input, &got, &c.output);
    }
}

#[test]
fn stack_matches() {
    for (i, c) in cases("undo", "stack").iter().enumerate() {
        let mut s = UndoStack::new(c.input["limit"].as_u64().unwrap() as usize);
        let mut log: Vec<Value> = Vec::new();
        for o in c.input["ops"].as_array().unwrap() {
            let id = o.get("id").and_then(Value::as_str).unwrap_or("");
            match o["op"].as_str().unwrap() {
                "record" => {
                    s.record(id);
                    log.push(Value::Null);
                }
                "takeUndo" => log.push(s.take_undo().map_or(Value::Null, Value::from)),
                "takeRedo" => log.push(s.take_redo().map_or(Value::Null, Value::from)),
                "undone" => {
                    s.undone(o["orig"].as_str().unwrap(), id);
                    log.push(Value::Null);
                }
                "redone" => {
                    s.redone(o["orig"].as_str().unwrap(), id);
                    log.push(Value::Null);
                }
                "seed" => {
                    let list: Vec<String> = o["list"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
                    s.seed(&list);
                    log.push(Value::Null);
                }
                _ => {
                    s.clear();
                    log.push(Value::Null);
                }
            }
            log.push(json!({ "canUndo": s.can_undo(), "canRedo": s.can_redo(), "used": s.used }));
        }
        let mut du = Vec::new();
        let mut dr = Vec::new();
        for _ in 0..60 {
            if !s.can_undo() {
                break;
            }
            du.push(s.take_undo());
        }
        for _ in 0..60 {
            if !s.can_redo() {
                break;
            }
            dr.push(s.take_redo());
        }
        assert_same("stack", i, &c.input, &json!({ "log": log, "drainU": du, "drainR": dr }), &c.output);
    }
}
