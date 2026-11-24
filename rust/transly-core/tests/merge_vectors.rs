mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::merge::{merge, merge_entry};
use transly_core::model::{next_mt, Entry, Status, Translations, Unit, UnitKind};
use transly_core::variants::*;
use transly_core::workflow::*;

fn unit(source: &str) -> Unit {
    Unit { key: "k".into(), source: source.into(), speaker: String::new(), face: None, event: None, note: None, db_note: None, page: None, kind: UnitKind::Dialogue, context: String::new() }
}
fn opt_entry(v: &Value) -> Option<Entry> {
    if v.is_null() { None } else { Some(serde_json::from_value(v.clone()).unwrap()) }
}
fn opt_str(v: &Value) -> Option<String> {
    v.as_str().map(String::from)
}

#[test]
fn next_mt_matches() {
    for (i, c) in cases("merge", "nextMt").iter().enumerate() {
        let prev = c.input["prev"].as_i64();
        let now = c.input["now"].as_i64().unwrap();
        assert_same("nextMt", i, &c.input, &json!(next_mt(prev, now)), &c.output);
    }
}

#[test]
fn known_status_matches() {
    for (i, c) in cases("merge", "knownStatus").iter().enumerate() {
        let got = to_value(&Status::known(c.input.as_str().unwrap()));
        assert_same("knownStatus", i, &c.input, &got, &c.output);
    }
}

