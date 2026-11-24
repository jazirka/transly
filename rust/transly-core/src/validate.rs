//! `validate.ts`: проєкт зі сховища, файлу, синхронізації чи іншого пристрою не викликає довіри: один запис із хибним типом
//! колись ламав кожен наступний запуск, а рядки з нього потрапляють на сторінку. `repair_project` робить розібраний об'єкт
//! правильно типізованим на місці (він щойно розібраний, ніхто інший його не тримає) і каже, що довелося чіпати;
//! `clamp_clock` не дає годинникам із майбутнього (швидкий годинник пристрою) перебити кожну чесну правку.
//! Працює над `serde_json::Value`, як і TS над сирим розібраним об'єктом.

use crate::js;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

type Obj = Map<String, Value>;

fn is_obj(v: &Value) -> bool {
    v.is_object()
}
fn num(v: &Value) -> bool {
    v.is_number()
}
fn is_str(v: Option<&Value>) -> bool {
    v.is_some_and(|v| v.is_string())
}
fn num_at(o: &Obj, k: &str) -> bool {
    o.get(k).is_some_and(num)
}
fn strs(v: &Value) -> bool {
    v.as_array().is_some_and(|a| a.iter().all(|x| x.is_string()))
}

#[derive(Default)]
struct Counts {
    entries: usize,
    dropped: usize,
    settings: usize,
    other: usize,
}

fn known_status(v: Option<&Value>) -> bool {
    matches!(v.and_then(|v| v.as_str()), Some("new" | "draft" | "done" | "appr"))
}

fn repair_comments(raw: &mut Obj, n: &mut Counts) {
    if !raw.contains_key("comments") {
        return;
    }
    let Some(arr) = raw.get_mut("comments").and_then(|c| c.as_array_mut()) else {
        raw.shift_remove("comments");
        n.entries += 1;
        return;
    };
    let before = arr.len();
    arr.retain(|c| c.as_object().is_some_and(|c| num_at(c, "at") && is_str(c.get("text"))));
    if arr.len() != before {
        n.dropped += 1;
    }
    for c in arr.iter_mut() {
        let c = c.as_object_mut().unwrap();
        if !is_str(c.get("who")) {
            c.insert("who".into(), json!(""));
        }
        for k in ["id", "re"] {
            if c.contains_key(k) && !is_str(c.get(k)) {
                c.shift_remove(k);
            }
        }
        if c.contains_key("ed") && !num_at(c, "ed") {
            c.shift_remove("ed");
        }
        if c.contains_key("del") && !c.get("del").is_some_and(|v| v.is_boolean()) {
            c.shift_remove("del");
        }
        if c.contains_key("res") && !c.get("res").and_then(|r| r.as_object()).is_some_and(|r| num_at(r, "at") && is_str(r.get("who"))) {
            c.shift_remove("res");
        }
    }
}

fn repair_votes(raw: &mut Obj, n: &mut Counts) {
    if !raw.contains_key("votes") {
        return;
    }
    let Some(arr) = raw.get_mut("votes").and_then(|c| c.as_array_mut()) else {
        raw.shift_remove("votes");
        n.entries += 1;
        return;
    };
    let before = arr.len();
    arr.retain(|v| v.as_object().is_some_and(|v| num_at(v, "at") && is_str(v.get("who")) && is_str(v.get("on")) && v.get("v").and_then(|x| x.as_f64()).is_some_and(|x| x == 1.0 || x == -1.0 || x == 0.0)));
    if arr.len() != before {
        n.dropped += 1;
    }
    if arr.is_empty() {
        raw.shift_remove("votes");
    }
}

fn repair_drops(raw: &mut Obj, n: &mut Counts) {
    if !raw.contains_key("drops") {
        return;
    }
    let Some(arr) = raw.get_mut("drops").and_then(|c| c.as_array_mut()) else {
        raw.shift_remove("drops");
        n.entries += 1;
        return;
    };
    let before = arr.len();
    arr.retain(|d| d.as_object().is_some_and(|d| num_at(d, "at") && is_str(d.get("who")) && is_str(d.get("on"))));
    if arr.len() != before {
        n.dropped += 1;
    }
    for d in arr.iter_mut() {
        let d = d.as_object_mut().unwrap();
        if d.contains_key("off") && !d.get("off").is_some_and(|v| v.is_boolean()) {
            d.shift_remove("off");
        }
    }
    if arr.is_empty() {
        raw.shift_remove("drops");
    }
}

