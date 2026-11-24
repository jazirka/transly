mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Map, Value};
use transly_core::branches::*;
use transly_core::model::{Translations, Unit};
use transly_core::progress::*;
use transly_core::project::*;
use transly_core::validate::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn result<T: serde::Serialize>(r: Result<T, String>) -> Value {
    match r {
        Ok(v) => json!({ "ok": to_value(&v) }),
        Err(e) => json!({ "error": e }),
    }
}
fn proj(v: &Value) -> SavedProject {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("проєкт: {e}\n{v}"))
}

#[test]
fn basics_match() {
    for (i, c) in cases("project", "empty").iter().enumerate() {
        let (n, a, b) = if i == 0 { ("Гра", "en", "uk") } else { ("x", "ja", "de") };
        assert_same("empty", i, &c.input, &to_value(&empty_project(n, a, b)), &c.output);
    }
    assert_same("defaults", 0, &Value::Null, &Value::Object(default_settings()), &cases("project", "defaults")[0].output);
    for (i, c) in cases("project", "looks").iter().enumerate() {
        assert_same("looks", i, &c.input, &json!(looks_like_project(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("project", "pct").iter().enumerate() {
        assert_same("pct", i, &c.input, &json!(pct(c.input["n"].as_u64().unwrap() as usize, c.input["t"].as_u64().unwrap() as usize)), &c.output);
    }
    let sum = sum_progress(&[Progress::default(), Progress { total: 3, untranslated: 1, draft: 1, sent: 1, approved: 0, translated: 2 }, Progress { total: 2, untranslated: 0, draft: 0, sent: 1, approved: 1, translated: 2 }]);
    assert_same("sum", 0, &Value::Null, &json!({ "total": sum.total, "untranslated": sum.untranslated, "draft": sum.draft, "sent": sum.sent, "approved": sum.approved, "translated": sum.translated }), &cases("project", "sum")[0].output);
}

#[test]
fn snapshot_and_stats_match() {
    for (i, c) in cases("project", "snapshot").iter().enumerate() {
        let p = proj(&c.input);
        let views = views_from_snapshot(&p);
        let ser: Value = serde_json::from_str(&serialize(&p)).unwrap();
        let want_ser: Value = serde_json::from_str(c.output["serialized"].as_str().unwrap()).unwrap();
        assert_same("serialize", i, &c.input, &ser, &want_ser);
        assert_same("snapshot", i, &c.input, &json!({ "views": to_value(&views), "snap": snapshot_of(&views) }), &json!({ "views": c.output["views"], "snap": c.output["snap"] }));
    }
    for (i, c) in cases("project", "stats").iter().enumerate() {
        let units: Vec<Unit> = get(&c.input, "units");
        let entries: Translations = get(&c.input, "entries");
        let st = stats_of(&units, &entries);
        let p = progress_of(&units, &entries);
        let states: Vec<Value> = units.iter().map(|u| to_value(&row_state(entries.get(&u.key)))).collect();
        let got = json!({
            "stats": to_value(&st),
            "progress": { "total": p.total, "untranslated": p.untranslated, "draft": p.draft, "sent": p.sent, "approved": p.approved, "translated": p.translated },
            "states": states,
        });
        assert_same("stats", i, &c.input, &got, &c.output);
    }
}

#[test]
fn deserialize_matches() {
    for (i, c) in cases("project", "deserialize").iter().enumerate() {
        let got = match deserialize_checked(s(&c.input, "text"), c.input["now"].as_i64()) {
            Ok(d) => json!({ "ok": { "project": to_value(&d.project), "notes": d.notes } }),
            Err(e) => json!({ "error": e }),
        };
        assert_same("deserialize", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("project", "repair").iter().enumerate() {
        let Value::Object(mut raw) = c.input["raw"].clone() else { panic!() };
        let notes = repair_project(&mut raw);
        let mut raw2: Map<String, Value> = raw.clone();
        let n = clamp_clock(&mut raw2, c.input["now"].as_i64().unwrap(), MAX_AHEAD_MS);
        assert_same("repair", i, &c.input, &json!({ "notes": notes, "raw": raw, "clamped": n, "raw2": raw2 }), &c.output);
    }
}

#[test]
fn merge_matches() {
    for (i, c) in cases("project", "mergeProjects").iter().enumerate() {
        let (a, b) = (proj(&c.input["a"]), proj(&c.input["b"]));
        let r = merge_projects(&a, &b, c.input["since"].as_i64().unwrap());
        let conflicts: Vec<Value> = r.conflicts.iter().map(|(f, k)| json!({ "file": f, "key": k })).collect();
        let got = json!({ "project": to_value(&r.project), "conflicts": conflicts, "olderPeer": r.older_peer, "droppedByReset": r.dropped_by_reset });
        assert_same("mergeProjects", i, &c.input, &got, &c.output);
    }
}

#[test]
fn branches_match() {
    for (i, c) in cases("project", "branches").iter().enumerate() {
        let p = proj(&c.input["p"]);
        let (name, now, from) = (s(&c.input, "name"), c.input["now"].as_i64().unwrap(), s(&c.input, "from"));
        let rows: Vec<usize> = ["main", "dev", "alt"].iter().map(|n| rows_in(&p, n)).collect();
        let got = json!({
            "names": branch_names(&p),
            "problem": name_problem(&p, name, None),
            "problemExcept": name_problem(&p, name, Some("dev")),
            "rows": rows,
            "create": result(create_branch(&p, name, now)),
            "switch": result(switch_branch(&p, name)),
            "checkout": to_value(&checkout_branch(&p, name)),
            "rename": result(rename_branch(&p, from, name)),
            "remove": result(delete_branch(&p, name, now)),
        });
        assert_same("branches", i, &c.input, &got, &c.output);
    }
}
