mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::journal::*;
use transly_core::model::Entry;
use transly_core::plan::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn opt(v: &Value) -> Option<Entry> {
    if v.is_null() { None } else { Some(serde_json::from_value(v.clone()).unwrap()) }
}
/// Джерело випадкових чисел із вектора: ті самі числа, що їх видав підмінений Math.random.
fn rands(v: &Value) -> impl FnMut() -> u32 {
    let list: Vec<u32> = v["rands"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u32).collect();
    let mut i = 0;
    move || {
        let r = list.get(i).copied().unwrap_or(0);
        i += 1;
        r
    }
}
fn batch_of(v: &Value) -> JournalBatch {
    JournalBatch {
        id: s(v, "id").into(),
        kind: s(v, "kind").into(),
        at: v["at"].as_i64().unwrap(),
        items: v["items"].as_array().unwrap().iter().map(|_| JournalItem { file: String::new(), key: String::new(), source: String::new(), target: String::new(), at: 0 }).collect(),
        total: 0,
        what: s(v, "what").into(),
    }
}

#[test]
fn small_pieces_match() {
    let k = &cases("journal", "kinds")[0].output;
    assert_eq!(k["kinds"], json!(BATCH_KINDS));
    for kind in BATCH_KINDS {
        let (what, _) = batch_info(kind).unwrap();
        assert_eq!(k["info"][kind]["what"], json!(what), "{kind}");
        assert_eq!(k["info"][kind]["title"], json!(batch_title_of(kind, "N").unwrap()), "{kind}");
    }
    for (i, c) in cases("journal", "prevOf").iter().enumerate() {
        let e = opt(&c.input);
        assert_same("prevOf", i, &c.input, &to_value(&prev_of(e.as_ref())), &c.output);
    }
    for (i, c) in cases("journal", "newBatch").iter().enumerate() {
        let mut r = rands(&c.input);
        assert_same("newBatch", i, &c.input, &json!(new_batch(s(&c.input, "kind"), c.input["now"].as_i64().unwrap(), &mut r)), &c.output);
    }
    for (i, c) in cases("journal", "recordChange").iter().enumerate() {
        let before = opt(&c.input["before"]);
        let after: Entry = get(&c.input, "after");
        let batch = c.input["batch"].as_str();
        let got = record_change(before.as_ref(), &after, s(&c.input, "what"), s(&c.input, "text"), s(&c.input, "who"), c.input["now"].as_i64().unwrap(), batch);
        assert_same("recordChange", i, &c.input, &to_value(&got), &c.output);
    }
}

#[test]
fn journal_matches() {
    for (i, c) in cases("journal", "journalBatches").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let got = journal_batches(&views, &files, c.input["limit"].as_u64().unwrap() as usize);
        assert_same("journalBatches", i, &c.input, &to_value(&got), &c.output);
    }
    for (i, c) in cases("journal", "undoJournal").iter().enumerate() {
        let mut files: SavedFiles = get(&c.input, "files");
        let mut r = rands(&c.input);
        let res = undo_journal(&mut files, s(&c.input, "id"), s(&c.input, "who"), c.input["now"].as_i64().unwrap(), &mut r);
        let got = json!({ "res": to_value(&res), "files": to_value(&files), "report": undo_report(&res) });
        assert_same("undoJournal", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("journal", "commitRows").iter().enumerate() {
        let mut files: SavedFiles = get(&c.input, "files");
        let changes: Vec<RowChange> = get(&c.input, "changes");
        let mut r = rands(&c.input);
        let batch = commit_rows(&mut files, &changes, s(&c.input, "kind"), s(&c.input, "who"), c.input["now"].as_i64().unwrap(), c.input["what"].as_str(), &mut r);
        assert_same("commitRows", i, &c.input, &json!({ "batch": batch, "files": to_value(&files) }), &c.output);
    }
}

#[test]
fn titles_match() {
    for (i, c) in cases("journal", "batchTitle").iter().enumerate() {
        let b = batch_of(&c.input);
        assert_same("batchTitle", i, &c.input, &json!({ "title": batch_title(&b), "label": batch_undo_label(&b) }), &c.output);
    }
    for (i, c) in cases("journal", "undoReport").iter().enumerate() {
        let r = UndoResult { done: c.input["done"].as_u64().unwrap() as usize, skipped: c.input["skipped"].as_u64().unwrap() as usize, kind: s(&c.input, "kind").into(), batch: String::new() };
        assert_same("undoReport", i, &c.input, &json!(undo_report(&r)), &c.output);
    }
}

#[test]
fn plan_matches() {
    for (i, c) in cases("journal", "planOf").iter().enumerate() {
        let files: SavedFiles = get(&c.input, "files");
        let changes: Vec<RowChange> = get(&c.input, "changes");
        let protect = if s(&c.input, "protect") == "skip" { Protect::Skip } else { Protect::Include };
        let plan = plan_of(&files, &changes, s(&c.input, "kind"), protect);
        let msgs: Vec<String> = [0, 1, 5, 12].iter().map(|&n| plan_message(&plan, n)).collect();
        assert_same("planOf", i, &c.input, &json!({ "plan": to_value(&plan), "note": plan_note(&plan), "messages": msgs }), &c.output);
    }
    for (i, c) in cases("journal", "reconcileChanges").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let (changes, changed) = reconcile_changes(&views, &files, c.input["now"].as_i64().unwrap());
        assert_same("reconcileChanges", i, &c.input, &json!({ "changes": to_value(&changes), "changed": changed }), &c.output);
    }
}
