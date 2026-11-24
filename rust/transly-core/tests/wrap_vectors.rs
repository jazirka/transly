mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use std::rc::Rc;
use transly_core::controlcodes::*;
use transly_core::hyphen::*;
use transly_core::journal::FileView;
use transly_core::wrap::*;
use transly_core::wrapconfig::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn len7() -> Measure {
    Rc::new(|t: &str| (t.chars().count() * 7) as f64)
}
fn result_json(w: &WrapResult) -> Value {
    json!({ "text": w.text, "lines": w.lines, "over": w.over, "hyphenated": w.hyphenated, "changed": w.changed, "tooMany": w.too_many })
}
fn unit_of(v: &Value) -> MessageLike {
    MessageLike { kind: v["kind"].as_str().map(String::from), key: v["key"].as_str().map(String::from), face: v["face"].as_str().map(String::from) }
}

#[test]
fn control_codes_match() {
    for (i, c) in cases("wrap", "codes").iter().enumerate() {
        let t = c.input.as_str().unwrap();
        assert_same("codes", i, &c.input, &json!({ "codes": codes_of(t), "visible": visible_text(t), "len": display_length(t) }), &c.output);
    }
    for (i, c) in cases("wrap", "missingCodes").iter().enumerate() {
        let (src, tgt) = (s(&c.input, "source"), s(&c.input, "target"));
        let miss = missing_codes(src, tgt);
        let fixed = with_codes(src, tgt, &miss);
        assert_same("missingCodes", i, &c.input, &json!({ "miss": miss, "fixed": fixed }), &c.output);
    }
    for (i, c) in cases("wrap", "withCodes").iter().enumerate() {
        let miss: Vec<String> = get(&c.input, "miss");
        assert_same("withCodes", i, &c.input, &json!(with_codes(s(&c.input, "source"), s(&c.input, "target"), &miss)), &c.output);
    }
}

#[test]
fn hyphenation_matches() {
    for (i, c) in cases("wrap", "isHyphenatable").iter().enumerate() {
        assert_same("isHyphenatable", i, &c.input, &json!(is_hyphenatable(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("wrap", "hyphenPoints").iter().enumerate() {
        let got = hyphen_points(s(&c.input, "w"), c.input["a"].as_u64().unwrap() as usize, c.input["b"].as_u64().unwrap() as usize);
        assert_same("hyphenPoints", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("wrap", "syllables").iter().enumerate() {
        assert_same("syllables", i, &c.input, &json!(syllables(c.input.as_str().unwrap(), 1, 1)), &c.output);
    }
}

#[test]
fn config_matches() {
    for (i, c) in cases("wrap", "wrapOf").iter().enumerate() {
        let w = if c.input["wrap"].is_null() { None } else { Some(&c.input["wrap"]) };
        assert_same("wrapOf", i, &c.input, &to_value(&wrap_of(w)), &c.output);
    }
    let d = &cases("wrap", "defaults")[0].output;
    assert_same("DEFAULT_WRAP", 0, &Value::Null, &to_value(&default_wrap()), &d["DEFAULT_WRAP"]);
    assert_eq!(d["MV_WINDOW"], json!({ "width": 816, "padding": 18, "face": 168, "font": 28 }));
    let b = [pixel_budget(false, MV_WINDOW), pixel_budget(true, MV_WINDOW), pixel_budget(true, GameWindow { width: 640.0, ..MV_WINDOW })];
    assert_same("budgets", 0, &Value::Null, &json!(b), &d["budgets"]);
}

#[test]
fn wrapping_matches() {
    for (i, c) in cases("wrap", "planWrap").iter().enumerate() {
        let o = &c.input["o"];
        let px = c.input["px"].as_bool().unwrap();
        let width = o["width"].as_f64().unwrap() * if px { 7.0 } else { 1.0 };
        let opts = WrapOptions {
            width,
            measure: px.then(len7),
            hyphen: serde_json::from_value(o["hyphen"].clone()).unwrap(),
            hyphen_char: s(o, "hyphenChar").into(),
            min_left: o["minLeft"].as_u64().unwrap() as usize,
            min_right: o["minRight"].as_u64().unwrap() as usize,
            keep: serde_json::from_value(o["keep"].clone()).unwrap(),
            max_lines: o["maxLines"].as_u64().unwrap() as usize,
        };
        assert_same("planWrap", i, &c.input, &result_json(&plan_wrap(s(&c.input, "text"), &opts)), &c.output);
    }
    for (i, c) in cases("wrap", "wrapLines").iter().enumerate() {
        assert_same("wrapLines", i, &c.input, &json!(wrap_lines(s(&c.input, "text"), c.input["width"].as_f64().unwrap())), &c.output);
    }
}

#[test]
fn flow_matches() {
    let widths: Vec<f64> = cases("wrap", "wrapLines").iter().map(|c| c.input["width"].as_f64().unwrap()).collect();
    for (i, c) in cases("wrap", "unwrap").iter().enumerate() {
        let t = c.input.as_str().unwrap();
        // для перших 900 випадків ширина береться з паралельного вектора `wrapLines` (той самий індекс)
        let w = widths.get(i).copied().unwrap_or(5.0);
        let (lines, over) = line_facts(t, w, None);
        let got = json!({ "unwrap": unwrap(t), "flow": flow_text(t), "maxLineWidth": max_line_width(t), "facts": { "lines": lines, "over": over } });
        assert_same("unwrap", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("wrap", "limitFor").iter().enumerate() {
        assert_same("limitFor", i, &c.input, &json!(limit_for(c.input["l"].as_f64().unwrap(), c.input["f"].as_str())), &c.output);
    }
}

#[test]
fn plans_match() {
    for (i, c) in cases("wrap", "isMessageUnit").iter().enumerate() {
        assert_same("isMessageUnit", i, &c.input, &json!(is_message_unit(&unit_of(&c.input))), &c.output);
    }
    for (i, c) in cases("wrap", "plan").iter().enumerate() {
        let d = &c.input["plan"];
        let plan = WrapPlan { settings: get(d, "settings"), limit: d["limit"].as_f64().unwrap(), disabled: d["disabled"].as_bool().unwrap(), measure: d["measure"].as_bool().unwrap().then(len7) };
        let unit = unit_of(&c.input["unit"]);
        let text = s(&c.input, "text");
        let w = wrap_message(&plan, &unit, text);
        let tw = too_wide(&plan, &unit, text);
        let got = json!({
            "width": width_of(&plan, &unit),
            "measure": measure_of(&plan)("\\C[2]привіт!"),
            "wrap": result_json(&w),
            "lines": lines_shown(&plan, &unit, text),
            "wide": { "count": tw.count, "widest": tw.widest, "width": tw.width },
            "sig": plan_sig(Some(&plan)),
            "word": unit_word(&plan),
            "isMsg": is_message_unit(&unit),
        });
        assert_same("plan", i, &c.input, &got, &c.output);
    }
    assert_eq!(cases("wrap", "planSig")[0].output, json!(plan_sig(None)));
    for (i, c) in cases("wrap", "autoLineLimit").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        assert_same("autoLineLimit", i, &c.input, &json!(auto_line_limit(&views)), &c.output);
    }
}