fn repair_history(raw: &mut Obj, n: &mut Counts) {
    if !raw.contains_key("history") {
        return;
    }
    let Some(arr) = raw.get_mut("history").and_then(|c| c.as_array_mut()) else {
        raw.shift_remove("history");
        n.entries += 1;
        return;
    };
    let before = arr.len();
    arr.retain(|h| h.as_object().is_some_and(|h| num_at(h, "at") && is_str(h.get("text")) && is_str(h.get("what"))));
    if arr.len() != before {
        n.dropped += 1;
    }
    for h in arr.iter_mut() {
        let h = h.as_object_mut().unwrap();
        if !is_str(h.get("who")) {
            h.insert("who".into(), json!(""));
        }
        if h.contains_key("batch") && !is_str(h.get("batch")) {
            h.shift_remove("batch");
        }
        if h.contains_key("prev") {
            let ok = h.get("prev").and_then(|p| p.as_object()).is_some_and(|p| is_str(p.get("target")));
            if !ok {
                h.shift_remove("prev");
            } else {
                let p = h.get_mut("prev").unwrap().as_object_mut().unwrap();
                if !known_status(p.get("status")) {
                    p.insert("status".into(), json!("new"));
                }
                if p.contains_key("returned") && !p.get("returned").is_some_and(|v| v.is_boolean()) {
                    p.shift_remove("returned");
                }
            }
        }
    }
}

/// JS `String(number)` для чисел з JSON.
fn js_number_string(n: &serde_json::Number) -> String {
    match n.as_i64() {
        Some(i) => i.to_string(),
        None => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{}", f as i128),
            Some(f) => format!("{f}"),
            None => n.to_string(),
        },
    }
}

/// Один рядок: хибні типи виправляються, коли зміст ясний (число як текст), інакше рядок відкидається.
fn repair_entry(raw: &mut Value, n: &mut Counts) -> bool {
    let Some(o) = raw.as_object_mut() else {
        n.dropped += 1;
        return false;
    };
    let mut touched = false;
    if !is_str(o.get("target")) {
        match o.get("target").cloned() {
            Some(Value::Number(x)) => {
                o.insert("target".into(), json!(js_number_string(&x)));
                touched = true;
            }
            Some(Value::Bool(b)) => {
                o.insert("target".into(), json!(b.to_string()));
                touched = true;
            }
            _ => {
                n.dropped += 1;
                return false;
            }
        }
    }
    if !known_status(o.get("status")) {
        let t = o.get("target").and_then(|t| t.as_str()).unwrap_or("");
        o.insert("status".into(), json!(if t.is_empty() { "new" } else { "draft" }));
        touched = true;
    }
    if !num_at(o, "mt") {
        o.insert("mt".into(), json!(0));
        touched = true;
    }
    for k in ["src", "orig"] {
        if o.contains_key(k) && !is_str(o.get(k)) {
            o.shift_remove(k);
            touched = true;
        }
    }
    if o.contains_key("returned") && !o.get("returned").is_some_and(|v| v.is_boolean()) {
        o.shift_remove("returned");
        touched = true;
    }
    if o.contains_key("ign") && !o.get("ign").is_some_and(strs) {
        o.shift_remove("ign");
        touched = true;
    }
    if o.contains_key("ignAt") && !num_at(o, "ignAt") {
        o.shift_remove("ignAt");
        touched = true;
    }
    repair_comments(o, n);
    repair_votes(o, n);
    repair_drops(o, n);
    repair_history(o, n);
    if touched {
        n.entries += 1;
    }
    true
}

fn repair_files_map(fs: &mut Obj, n: &mut Counts) {
    let names: Vec<String> = fs.keys().cloned().collect();
    for name in names {
        let ok = fs.get(&name).is_some_and(is_obj);
        if !ok {
            fs.shift_remove(&name);
            n.dropped += 1;
            continue;
        }
        let f = fs.get_mut(&name).unwrap().as_object_mut().unwrap();
        let keys: Vec<String> = f.keys().cloned().collect();
        for key in keys {
            if !repair_entry(f.get_mut(&key).unwrap(), n) {
                f.shift_remove(&key);
            }
        }
    }
}

