mod common;

use common::{assert_same, cases, get};
use serde_json::{json, Value};
use transly_core::historyview::*;
use transly_core::model::HistoryItem;
use transly_core::textdiff::*;

fn rows_json(rows: &[HistoryRow]) -> Value {
    json!(rows
        .iter()
        .map(|r| json!({ "index": r.index, "rec": r.rec, "before": r.before, "diff": r.diff, "isCurrent": r.is_current, "canRestore": r.can_restore, "canRestoreBefore": r.can_restore_before }))
        .collect::<Vec<_>>())
}

/// Дні від 1970-01-01 для дати (рік, місяць 1..12, день).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Остання неділя місяця (день 1..31).
fn last_sunday(y: i64, m: i64) -> i64 {
    let last = days_from_civil(if m == 12 { y + 1 } else { y }, if m == 12 { 1 } else { m + 1 }, 1) - 1;
    // 1970-01-01 — четвер: день тижня (0 = неділя)
    let dow = (last + 4).rem_euclid(7);
    last - dow
}

/// Європа/Київ: +2 взимку, +3 влітку (літній час від останньої неділі березня 01:00 UTC до останньої неділі жовтня 01:00 UTC).
fn kyiv(t: i64) -> i64 {
    let days = t.div_euclid(86_400_000);
    let year = {
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        yoe + era * 400 + i64::from(mp >= 10)
    };
    let start = last_sunday(year, 3) * 86_400_000 + 3_600_000;
    let end = last_sunday(year, 10) * 86_400_000 + 3_600_000;
    if t >= start && t < end { 180 } else { 120 }
}

#[test]
fn diff_matches() {
    for (i, c) in cases("historyview", "diff").iter().enumerate() {
        let (a, b) = (c.input["a"].as_str().unwrap(), c.input["b"].as_str().unwrap());
        let segs = diff_words(a, b);
        let (added, removed) = diff_counts(&segs);
        let got = json!({ "segs": segs, "before": side_of(&segs, false), "after": side_of(&segs, true), "counts": { "added": added, "removed": removed } });
        assert_same("diff", i, &c.input, &got, &c.output);
    }
}

#[test]
fn rows_and_notes_match() {
    for (i, c) in cases("historyview", "rows").iter().enumerate() {
        let history: Vec<HistoryItem> = if c.input["history"].is_null() { vec![] } else { get(&c.input, "history") };
        assert_same("rows", i, &c.input, &rows_json(&history_rows(&history, c.input["current"].as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("historyview", "restore").iter().enumerate() {
        let rec: HistoryItem = get(&c.input, "rec");
        let got = restore_note(&rec, c.input["which"] == "text", c.input["when"].as_str().unwrap());
        assert_same("restore", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("historyview", "activity").iter().enumerate() {
        assert_same("activity", i, &c.input, &json!(activity_kind(c.input.as_str().unwrap()).as_str()), &c.output);
    }
}

#[test]
fn day_labels_match() {
    for (i, c) in cases("historyview", "day").iter().enumerate() {
        let got = day_label(c.input["at"].as_i64().unwrap(), c.input["now"].as_i64().unwrap(), &kyiv);
        assert_same("day", i, &c.input, &json!(got), &c.output);
    }
}
