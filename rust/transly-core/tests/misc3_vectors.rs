mod common;

use common::{assert_same, cases, get, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::followups::*;
use transly_core::model::Translations;
use transly_core::pages::*;
use transly_core::preflight::*;
use transly_core::project::{empty_project, FileView};
use transly_core::qa::default_qa;
use transly_core::theme::*;

#[test]
fn preflight_and_followups_match() {
    for (i, c) in cases("misc3", "preflight").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<IndexMap<String, Translations>>(&c.input, "files");
        let mut qa = default_qa();
        qa.terms = get(&c.input["qa"], "terms");
        qa.line_limit = c.input["qa"]["lineLimit"].as_f64();
        let p = preflight(&views, &saved, &qa);
        let got = json!({ "p": p, "lines": preflight_lines(&p, false), "linesDrafts": preflight_lines(&p, true) });
        assert_same("preflight", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("misc3", "followups").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let mut saved = empty_project("p", "en", "uk");
        saved.files = get::<IndexMap<String, Translations>>(&c.input, "files");
        let t = &c.input["term"];
        let alt: Vec<String> = t.get("alt").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        let tr = rows_with_term(&views, &saved, t["en"].as_str().unwrap(), t["uk"].as_str().unwrap(), &alt);
        let got = json!({ "tr": tr, "note": term_rows_note(t["en"].as_str().unwrap(), &tr), "empty": term_rows_note("x", &TermRows::default()) });
        assert_same("followups", i, &c.input, &got, &c.output);
    }
}

#[test]
fn pages_match() {
    for (i, c) in cases("misc3", "normalizePages").iter().enumerate() {
        let p = normalize_pages(&c.input);
        assert_same("normalizePages", i, &c.input, &to_value(&p), &c.output);
    }
    for (i, c) in cases("misc3", "pageMath").iter().enumerate() {
        let (total, size, page) = (c.input["total"].as_f64().unwrap(), c.input["size"].as_f64().unwrap(), c.input["page"].as_f64().unwrap());
        let (a, b) = page_range(page, total, size);
        let got = json!({ "count": page_count(total, size), "clamp": clamp_page(page, total, size), "ofIndex": page_of_index(page, size), "range": [a, b] });
        assert_same("pageMath", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("misc3", "pageOfKey").iter().enumerate() {
        let keys: Vec<String> = c.input["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_string()).collect();
        let got = page_of_key(&keys, c.input["key"].as_str(), c.input["size"].as_f64().unwrap());
        assert_same("pageOfKey", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("misc3", "places").iter().enumerate() {
        let mut places: IndexMap<String, Place> = IndexMap::new();
        for o in c.input.as_array().unwrap() {
            let p = &o["place"];
            places = remember_place(&places, o["id"].as_str().unwrap(), Place { page: p["page"].as_f64().unwrap(), key: p["key"].as_str().map(String::from), top: p["top"].as_f64() });
        }
        assert_same("places", i, &c.input, &json!({ "places": places, "order": places.keys().collect::<Vec<_>>() }), &c.output);
    }
    for (i, c) in cases("misc3", "normalizePlaces").iter().enumerate() {
        assert_same("normalizePlaces", i, &c.input, &to_value(&normalize_places(&c.input)), &c.output);
    }
}

#[test]
fn theme_matches() {
    for (i, c) in cases("misc3", "theme").iter().enumerate() {
        let h = c.input.as_u64().unwrap() as u32;
        let got = json!({ "tokens": theme_tokens(h), "rgb": oklch_rgb(0.6, 0.2, h as f64) });
        assert_same("theme", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("misc3", "hueOfName").iter().enumerate() {
        assert_same("hueOfName", i, &c.input, &json!(hue_of_name(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("misc3", "themeHue").iter().enumerate() {
        let chosen = match &c.input["c"] {
            Value::String(s) if s == "nan" => json!("nan"),
            v => v.clone(),
        };
        let got = theme_hue(c.input["n"].as_str().unwrap(), Some(&chosen).filter(|v| !v.is_null()));
        assert_same("themeHue", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("misc3", "contrast").iter().enumerate() {
        let a = c.input.as_array().unwrap();
        assert_same("contrast", i, &c.input, &json!(contrast_of(a[0].as_str().unwrap(), a[1].as_str().unwrap())), &c.output);
    }
}