#[test]
fn hashes_and_ids_match() {
    for (i, c) in cases("merge", "variantId").iter().enumerate() {
        assert_same("variantId", i, &c.input, &json!(variant_id(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("merge", "commentId").iter().enumerate() {
        let cm = serde_json::from_value(c.input.clone()).unwrap();
        assert_same("commentId", i, &c.input, &json!(comment_id(&cm)), &c.output);
    }
    for (i, c) in cases("merge", "voteId").iter().enumerate() {
        let v = serde_json::from_value(c.input.clone()).unwrap();
        assert_same("voteId", i, &c.input, &json!(vote_id(&v)), &c.output);
    }
    assert_eq!(cases("merge", "constants")[0].output["HISTORY_LIMIT"], json!(HISTORY_LIMIT));
}

#[test]
fn variants_match() {
    for (i, c) in cases("merge", "sentVariants").iter().enumerate() {
        let e = opt_entry(&c.input);
        assert_same("sentVariants", i, &c.input, &to_value(&sent_variants(e.as_ref())), &c.output);
    }
    for (i, c) in cases("merge", "tallyOf").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        let t = tally_of(Some(&e), c.input["id"].as_str().unwrap(), c.input["who"].as_str().unwrap());
        assert_same("tallyOf", i, &c.input, &to_value(&t), &c.output);
    }
    for (i, c) in cases("merge", "castVote").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        let r = cast_vote(&e, c.input["id"].as_str().unwrap(), c.input["who"].as_str().unwrap(), c.input["v"].as_i64().unwrap() as i8, c.input["now"].as_i64().unwrap());
        assert_same("castVote", i, &c.input, &to_value(&r), &c.output);
    }
    for (i, c) in cases("merge", "setDropped").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        let r = set_dropped(&e, c.input["id"].as_str().unwrap(), c.input["who"].as_str().unwrap(), c.input["off"].as_bool().unwrap(), c.input["now"].as_i64().unwrap());
        assert_same("setDropped", i, &c.input, &to_value(&r), &c.output);
    }
    let many = &cases("merge", "castVoteMany")[0];
    let mut e = Entry::blank();
    for i in 0..many.input.as_i64().unwrap() {
        e = cast_vote(&e, &format!("p{i}"), "u", 1, i);
    }
    assert_same("castVoteMany", 0, &many.input, &to_value(&e), &many.output);
}

#[test]
fn workflow_matches() {
    for (i, c) in cases("merge", "note").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        let r = note(&e, c.input["what"].as_str().unwrap(), c.input["text"].as_str().unwrap(), c.input["who"].as_str().unwrap(), c.input["now"].as_i64().unwrap());
        assert_same("note", i, &c.input, &to_value(&r), &c.output);
    }
    let many = &cases("merge", "noteMany")[0];
    let mut e = Entry::blank();
    for i in 0..many.input.as_i64().unwrap() {
        e = note(&e, "w", &format!("t{i}"), "u", i);
    }
    assert_same("noteMany", 0, &many.input, &to_value(&e), &many.output);

    for (i, c) in cases("merge", "addComment").iter().enumerate() {
        let e = opt_entry(&c.input["e"]);
        let re = opt_str(&c.input["re"]);
        let r = add_comment(e.as_ref(), c.input["who"].as_str().unwrap(), c.input["text"].as_str().unwrap(), c.input["now"].as_i64().unwrap(), re.as_deref());
        assert_same("addComment", i, &c.input, &to_value(&r), &c.output);
    }
    for (i, c) in cases("merge", "setIgnored").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        let r = set_ignored(&e, c.input["key"].as_str().unwrap(), c.input["on"].as_bool().unwrap(), c.input["now"].as_i64().unwrap());
        assert_same("setIgnored", i, &c.input, &to_value(&r), &c.output);
    }
    for (i, c) in cases("merge", "edit").iter().enumerate() {
        let prev = opt_entry(&c.input["prev"]);
        let stage = if c.input["stage"] == "translate" { Stage::Translate } else { Stage::Review };
        let r = edit(prev.as_ref(), &unit(c.input["source"].as_str().unwrap()), c.input["text"].as_str().unwrap(), stage, c.input["now"].as_i64().unwrap());
        assert_same("edit", i, &c.input, &to_value(&r), &c.output);
    }
    for (i, c) in cases("merge", "sendBack").iter().enumerate() {
        let e: Entry = get(&c.input, "e");
        assert_same("sendBack", i, &c.input, &to_value(&send_back(&e, c.input["now"].as_i64().unwrap())), &c.output);
    }
    for (i, c) in cases("merge", "sourceChanged").iter().enumerate() {
        let e = opt_entry(&c.input["e"]);
        let r = source_changed(e.as_ref(), &unit(c.input["source"].as_str().unwrap()));
        assert_same("sourceChanged", i, &c.input, &json!(r), &c.output);
    }
    for (i, c) in cases("merge", "reconcile").iter().enumerate() {
        let units: Vec<Unit> = get(&c.input, "units");
        let mut entries: Translations = get(&c.input, "entries");
        let changed = reconcile(&units, &mut entries, c.input["now"].as_i64().unwrap());
        assert_same("reconcile", i, &c.input, &json!({ "changed": changed, "entries": to_value(&entries) }), &c.output);
    }
}

#[test]
fn merge_entry_matches() {
    for (i, c) in cases("merge", "mergeEntry").iter().enumerate() {
        let (a, b): (Entry, Entry) = (get(&c.input, "a"), get(&c.input, "b"));
        assert_same("mergeEntry", i, &c.input, &to_value(&merge_entry(&a, &b)), &c.output);
    }
}

#[test]
fn merge_matches() {
    for (i, c) in cases("merge", "merge").iter().enumerate() {
        let (a, b): (Translations, Translations) = (get(&c.input, "a"), get(&c.input, "b"));
        let r = merge(&a, &b, c.input["since"].as_i64().unwrap());
        let got = json!({ "merged": to_value(&r.merged), "conflicts": r.conflicts });
        assert_same("merge", i, &c.input, &got, &c.output);
        // порядок ключів результату теж має збігатися з JS
        let keys: Vec<&String> = r.merged.keys().collect();
        let want: Vec<&String> = c.output["merged"].as_object().unwrap().keys().collect();
        assert_eq!(keys, want, "порядок ключів, випадок #{i}");
    }
}