fn repair_settings(raw: Option<&mut Value>, n: &mut Counts) {
    let Some(raw) = raw.and_then(|r| r.as_object_mut()) else { return };
    let mut fix = |k: &str, ok: &dyn Fn(&Value) -> bool| {
        if raw.get(k).is_some_and(|v| !ok(v)) {
            raw.shift_remove(k);
            n.settings += 1;
        }
    };
    let is_bool = |v: &Value| v.is_boolean();
    let is_string = |v: &Value| v.is_string();
    fix("tolerancePct", &num);
    fix("who", &is_string);
    fix("blockErrors", &is_bool);
    fix("propagate", &is_bool);
    fix("pluginCommands", &strs);
    fix("pluginsAsked", &is_bool);
    fix("lineLimit", &num);
    fix("linkMode", &|v| matches!(v.as_str(), Some("off" | "ask" | "auto")));
    fix("wrap", &is_obj);
    fix("qa", &is_obj);
    fix("hue", &|v| v.as_f64().is_some_and(|h| (0.0..360.0).contains(&h)));
    fix("nameFrom", &|v| matches!(v.as_str(), Some("folder" | "game" | "custom")));
    fix("title", &|v| v.as_str().is_some_and(|s| js::len16(s) <= 80));
    fix("folderName", &|v| v.as_str().is_some_and(|s| js::len16(s) <= 80));
    fix("iconText", &|v| v.as_str().is_some_and(|s| js::len16(s) <= 4));
    fix("pluginSettings", &|v| {
        v.as_object().is_some_and(|o| {
            o.len() <= 64
                && o.values().all(|p| {
                    p.as_object().is_some_and(|po| {
                        po.len() <= 64
                            && po.values().all(|x| match x {
                                Value::String(s) => js::len16(s) <= 500,
                                Value::Number(_) | Value::Bool(_) => true,
                                _ => false,
                            })
                    })
                })
        })
    });
}

static HEX_COLOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^#[0-9a-f]{3,8}$").unwrap());

