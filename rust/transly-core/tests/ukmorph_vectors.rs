mod common;

use common::{assert_same, cases, to_value};
use serde_json::{json, Value};
use transly_core::plural::{plural, rows};
use transly_core::ukmorph::*;

#[test]
fn plural_matches() {
    for (i, c) in cases("ukmorph", "plural").iter().enumerate() {
        let got = plural(c.input.as_i64().unwrap(), ["файл", "файли", "файлів"]);
        assert_same("plural", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("ukmorph", "rows").iter().enumerate() {
        assert_same("rows", i, &c.input, &json!(rows(c.input.as_i64().unwrap())), &c.output);
    }
}

#[test]
fn norm_and_cells_match() {
    for (i, c) in cases("ukmorph", "ukNorm").iter().enumerate() {
        assert_same("ukNorm", i, &c.input, &json!(uk_norm(c.input.as_str().unwrap())), &c.output);
    }
    let names: Vec<String> = (0..NCELLS).map(cell_name).collect();
    assert_eq!(json!(names), cases("ukmorph", "cells")[0].output);
}

#[test]
fn forms_match() {
    for (i, c) in cases("ukmorph", "ukForms").iter().enumerate() {
        let got = match uk_forms(c.input.as_str().unwrap(), None) {
            None => Value::Null,
            Some(v) => Value::Object((0..NCELLS).map(|k| (cell_name(k), json!(v[k]))).collect()),
        };
        assert_same("ukForms", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("ukmorph", "ukWordForms").iter().enumerate() {
        let got = match uk_word_forms(c.input.as_str().unwrap(), None) {
            None => Value::Null,
            Some(sets) => json!(sets.into_iter().map(|s| { let mut v: Vec<String> = s.into_iter().collect(); v.sort_by(|a, b| transly_core::js::cmp(a, b)); v }).collect::<Vec<_>>()),
        };
        assert_same("ukWordForms", i, &c.input, &got, &c.output);
    }
}

#[test]
fn retarget_matches() {
    for (i, c) in cases("ukmorph", "ukRetarget").iter().enumerate() {
        let prev = c.input["prev"].as_str();
        let got = uk_retarget(c.input["oldP"].as_str().unwrap(), c.input["newP"].as_str().unwrap(), c.input["observed"].as_str().unwrap(), &RetargetOpts { prev, dict: None });
        let got = got.map_or(Value::Null, |r| to_value(&r));
        assert_same("ukRetarget", i, &c.input, &got, &c.output);
    }
}
