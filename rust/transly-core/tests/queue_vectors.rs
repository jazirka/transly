mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::groups::RowRef;
use transly_core::inbox::*;
use transly_core::model::Translations;
use transly_core::project::{empty_project, FileView};
use transly_core::qa::default_qa;
use transly_core::queue::*;

#[test]
fn queue_and_inbox_match() {
    for (i, c) in cases("queue", "queue").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<indexmap::IndexMap<String, Translations>>(&c.input, "files");
        let mut qa = default_qa();
        qa.tolerance_pct = c.input["qa"]["tolerancePct"].as_f64().unwrap();
        qa.terms = get(&c.input["qa"], "terms");
        qa.line_limit = c.input["qa"]["lineLimit"].as_f64();

        let mut res = serde_json::Map::new();
        let mut rows_of = std::collections::HashMap::new();
        for k in QueueKind::ALL {
            let rows = queue_rows(&views, &saved, k, &qa);
            res.insert(k.as_str().into(), to_value(&rows));
            rows_of.insert(k.as_str(), rows);
        }
        let errors: Vec<RowRef> = rows_of["error"].iter().map(|r| RowRef { file: r.file.clone(), key: r.key.clone() }).collect();
        let inbox = inbox_of(&InboxInput { views: &views, saved: &saved, who: c.input["who"].as_str().unwrap(), seen: c.input["seen"].as_i64().unwrap(), errors });

        let froms: Vec<Value> = c.output["froms"].as_array().unwrap().clone();
        let positions: Vec<Value> = froms
            .iter()
            .map(|f| {
                let from = (!f.is_null()).then(|| (f["file"].as_str().unwrap(), f["key"].as_str().unwrap()));
                json!(position_of(&views, from).map_or(-1, |p| p as i64))
            })
            .collect();
        let mut nexts: Vec<Value> = Vec::new();
        for k in QueueKind::ALL {
            for at in [-1i64, 0, 3, 7, 100] {
                for fwd in [true, false] {
                    let at_opt = if at < 0 { None } else { Some(at as usize) };
                    nexts.push(next_in(&rows_of[k.as_str()], at_opt, fwd).map_or(Value::Null, |(row, place)| json!({ "row": row, "place": place })));
                }
            }
        }
        let got = json!({ "res": res, "inbox": inbox, "positions": positions, "froms": froms, "nexts": nexts });
        for k in ["res", "inbox", "positions", "nexts"] {
            assert_same(k, i, &json!(null), &got[k], &c.output[k]);
        }
    }
}