/// Робить розібраний проєкт правильно типізованим, на місці. Повертає короткі українські примітки про виправлене чи відкинуте
/// (порожньо, коли все було гаразд). Невідомі поля верхнього рівня не чіпаються (вони від новішої версії).
pub fn repair_project(o: &mut Obj) -> Vec<String> {
    let mut n = Counts::default();
    for k in ["resetEpoch", "settingsAt", "assetsRev"] {
        if o.contains_key(k) && !num_at(o, k) {
            if k == "resetEpoch" {
                o.insert(k.into(), json!(0));
            } else {
                o.shift_remove(k);
            }
            n.other += 1;
        }
    }
    if let Some(files) = o.get_mut("files").and_then(|f| f.as_object_mut()) {
        repair_files_map(files, &mut n);
    }
    if o.contains_key("settings") && !o.get("settings").is_some_and(is_obj) {
        o.shift_remove("settings");
        n.settings += 1;
    }
    repair_settings(o.get_mut("settings"), &mut n);
    if o.contains_key("memory") {
        match o.get_mut("memory").and_then(|m| m.as_array_mut()) {
            None => {
                o.insert("memory".into(), json!([]));
                n.other += 1;
            }
            Some(arr) => {
                let before = arr.len();
                arr.retain(|m| m.as_object().is_some_and(|m| is_str(m.get("s")) && is_str(m.get("t"))));
                n.dropped += before - arr.len();
                for m in arr.iter_mut() {
                    let m = m.as_object_mut().unwrap();
                    if !num_at(m, "mt") {
                        m.insert("mt".into(), json!(0));
                    }
                }
            }
        }
    }
    if o.contains_key("terms") {
        match o.get_mut("terms").and_then(|m| m.as_array_mut()) {
            None => {
                o.insert("terms".into(), json!([]));
                n.other += 1;
            }
            Some(arr) => {
                let before = arr.len();
                arr.retain(|t| t.as_object().is_some_and(|t| is_str(t.get("en")) && is_str(t.get("uk"))));
                n.dropped += before - arr.len();
                for t in arr.iter_mut() {
                    let t = t.as_object_mut().unwrap();
                    if !num_at(t, "mt") {
                        t.insert("mt".into(), json!(0));
                    }
                    if t.contains_key("alt") && !t.get("alt").is_some_and(strs) {
                        t.shift_remove("alt");
                    }
                    if t.contains_key("qa") && !t.get("qa").is_some_and(|v| v.is_boolean()) {
                        t.shift_remove("qa");
                    }
                    if t.contains_key("gender") && !matches!(t.get("gender").and_then(|g| g.as_str()), Some("m" | "f" | "n" | "p")) {
                        t.shift_remove("gender");
                    }
                }
            }
        }
    }
    #[allow(clippy::type_complexity)]
    fn record(o: &mut Obj, n: &mut Counts, k: &str, ok: &dyn Fn(&Obj) -> bool, fix_item: Option<&dyn Fn(&mut Obj, &str, &mut Counts)>) {
        let Some(r) = o.get_mut(k) else { return };
        let Some(r) = r.as_object_mut() else {
            o.shift_remove(k);
            n.other += 1;
            return;
        };
        let ids: Vec<String> = r.keys().cloned().collect();
        for id in ids {
            let good = r.get(&id).and_then(|v| v.as_object()).is_some_and(ok);
            if !good {
                r.shift_remove(&id);
                n.dropped += 1;
            } else if let Some(f) = fix_item {
                f(r.get_mut(&id).unwrap().as_object_mut().unwrap(), &id, n);
            }
        }
    }
    record(o, &mut n, "speakers", &|v| is_str(v.get("name")) && num_at(v, "mt"), None);
    record(
        o,
        &mut n,
        "groups",
        &|v| is_str(v.get("name")) && num_at(v, "mt"),
        Some(&|v: &mut Obj, id: &str, n: &mut Counts| {
            if !is_str(v.get("id")) {
                v.insert("id".into(), json!(id));
            }
            if !num_at(v, "at") {
                let mt = v.get("mt").cloned().unwrap_or(Value::Null);
                v.insert("at".into(), mt);
            }
            // колір іде в атрибут style: лишаються лише звичайні шістнадцяткові кольори
            if v.contains_key("color") && !v.get("color").and_then(|c| c.as_str()).is_some_and(|c| HEX_COLOR.is_match(c)) {
                v.shift_remove("color");
                n.other += 1;
            }
        }),
    );
    record(o, &mut n, "members", &|v| is_str(v.get("g")) && num_at(v, "mt"), None);
    // гілки: запарковані рядки лагодяться як рядки проєкту; гілка хибної форми відкидається
    if o.contains_key("branch") && !o.get("branch").and_then(|b| b.as_str()).is_some_and(|b| !b.is_empty()) {
        o.shift_remove("branch");
    }
    match o.get_mut("goneBranches") {
        Some(Value::Object(g)) => {
            let ks: Vec<String> = g.keys().cloned().collect();
            for k in ks {
                if !g.get(&k).is_some_and(num) {
                    g.shift_remove(&k);
                }
            }
        }
        Some(_) => {
            o.shift_remove("goneBranches");
        }
        None => {}
    }
    match o.get_mut("branches") {
        Some(Value::Object(brs)) => {
            let names: Vec<String> = brs.keys().cloned().collect();
            for name in names {
                let valid = brs.get(&name).and_then(|b| b.as_object()).is_some_and(|b| num_at(b, "at"));
                if !valid {
                    brs.shift_remove(&name);
                    n.dropped += 1;
                    continue;
                }
                let br = brs.get_mut(&name).unwrap().as_object_mut().unwrap();
                if br.contains_key("from") && !is_str(br.get("from")) {
                    br.shift_remove("from");
                }
                for k in ["files", "base"] {
                    if br.contains_key(k) {
                        match br.get_mut(k).and_then(|f| f.as_object_mut()) {
                            Some(fs) => repair_files_map(fs, &mut n),
                            None => {
                                br.shift_remove(k);
                            }
                        }
                    }
                }
            }
        }
        Some(_) => {
            o.shift_remove("branches");
        }
        None => {}
    }
    match o.get_mut("deletedTerms") {
        Some(Value::Object(d)) => {
            let ks: Vec<String> = d.keys().cloned().collect();
            for k in ks {
                if !d.get(&k).is_some_and(num) {
                    d.shift_remove(&k);
                }
            }
        }
        Some(_) => {
            o.shift_remove("deletedTerms");
        }
        None => {}
    }
    match o.get_mut("snapshot") {
        Some(Value::Object(snap)) => {
            let names: Vec<String> = snap.keys().cloned().collect();
            for name in names {
                let Some(units) = snap.get_mut(&name).and_then(|u| u.as_array_mut()) else {
                    snap.shift_remove(&name);
                    n.dropped += 1;
                    continue;
                };
                let before = units.len();
                units.retain(|u| u.as_object().is_some_and(|u| is_str(u.get("key")) && is_str(u.get("source"))));
                n.dropped += before - units.len();
            }
        }
        Some(_) => {
            o.shift_remove("snapshot");
            n.other += 1;
        }
        None => {}
    }
    let mut notes = Vec::new();
    if n.entries > 0 {
        notes.push(format!("виправлено рядків із неправильними даними: {}", n.entries));
    }
    if n.dropped > 0 {
        notes.push(format!("відкинуто непридатних записів: {}", n.dropped));
    }
    if n.settings > 0 {
        notes.push(format!("скинуто неправильних налаштувань: {}", n.settings));
    }
    if n.other > 0 {
        notes.push(format!("виправлено інших полів: {}", n.other));
    }
    notes
}

