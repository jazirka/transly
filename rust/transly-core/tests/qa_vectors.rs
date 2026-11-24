mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use std::rc::Rc;
use transly_core::journal::{FileView, SavedFiles};
use transly_core::model::{Entry, Unit};
use transly_core::qa::*;
use transly_core::qaadvice::*;
use transly_core::qaconfig::*;
use transly_core::qarules::*;
use transly_core::wrap::WrapPlan;
use transly_core::workflow::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn rules_of(qa: &Value) -> QaRules {
    qa_of(if qa.is_null() { None } else { Some(qa) })
}
fn len7() -> transly_core::wrap::Measure {
    Rc::new(|t: &str| (t.chars().count() * 7) as f64)
}
/// QaOptions з опису з вектора (TS будує ті самі через `qaOf` і `genPlan`).
fn opts_of(d: &Value) -> QaOptions {
    let wrap = (!d["wrap"].is_null()).then(|| {
        let w = &d["wrap"];
        WrapPlan { settings: get(w, "settings"), limit: w["limit"].as_f64().unwrap(), disabled: w["disabled"].as_bool().unwrap(), measure: w["measure"].as_bool().unwrap().then(len7) }
    });
    QaOptions {
        tolerance_pct: d["tolerancePct"].as_f64().unwrap(),
        terms: get(d, "terms"),
        line_limit: d["lineLimit"].as_f64(),
        wrap,
        rules: (!d["settings"].is_null()).then(|| rules_of(&d["settings"])),
    }
}
fn unit_like(u: &Value) -> UnitLike {
    UnitLike { source: s(u, "source").into(), kind: u["kind"].as_str().map(String::from), face: u["face"].as_str().map(String::from), key: u["key"].as_str().map(String::from) }
}
fn unit_full(u: &Value) -> Unit {
    serde_json::from_value(u.clone()).unwrap()
}
fn opt_entry(v: &Value) -> Option<Entry> {
    (!v.is_null()).then(|| serde_json::from_value(v.clone()).unwrap())
}
fn result_json(r: &SubmitResult) -> Value {
    match r {
        SubmitResult::Ok(e) => json!({ "ok": true, "entry": to_value(e) }),
        SubmitResult::Err(m) => json!({ "ok": false, "reason": m }),
    }
}

#[test]
fn config_matches() {
    let all = &cases("qa", "rules")[0].output;
    let got: Vec<Value> = QA_RULES.iter().map(|r| json!({ "id": r.id, "title": r.title, "explain": r.explain, "cat": to_value(&r.cat), "def": r.def.as_str(), "fixable": r.fixable })).collect();
    assert_same("rules", 0, &Value::Null, &json!(got), all);
    for (i, c) in cases("qa", "qaOf").iter().enumerate() {
        let q = rules_of(&c.input["qa"]);
        let mut keep: Vec<&String> = q.keep.iter().collect();
        keep.sort_by(|a, b| transly_core::js::cmp(a, b));
        let sev: serde_json::Map<String, Value> = q.sev.iter().map(|(k, v)| (k.clone(), json!(v.as_str()))).collect();
        assert_same("qaOf", i, &c.input, &json!({ "sev": sev, "keep": keep, "apostrophe": q.apostrophe, "sig": q.sig }), &c.output);
    }
    for (i, c) in cases("qa", "withRuleLevel").iter().enumerate() {
        let q = (!c.input["q"].is_null()).then_some(&c.input["q"]);
        let level = RuleSeverity::parse(s(&c.input, "level")).unwrap();
        assert_same("withRuleLevel", i, &c.input, &with_rule_level(q, s(&c.input, "id"), level), &c.output);
    }
    for (i, c) in cases("qa", "keepText").iter().enumerate() {
        assert_same("keepText", i, &c.input, &json!(keep_from_text(c.input.as_str().unwrap())), &c.output);
    }
    assert_eq!(cases("qa", "keepText2")[0].output, json!(keep_to_text(&["a".into(), "b".into()])));
    assert_eq!(cases("qa", "keepFromBig")[0].output, json!(500));
}

