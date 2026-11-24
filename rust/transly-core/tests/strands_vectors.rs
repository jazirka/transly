mod common;

use common::{assert_same, cases, to_value};
use serde_json::{json, Value};
use transly_core::glossary::Term;
use transly_core::strands::*;
use transly_core::termmatch::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn alt_of(v: &Value) -> Vec<String> {
    serde_json::from_value(v["alt"].clone()).unwrap()
}
fn terms_of(v: &Value) -> Vec<Term> {
    serde_json::from_value(v["terms"].clone()).unwrap()
}

#[test]
fn kinds_match() {
    for (i, c) in cases("strands", "strandKind").iter().enumerate() {
        assert_same("strandKind", i, &c.input, &to_value(&strand_kind(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn hits_match() {
    for (i, c) in cases("strands", "sourceTermHits").iter().enumerate() {
        assert_same("sourceTermHits", i, &c.input, &to_value(&source_term_hits(s(&c.input, "source"), &terms_of(&c.input))), &c.output);
    }
    for (i, c) in cases("strands", "termMatchesOfPhrases").iter().enumerate() {
        assert_same("termMatchesOfPhrases", i, &c.input, &json!(term_matches_of_phrases(s(&c.input, "target"), s(&c.input, "uk"), &alt_of(&c.input))), &c.output);
    }
    for (i, c) in cases("strands", "termRangesInTarget").iter().enumerate() {
        assert_same("termRangesInTarget", i, &c.input, &json!(term_ranges_in_target(s(&c.input, "target"), s(&c.input, "uk"), &alt_of(&c.input))), &c.output);
    }
    for (i, c) in cases("strands", "targetTermHits").iter().enumerate() {
        assert_same("targetTermHits", i, &c.input, &to_value(&target_term_hits(s(&c.input, "target"), &terms_of(&c.input))), &c.output);
    }
}

#[test]
fn strands_match() {
    for (i, c) in cases("strands", "strandsOf").iter().enumerate() {
        let got = to_value(&strands_of(s(&c.input, "source"), s(&c.input, "target"), &terms_of(&c.input)));
        assert_same("strandsOf", i, &c.input, &got, &c.output);
    }
}