/// Наскільки попереду годинника цього пристрою може бути часова мітка, щоб їй ще вірили (хибний годинник на іншому пристрої).
pub const MAX_AHEAD_MS: i64 = 24 * 3600 * 1000;

/// Тягне часові мітки, що лежать більш ніж на добу в майбутньому, назад до `now`. Повертає, скільки мітки було повернуто.
pub fn clamp_clock(o: &mut Obj, now: i64, ahead: i64) -> usize {
    let limit = now + ahead;
    let mut n = 0;
    fn fix(r: &mut Obj, k: &str, now: i64, limit: i64, n: &mut usize) {
        if r.get(k).and_then(|v| v.as_f64()).is_some_and(|v| v > limit as f64) {
            r.insert(k.into(), json!(now));
            *n += 1;
        }
    }
    for k in ["resetEpoch", "settingsAt", "assetsRev"] {
        fix(o, k, now, limit, &mut n);
    }
    fn fix_files(fs: &mut Value, now: i64, limit: i64, n: &mut usize) {
        let Some(fs) = fs.as_object_mut() else { return };
        for f in fs.values_mut() {
            let Some(f) = f.as_object_mut() else { continue };
            for e in f.values_mut() {
                let Some(e) = e.as_object_mut() else { continue };
                fix(e, "mt", now, limit, n);
                fix(e, "ignAt", now, limit, n);
                if let Some(Value::Array(cs)) = e.get_mut("comments") {
                    for c in cs.iter_mut().filter_map(|c| c.as_object_mut()) {
                        fix(c, "at", now, limit, n);
                        fix(c, "ed", now, limit, n);
                        if let Some(Value::Object(res)) = c.get_mut("res") {
                            fix(res, "at", now, limit, n);
                        }
                    }
                }
                for k in ["votes", "drops", "history"] {
                    if let Some(Value::Array(vs)) = e.get_mut(k) {
                        for v in vs.iter_mut().filter_map(|v| v.as_object_mut()) {
                            fix(v, "at", now, limit, n);
                        }
                    }
                }
            }
        }
    }
    if let Some(f) = o.get_mut("files") {
        fix_files(f, now, limit, &mut n);
    }
    if let Some(Value::Object(brs)) = o.get_mut("branches") {
        for br in brs.values_mut().filter_map(|b| b.as_object_mut()) {
            for k in ["files", "base"] {
                if let Some(f) = br.get_mut(k) {
                    fix_files(f, now, limit, &mut n);
                }
            }
        }
    }
    for k in ["memory", "terms"] {
        if let Some(Value::Array(list)) = o.get_mut(k) {
            for v in list.iter_mut().filter_map(|v| v.as_object_mut()) {
                fix(v, "mt", now, limit, &mut n);
            }
        }
    }
    for k in ["speakers", "groups", "members"] {
        if let Some(Value::Object(r)) = o.get_mut(k) {
            for v in r.values_mut().filter_map(|v| v.as_object_mut()) {
                fix(v, "mt", now, limit, &mut n);
                fix(v, "at", now, limit, &mut n);
            }
        }
    }
    if let Some(Value::Object(d)) = o.get_mut("deletedTerms") {
        let ks: Vec<String> = d.keys().cloned().collect();
        for k in ks {
            fix(d, &k, now, limit, &mut n);
        }
    }
    n
}