#[test]
fn rules_match() {
    for (i, c) in cases("qa", "runRules").iter().enumerate() {
        let rules = rules_of(&c.input["qa"]);
        let got = run_rules(s(&c.input, "source"), s(&c.input, "target"), &rules, c.input["kind"].as_str());
        assert_same("runRules", i, &c.input, &to_value(&got), &c.output);
    }
}

#[test]
fn check_matches() {
    for (i, c) in cases("qa", "lengthDeviation").iter().enumerate() {
        assert_same("lengthDeviation", i, &c.input, &json!(length_deviation(s(&c.input, "source"), s(&c.input, "target"))), &c.output);
    }
    for (i, c) in cases("qa", "check").iter().enumerate() {
        let got = check(&unit_like(&c.input["unit"]), s(&c.input, "target"), &opts_of(&c.input["opts"]));
        assert_same("check", i, &c.input, &to_value(&got), &c.output);
    }
    for (i, c) in cases("qa", "activeIssues").iter().enumerate() {
        let e: Entry = Entry { ign: c.input["entry"].get("ign").map(|v| serde_json::from_value(v.clone()).unwrap()), target: s(&c.input["entry"], "target").into(), ..Entry::blank() };
        let got = active_issues(&unit_like(&c.input["unit"]), Some(&e), &opts_of(&c.input["opts"]));
        assert_same("activeIssues", i, &c.input, &to_value(&got), &c.output);
    }
}

#[test]
fn advice_matches() {
    for (i, c) in cases("qa", "advice").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let opts = opts_of(&c.input["opts"]);
        let now = c.input["now"].as_i64().unwrap();
        let rows: Vec<Value> = views
            .iter()
            .flat_map(|v| v.units.iter().map(|u| (v, u)).collect::<Vec<_>>())
            .map(|(v, u)| {
                let e = files.get(&v.name).and_then(|f| f.get(&u.key));
                let ul = UnitLike::from(u);
                json!({ "has": has_advice(&ul, e, &opts), "advice": advice_of(&ul, e, &opts).iter().map(|x| x.key.clone()).collect::<Vec<_>>() })
            })
            .collect();
        let got = json!({
            "count": advice_count(&views, &files, &opts),
            "rows": rows,
            "stats": views.iter().map(|v| to_value(&rule_stats(v, &files, &opts))).collect::<Vec<_>>(),
            "fix": to_value(&fix_rule(&views, &files, s(&c.input, "ruleId"), &opts, now)),
            "fixNone": to_value(&fix_rule(&views, &files, "nope", &opts, now)),
        });
        assert_same("advice", i, &c.input, &got, &c.output);
    }
}

#[test]
fn submit_matches() {
    for (i, c) in cases("qa", "submit").iter().enumerate() {
        let opts = SubmitOptions { block_errors: c.input["blockErrors"].as_bool().unwrap(), qa: opts_of(&c.input["opts"]) };
        let stage = if s(&c.input, "stage") == "translate" { Stage::Translate } else { Stage::Review };
        let prev = opt_entry(&c.input["prev"]);
        let r = submit(prev.as_ref(), &unit_full(&c.input["unit"]), stage, c.input["now"].as_i64().unwrap(), &opts);
        assert_same("submit", i, &c.input, &result_json(&r), &c.output);
    }
    for (i, c) in cases("qa", "approve").iter().enumerate() {
        let opts = SubmitOptions { block_errors: c.input["blockErrors"].as_bool().unwrap(), qa: opts_of(&c.input["opts"]) };
        let prev = opt_entry(&c.input["prev"]);
        let r = approve_entry(prev.as_ref(), &unit_full(&c.input["unit"]), c.input["now"].as_i64().unwrap(), &opts);
        assert_same("approve", i, &c.input, &result_json(&r), &c.output);
    }
}
