mod common;

use common::{assert_same, cases, to_value};
use serde_json::{json, Value};
use transly_core::glossary::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn sorted(sets: Vec<std::collections::HashSet<String>>) -> Value {
    json!(sets.into_iter().map(|s| { let mut v: Vec<String> = s.into_iter().collect(); v.sort_by(|a, b| transly_core::js::cmp(a, b)); v }).collect::<Vec<_>>())
}

#[test]
fn tokens_match() {
    for (i, c) in cases("glossary", "wordTokens").iter().enumerate() {
        assert_same("wordTokens", i, &c.input, &to_value(&word_tokens(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("glossary", "prepareText").iter().enumerate() {
        let p = prepare_text(c.input.as_str().unwrap());
        assert_same("prepareText", i, &c.input, &json!({ "text": p.text, "tokens": p.tokens }), &c.output);
    }
    for (i, c) in cases("glossary", "ukStemsAgree").iter().enumerate() {
        assert_same("ukStemsAgree", i, &c.input, &json!(uk_stems_agree(s(&c.input, "a"), s(&c.input, "b"))), &c.output);
    }
}

#[test]
fn patterns_match() {
    for (i, c) in cases("glossary", "hasGap").iter().enumerate() {
        assert_same("hasGap", i, &c.input, &json!(has_gap(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("glossary", "patternParts").iter().enumerate() {
        assert_same("patternParts", i, &c.input, &json!(pattern_parts(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("glossary", "normalizeGap").iter().enumerate() {
        assert_same("normalizeGap", i, &c.input, &json!(normalize_gap(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("glossary", "termFirstKey").iter().enumerate() {
        assert_same("termFirstKey", i, &c.input, &json!(term_first_key(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn source_terms_match() {
    for (i, c) in cases("glossary", "termMatchesIn").iter().enumerate() {
        let p = prepare_text(s(&c.input, "text"));
        assert_same("termMatchesIn", i, &c.input, &json!(term_matches_in(&p, s(&c.input, "en"))), &c.output);
    }
    for (i, c) in cases("glossary", "hasTerm").iter().enumerate() {
        assert_same("hasTerm", i, &c.input, &json!(has_term(s(&c.input, "text"), s(&c.input, "en"))), &c.output);
    }
    for (i, c) in cases("glossary", "termRanges").iter().enumerate() {
        assert_same("termRanges", i, &c.input, &json!(term_ranges(s(&c.input, "text"), s(&c.input, "en"))), &c.output);
    }
    for (i, c) in cases("glossary", "termsIn").iter().enumerate() {
        let terms: Vec<Term> = serde_json::from_value(c.input["terms"].clone()).unwrap();
        assert_same("termsIn", i, &c.input, &json!(terms_in(s(&c.input, "source"), &terms)), &c.output);
    }
}

#[test]
fn target_terms_match() {
    for (i, c) in cases("glossary", "targetHasTerm").iter().enumerate() {
        let alt: Vec<String> = serde_json::from_value(c.input["alt"].clone()).unwrap();
        assert_same("targetHasTerm", i, &c.input, &json!(target_has_term(s(&c.input, "target"), s(&c.input, "uk"), &alt)), &c.output);
    }
    for (i, c) in cases("glossary", "termMatchesInTarget").iter().enumerate() {
        assert_same("termMatchesInTarget", i, &c.input, &json!(term_matches_in_target(s(&c.input, "target"), s(&c.input, "uk"))), &c.output);
    }
    for (i, c) in cases("glossary", "phraseForms").iter().enumerate() {
        let got = match &*phrase_forms(c.input.as_str().unwrap()) { None => Value::Null, Some(f) => sorted(f.clone()) };
        assert_same("phraseForms", i, &c.input, &got, &c.output);
    }
}

#[test]
fn parse_terms_match() {
    for (i, c) in cases("glossary", "parseTerms").iter().enumerate() {
        let (terms, rejected) = parse_terms(c.input.as_str().unwrap());
        assert_same("parseTerms", i, &c.input, &json!({ "terms": terms, "rejected": rejected }), &c.output);
    }
}
