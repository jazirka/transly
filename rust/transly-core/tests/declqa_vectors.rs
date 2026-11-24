mod common;

use common::{assert_same, cases};
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::HashSet;
use transly_core::declqa::*;
use transly_core::i18n::{parse_json_catalog, I18n};
use transly_core::qa::IssueCat;
use transly_core::qarules::{QaRules, RuleCtx, RuleSeverity};

const CAT: &str = r#"{"language":"en","messages":{"Не варто вживати":"Avoid","В оригіналі є {when}: у перекладі має бути {then}":"Source has {when}: need {then}","Переклад довший за {max} знаків ({n})":"Longer than {max} ({n})","Переклад збігається з оригіналом":"Same as source"},"contexts":{"plugin:test.plug":{"Title":"T-en","Desc":"D-en","Own msg":"Own-en","Моє повідомлення":"My-en"}}}"#;

#[test]
fn rules_match() {
    let rules = QaRules { sev: IndexMap::new(), keep: HashSet::new(), apostrophe: "any".into(), sig: String::new() };
    for (i, c) in cases("declqa", "rule").iter().enumerate() {
        let mut i18n = I18n::new();
        if c.input["en"] == json!(true) {
            i18n.add("en", parse_json_catalog(CAT), "cat", None);
            i18n.set_language("en", &[]);
        }
        let rule = declarative_rule("test.plug", &c.input["q"], &mut i18n);
        let runs: Vec<Value> = c.output["runs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                let source = r["source"].as_str().unwrap();
                let target = r["target"].as_str().unwrap();
                let kind = r["kind"].as_str();
                let ctx = RuleCtx::new(kind, source, target, &rules);
                let out = rule.run(&ctx, &mut i18n).map(|o| {
                    let mut m = serde_json::Map::new();
                    m.insert("message".into(), json!(o.message));
                    if let Some(f) = o.fixed {
                        m.insert("fixed".into(), json!(f));
                    }
                    Value::Object(m)
                });
                let mut row = json!({ "source": source, "target": target, "out": out });
                if let Some(k) = kind {
                    row["kind"] = json!(k);
                }
                row
            })
            .collect();
        let sev = |s: RuleSeverity| s.as_str();
        let got = json!({
            "rule": { "id": rule.id, "title": rule.title, "explain": rule.explain,
                "cat": match rule.cat { IssueCat::Error => "error", _ => "style" }, "def": sev(rule.def),
                "fixable": rule.fixable, "plugin": rule.plugin, "kinds": rule.kinds },
            "runs": runs,
        });
        assert_same("rule", i, &c.input, &got, &c.output);
    }
}
