mod common;

use common::{assert_same, cases, get, to_value};
use serde_json::{json, Value};
use transly_core::model::GameFile;
use transly_core::plugins::*;
use transly_core::project::SavedProject;
use transly_core::session::adopt_synced;
use transly_core::update::*;

fn platform(s: &str) -> Platform {
    match s {
        "android" => Platform::Android,
        "windows" => Platform::Windows,
        "mac" => Platform::Mac,
        _ => Platform::Linux,
    }
}

fn asset_json(a: &ReleaseAsset) -> Value {
    let mut m = json!({ "name": a.name, "url": a.url, "size": a.size });
    if let Some(d) = &a.digest {
        m["digest"] = json!(d);
    }
    m
}

#[test]
fn plugins_match() {
    for (i, c) in cases("misc4", "candidates").iter().enumerate() {
        let game: Vec<GameFile> = serde_json::from_value(c.input.clone()).unwrap();
        assert_same("candidates", i, &c.input, &to_value(&plugin_candidates(&game)), &c.output);
    }
    for (i, c) in cases("misc4", "prose").iter().enumerate() {
        assert_same("prose", i, &c.input, &json!(looks_like_prose(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn update_matches() {
    for (i, c) in cases("misc4", "update").iter().enumerate() {
        let s = |k: &str| c.input[k].as_str().unwrap();
        let got = json!({ "avail": update_available(s("a"), s("b"), s("p"), s("t")), "same": same_build(s("a"), s("b")) });
        assert_same("update", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("misc4", "platform").iter().enumerate() {
        let got = platform_of(c.input["and"].as_bool().unwrap(), c.input["desk"].as_bool().unwrap(), c.input["ua"].as_str().unwrap()).map(Platform::as_str);
        assert_same("platform", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("misc4", "tag").iter().enumerate() {
        assert_same("tag", i, &c.input, &json!(release_tag(platform(c.input.as_str().unwrap()))), &c.output);
    }
    for (i, c) in cases("misc4", "asset").iter().enumerate() {
        let assets: Vec<ReleaseAsset> = c.input["names"].as_array().unwrap().iter().map(|n| ReleaseAsset { name: n.as_str().unwrap().into(), url: format!("u/{}", n.as_str().unwrap()), size: 1.0, digest: None }).collect();
        let got = pick_asset(platform(c.input["p"].as_str().unwrap()), &assets).map(|a| a.name.clone());
        assert_same("asset", i, &c.input, &json!(got), &c.output);
    }
    for (i, c) in cases("misc4", "release").iter().enumerate() {
        let got = parse_release(&c.input).map_or(Value::Null, |r| json!({ "sha": r.sha, "published": r.published, "assets": r.assets.iter().map(asset_json).collect::<Vec<_>>() }));
        assert_same("release", i, &c.input, &got, &c.output);
    }
}

#[test]
fn adopt_matches() {
    for (i, c) in cases("misc4", "adopt").iter().enumerate() {
        let live: SavedProject = get(&c.input, "live");
        let synced: SavedProject = get(&c.input, "synced");
        let got = json!({ "merged": to_value(&adopt_synced(&live, &synced, false)), "same": to_value(&adopt_synced(&live, &live, true)) });
        assert_same("adopt", i, &c.input, &got, &c.output);
    }
}
