mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};
use transly_core::termsync::*;

fn rendering(v: &Value) -> (String, String, Vec<String>) {
    (v["en"].as_str().unwrap().to_string(), v["uk"].as_str().unwrap().to_string(), v.get("alt").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default())
}

#[test]
fn term_change_matches() {
    for (i, c) in cases("termsync", "termChange").iter().enumerate() {
        let prev = (!c.input["prev"].is_null()).then(|| rendering(&c.input["prev"]));
        let next = rendering(&c.input["next"]);
        let got = term_change(prev.as_ref().map(|p| TermRendering { en: &p.0, uk: &p.1, alt: &p.2 }).as_ref(), &TermRendering { en: &next.0, uk: &next.1, alt: &next.2 });
        assert_same("termChange", i, &c.input, &to_value(&got), &c.output);
    }
}

/// Байтовий зсув → одиниці UTF-16 (TS рахує так).
fn u16_at(s: &str, byte: usize) -> usize {
    s[..byte].encode_utf16().count()
}

fn proposal_json(p: &TermProposal) -> Value {
    let mut v = to_value(p);
    for (k, s) in p.spans.iter().enumerate() {
        v["spans"][k]["start"] = json!(u16_at(&p.before, s.start));
        v["spans"][k]["end"] = json!(u16_at(&p.before, s.end));
    }
    v
}

#[test]
fn sync_matches() {
    for (i, c) in cases("termsync", "sync").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<IndexMap<String, Translations>>(&c.input, "files");
        let change: TermChange = TermChange { en: c.input["change"]["en"].as_str().unwrap().into(), old: c.input["change"]["old"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().into()).collect(), next: c.input["change"]["next"].as_str().unwrap().into() };
        let limit = c.input["limit"].as_u64().unwrap() as usize;
        let res = propose_term_sync(&views, &saved, &change, limit, None);
        let res_json = json!({ "proposals": res.proposals.iter().map(proposal_json).collect::<Vec<_>>(), "total": res.total, "truncated": res.truncated });

        let idx: Vec<usize> = c.input["pickIdx"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as usize).collect();
        let choices = c.input["choices"].as_array().unwrap();
        let picks: Vec<(&TermProposal, Vec<i64>)> = idx.iter().zip(choices).map(|(k, ch)| (&res.proposals[*k], ch.as_array().map(|a| a.iter().map(|x| x.as_i64().unwrap()).collect()).unwrap_or_default())).collect();
        let mut stale = empty_project("p", "en", "uk");
        stale.files = get::<IndexMap<String, Translations>>(&c.input, "stale");
        let changes = term_changes(&picks, &stale, 5000);
        let applied: Vec<String> = res.proposals.iter().take(3).map(|p| apply_spans(&p.before, &p.spans, &vec![0; p.spans.len()])).collect();
        let got = json!({ "res": res_json, "changes": to_value(&changes), "applied": applied });
        assert_same("sync", i, &c.input, &got, &c.output);
    }
}
