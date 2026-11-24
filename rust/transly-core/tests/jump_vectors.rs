mod common;

use common::{assert_same, cases, get};
use serde_json::{json, Value};
use transly_core::jump::*;
use transly_core::model::{GameFile, PageInfo};

fn num(v: &Value) -> serde_json::Number {
    let f = v.as_f64().unwrap();
    if f.fract() == 0.0 { serde_json::Number::from(f as i64) } else { serde_json::Number::from_f64(f).unwrap() }
}

/// JumpTarget з вектора (`setup` може бути або не бути).
fn target_of(v: &Value) -> JumpTarget {
    JumpTarget {
        kind: match v["kind"].as_str().unwrap() {
            "map" => JumpKind::Map,
            "common" => JumpKind::Common,
            _ => JumpKind::Troop,
        },
        map_id: v["mapId"].as_u64().unwrap(),
        x: num(&v["x"]),
        y: num(&v["y"]),
        event_index: v["eventIndex"].as_u64().unwrap(),
        event_id: num(&v["eventId"]),
        page: v["page"].as_u64().unwrap(),
        common: v["common"].as_u64().unwrap(),
        troop: v["troop"].as_u64().unwrap(),
        index: v["index"].as_u64().unwrap(),
        slot: v["slot"].as_u64().unwrap(),
        setup: v.get("setup").map(|s| PageInfo {
            trigger: 0,
            x: 0,
            y: 0,
            switches: s["switches"].as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect(),
            variable: s.get("variable").map(|vc| serde_json::from_value(vc.clone()).unwrap()),
            self_switch: s.get("selfSwitch").and_then(Value::as_str).map(String::from),
            item: s.get("item").and_then(Value::as_i64),
            actor: s.get("actor").and_then(Value::as_i64),
        }),
    }
}

#[test]
fn targets_match() {
    for (i, c) in cases("jump", "targets").iter().enumerate() {
        let game: Vec<GameFile> = get(&c.input, "game");
        let from_line = c.input["from"] == "line";
        let slot = c.input["slot"].as_u64().unwrap();
        let got: Vec<Value> = c.input["rows"].as_array().unwrap().iter().map(|r| jump_target(r[0].as_str().unwrap(), r[1].as_str().unwrap(), &game, from_line, slot).map_or(Value::Null, |t| t.to_json())).collect();
        assert_same("targets", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn plugin_text_matches() {
    for (i, c) in cases("jump", "plugin").iter().enumerate() {
        let t = target_of(&c.input);
        assert_same("plugin", i, &c.input, &json!(jump_plugin(&t)), &c.output);
    }
}
