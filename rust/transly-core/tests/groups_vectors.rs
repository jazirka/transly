mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Map, Value};
use transly_core::groups::*;
use transly_core::journal::SavedFiles;
use transly_core::links::*;
use transly_core::project::{empty_project, FileView, SavedProject};
use transly_core::scene::*;
use transly_core::speakers::*;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn opt_str(v: &Value) -> Option<&str> {
    v.as_str()
}

#[test]
fn scene_matches() {
    for (i, c) in cases("groups", "sceneKey").iter().enumerate() {
        assert_same("sceneKey", i, &c.input, &json!(scene_key(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("groups", "sceneAddress").iter().enumerate() {
        assert_same("sceneAddress", i, &c.input, &json!(scene_address(s(&c.input, "f"), s(&c.input, "k"))), &c.output);
    }
    for (i, c) in cases("groups", "sceneIndex").iter().enumerate() {
        let views: Vec<FileView> = serde_json::from_value(c.input.clone()).unwrap();
        let got: Vec<Value> = views
            .iter()
            .map(|v| {
                let ix = build_scene_index(&v.units);
                let keys: Vec<&String> = v.units.iter().map(|u| &u.key).collect();
                let index = ix.as_ref().map(|ix| json!({ "scenes": ix.scenes, "byKey": ix.by_key.iter().map(|(k, i)| json!([k, i])).collect::<Vec<_>>(), "loose": ix.loose }));
                json!({
                    "index": index,
                    "at": keys.iter().map(|k| scene_at(ix.as_ref(), k).map(|s| s.id.clone())).collect::<Vec<_>>(),
                    "titles": ix.as_ref().map(|ix| ix.scenes.iter().map(scene_title).collect::<Vec<_>>()),
                    "steps": keys.iter().map(|k| json!([step_scene(ix.as_ref(), k, 1).map(|s| s.id.clone()), step_scene(ix.as_ref(), k, -1).map(|s| s.id.clone())])).collect::<Vec<_>>(),
                    "atNull": scene_at(None, "x").map(|s| s.id.clone()),
                    "stepNull": step_scene(None, "x", 1).map(|s| s.id.clone()),
                    "units": keys.iter().take(6).map(|k| json!([scene_units(&v.units, k, 12).iter().map(|u| u.key.clone()).collect::<Vec<_>>(), scene_units(&v.units, k, 2).iter().map(|u| u.key.clone()).collect::<Vec<_>>()])).collect::<Vec<_>>(),
                    "unitsMissing": scene_units(&v.units, "nope", 12).len(),
                    "lines": ix.as_ref().map_or(vec![], |ix| ix.scenes.iter().map(|s| to_value(&scene_lines(&s.units))).collect()),
                })
            })
            .collect();
        // у TS `index` для файлу без сцен — null, у Rust теж None → null
        assert_same("sceneIndex", i, &c.input, &json!(got), &c.output);
    }
}

#[test]
fn speakers_match() {
    for (i, c) in cases("groups", "headerName").iter().enumerate() {
        assert_same("headerName", i, &c.input, &json!(header_name(opt_str(&c.input))), &c.output);
    }
    for (i, c) in cases("groups", "speakers").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let map: Option<Map<String, Value>> = c.input["map"].as_object().cloned();
        let of: Vec<String> = views
            .iter()
            .flat_map(|v| v.units.iter())
            .map(|u| speaker_of(&SpeakerRow { speaker: &u.speaker, face: u.face.as_deref(), event: u.event.as_deref(), note: u.note.as_deref(), source: Some(&u.source) }, map.as_ref()))
            .collect();
        let got = json!({ "of": of, "cands": to_value(&speaker_candidates(&views, 3)), "cands1": to_value(&speaker_candidates(&views, 1)) });
        assert_same("speakers", i, &c.input, &got, &c.output);
    }
}

#[test]
fn groups_match() {
    let e = &cases("groups", "groupsEmpty")[0].output;
    let none = GroupData::default();
    assert_eq!(e["live"], to_value(&live_groups(&none)));
    assert_eq!(e["rows"], json!([]));
    assert_eq!(e["create"], Value::Null);
    assert!(create_group(&mut GroupData::default(), "   ", 1, None, "abcd").is_none());
    assert_eq!(e["idx"], Value::Null);
    for (i, c) in cases("groups", "groups").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let changed: Vec<FileView> = get(&c.input, "changed");
        let mut p = GroupData::default();
        let mut results: Vec<Value> = Vec::new();
        for op in c.input["ops"].as_array().unwrap() {
            let now = op["now"].as_i64().unwrap();
            let res = match s(op, "kind") {
                "create" => to_value(&create_group(&mut p, s(op, "name"), now, op["color"].as_str(), s(op, "suffix"))),
                "rename" => to_value(&rename_group(&mut p, s(op, "id"), s(op, "name"), now)),
                "recolor" => json!(recolor_group(&mut p, s(op, "id"), s(op, "color"), now)),
                "delete" => json!(delete_group(&mut p, s(op, "id"), now)),
                "rows" => {
                    let rows: Vec<RowRef> = op["rows"].as_array().unwrap().iter().map(|r| RowRef { file: s(r, "file").into(), key: s(r, "key").into() }).collect();
                    json!(place_rows(&mut p, &views, &rows, opt_str(&op["id"]), now))
                }
                "scene" => {
                    place_scene(&mut p, s(op, "file"), s(op, "scene"), opt_str(&op["id"]), now);
                    Value::Null
                }
                _ => {
                    place_file(&mut p, s(op, "file"), opt_str(&op["id"]), now);
                    Value::Null
                }
            };
            results.push(res);
        }
        let rows: Vec<RowRef> = views.iter().flat_map(|v| v.units.iter().map(|u| RowRef { file: v.name.clone(), key: u.key.clone() })).collect();
        let idx = GroupIndex::new(&p);
        let speakers: Option<Map<String, Value>> = c.input["speakers"].as_object().cloned();
        let gid = s(&c.input, "gid");
        let got = json!({
            "results": results,
            "p": to_value(&p),
            "live": to_value(&live_groups(&p)),
            "index": { "empty": idx.empty, "of": rows.iter().map(|x| json!([idx.group_of(&x.file, &x.key, false), idx.group_of(&x.file, &x.key, true)])).collect::<Vec<_>>() },
            "rows": group_rows(&p, &views).into_iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(),
            "rowsOf": to_value(&rows_of_group(&p, &views, gid)),
            "orphans": to_value(&find_orphans(&p, &changed)),
            "orphansAll": to_value(&find_orphans(&p, &views)),
            "progress": to_value(&rows_progress(&rows, &files)),
            "bySpeaker": to_value(&group_by_speaker(&views, speakers.as_ref())),
            "byScene": to_value(&group_by_scene(&views)),
        });
        assert_same("groups", i, &c.input, &got, &c.output);
    }
}

fn view_json(v: &LinkView) -> Value {
    let mut o = json!({ "text": v.text, "rows": to_value(&v.rows), "self": v.self_i });
    if let Some(r) = v.reference {
        o["reference"] = json!(r);
    }
    if let Some(m) = v.main {
        o["main"] = json!(m);
    }
    o
}

fn clusters_json(c: &(Vec<LinkCluster>, usize)) -> Value {
    json!({
        "total": c.1,
        "clusters": c.0.iter().map(|k| json!({ "text": k.text, "view": view_json(&k.view), "counts": k.counts, "variants": k.variants.iter().map(|x| json!({ "target": x.target, "rows": x.rows })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
    })
}

#[test]
fn links_match() {
    for (i, c) in cases("groups", "linkMode").iter().enumerate() {
        let m = c.input.as_object();
        assert_same("linkMode", i, &c.input, &to_value(&link_mode_of(m)), &c.output);
    }
    for (i, c) in cases("groups", "links").iter().enumerate() {
        let views: Vec<FileView> = get(&c.input, "views");
        let files: SavedFiles = get(&c.input, "files");
        let mut saved: SavedProject = empty_project("x", "en", "uk");
        saved.files = files;
        let idx = LinkIndex::new(&views);
        for op in c.input["ops"].as_array().unwrap() {
            let (file, key, now) = (s(op, "file"), s(op, "key"), op["now"].as_i64().unwrap());
            let src = views.iter().find(|v| v.name == file).unwrap().units.iter().find(|u| u.key == key).unwrap().source.clone();
            match s(op, "kind") {
                "unlink" => unlink_row(&mut saved, file, key, s(op, "source"), now),
                "main" => set_main(&mut saved, file, key, s(op, "source"), now),
                "clearMain" => clear_main(&mut saved, &src, now),
                _ => relink_row(&mut saved, file, key, now),
            }
        }
        let sample: Vec<(String, String)> = c.input["sample"].as_array().unwrap().iter().map(|x| (s(x, "file").to_string(), s(x, "key").to_string())).collect();
        let now = c.input["now"].as_i64().unwrap();
        let per: Vec<Value> = sample
            .iter()
            .map(|(file, key)| {
                let plan = plan_link_sync(&saved, &idx, file, key);
                let v = link_view(&saved, &idx, file, key);
                let modes: Vec<Value> = [LinkMode::Ask, LinkMode::Auto, LinkMode::Off].iter().map(|m| to_value(&after_send(&saved, &idx, *m, file, key, now))).collect();
                let changes = plan.as_ref().map(|p| {
                    let rf = p.view.reference.unwrap();
                    let fills: Vec<&LinkRowView> = p.fills.iter().map(|&i| &p.view.rows[i]).collect();
                    to_value(&link_changes(&p.view.rows[rf].target, &fills, now))
                });
                json!({
                    "file": file, "key": key, "others": idx.others(file, key),
                    "view": v.as_ref().map(view_json),
                    "plan": plan.as_ref().map(|p| json!({ "view": view_json(&p.view), "fills": p.fills, "updates": p.updates, "edited": p.edited })),
                    "modes": modes, "changes": changes,
                })
            })
            .collect();
        let got = json!({
            "links": saved.links.clone().map_or(Value::Null, Value::Object),
            "size": idx.size(),
            "per": per,
            "pending": pending_links(&saved, &idx, &sample),
            "review": clusters_json(&review_clusters(&saved, &idx, 300)),
            "reviewSmall": clusters_json(&review_clusters(&saved, &idx, 1)),
            "clusters": idx.clusters().map(|(t, r)| json!([t, r.len()])).collect::<Vec<_>>(),
        });
        assert_same("links", i, &c.input, &got, &c.output);
    }
}
