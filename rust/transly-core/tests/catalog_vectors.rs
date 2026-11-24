mod common;

use common::{assert_same, cases, to_value};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::catalog::*;
use transly_core::i18n::I18n;
use transly_core::registry::{PluginRecord, PluginRegistry, PluginSource};
use transly_core::sources::*;

fn spec_json(g: &Option<GithubSpec>) -> Value {
    g.as_ref().map_or(Value::Null, |g| {
        let mut m = json!({ "owner": g.owner, "repo": g.repo });
        if let Some(r) = &g.r#ref {
            m["ref"] = json!(r);
        }
        if let Some(d) = &g.dir {
            m["dir"] = json!(d);
        }
        m
    })
}

fn index_json(i: &CatalogIndex) -> Value {
    json!({ "name": i.name, "entries": to_value(&i.entries), "warnings": i.warnings })
}

fn entry_of(v: &Value) -> CatalogEntry {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(String::from);
    CatalogEntry {
        id: s("id").unwrap(),
        name: s("name").unwrap(),
        description: s("description"),
        version: s("version"),
        author: s("author"),
        homepage: s("homepage"),
        tags: v["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().into()).collect(),
        languages: v.get("languages").and_then(Value::as_array).map(|a| a.iter().map(|t| t.as_str().unwrap().into()).collect()),
        detect: v.get("detect").cloned(),
        requires: v.get("requires").cloned(),
        source: CatalogSource::Github { r#ref: v["source"]["ref"].as_str().unwrap().into() },
        origin: s("origin"),
    }
}

fn source_of(v: &Value) -> CatalogSource {
    match v["kind"].as_str().unwrap() {
        "github" => CatalogSource::Github { r#ref: v["ref"].as_str().unwrap().into() },
        "url" => CatalogSource::Url { url: v["url"].as_str().unwrap().into() },
        _ => CatalogSource::Bundled { key: v["key"].as_str().unwrap().into() },
    }
}

#[test]
fn sources_match() {
    for (i, c) in cases("catalog", "githubRef").iter().enumerate() {
        assert_same("githubRef", i, &c.input, &spec_json(&parse_github_ref(c.input.as_str().unwrap())), &c.output);
    }
    for (i, c) in cases("catalog", "allowedUrl").iter().enumerate() {
        assert_same("allowedUrl", i, &c.input, &json!(allowed_url(c.input.as_str().unwrap()).map(|u| u.as_str().to_string())), &c.output);
    }
    for (i, c) in cases("catalog", "files").iter().enumerate() {
        let files: Vec<(String, Vec<u8>)> = c.input.as_array().unwrap().iter().map(|f| (f["name"].as_str().unwrap().to_string(), f["data"].as_str().unwrap().as_bytes().to_vec())).collect();
        let (entries, source) = entries_from_files(&files).unwrap();
        assert_same("files", i, &c.input, &json!({ "names": entries.keys().collect::<Vec<_>>(), "kind": source.kind }), &c.output);
    }
}

#[test]
fn refs_and_addresses_match() {
    for (i, c) in cases("catalog", "catalogRef").iter().enumerate() {
        let r = parse_catalog_ref(c.input.as_str().unwrap());
        let got = json!({ "ref": to_value(&r), "addr": r.as_ref().and_then(catalog_address) });
        assert_same("catalogRef", i, &c.input, &got, &c.output);
    }
    for (i, c) in cases("catalog", "address").iter().enumerate() {
        let s = c.input.as_str().unwrap();
        let kind = if s.starts_with("http") { "url" } else { "github" };
        let r = CatalogRef { id: "x".into(), kind: kind.into(), location: s.into(), name: None };
        assert_same("address", i, &c.input, &json!(catalog_address(&r)), &c.output);
    }
}

#[test]
fn check_matches() {
    for (i, c) in cases("catalog", "check").iter().enumerate() {
        let res = check_catalog(&c.input, "fallback");
        let got = match &res {
            Ok(idx) if c.output["index"]["entries"].is_number() => json!({ "ok": true, "index": { "name": idx.name, "entries": idx.entries.len(), "warnings": idx.warnings } }),
            Ok(idx) => json!({ "ok": true, "index": index_json(idx) }),
            // текст помилки розбору JSON різний у V8 й serde
            Err(_) if c.input.is_string() => json!({ "ok": false, "errors": "string" }),
            Err(e) => json!({ "ok": false, "errors": e }),
        };
        assert_same("check", i, &c.input, &got, &c.output);
    }
}

#[test]
fn entry_of_manifest_matches() {
    for (i, c) in cases("catalog", "entryOfManifest").iter().enumerate() {
        let e = entry_of_manifest(&c.input["m"], source_of(&c.input["src"]));
        assert_same("entryOfManifest", i, &c.input, &to_value(&e), &c.output);
    }
}

#[test]
fn catalogs_match() {
    for (i, c) in cases("catalog", "catalog").iter().enumerate() {
        let indexes: Vec<CatalogIndex> = c.input["indexes"].as_array().unwrap().iter().map(|ix| CatalogIndex { name: ix["name"].as_str().unwrap().into(), entries: ix["entries"].as_array().unwrap().iter().map(entry_of).collect(), warnings: vec![] }).collect();
        let mut i18n = I18n::new();
        let mut reg = PluginRegistry::new(None, None);
        for p in c.input["installed"].as_array().unwrap() {
            let (id, v) = (p[0].as_str().unwrap(), p[1].as_str().unwrap());
            let m = json!({ "manifestVersion": 1, "id": id, "name": id, "version": v });
            reg.add(PluginRecord::new(m, false, true, vec![], IndexMap::new(), PluginSource { kind: "file".into(), ..Default::default() }), false, &mut i18n);
        }
        let merged = merge_catalogs(&indexes);
        let paths: Vec<String> = c.input["paths"].as_array().unwrap().iter().map(|p| p.as_str().unwrap().into()).collect();
        let sug = suggest_from_catalog(&merged, &paths, &reg, c.input["app"].as_str());
        let status: Vec<Value> = merged
            .iter()
            .map(|e| {
                let (s, installed, reason) = catalog_status(e, &reg, None);
                let mut m = json!({ "status": s.as_str() });
                if let Some(v) = installed {
                    m["installed"] = json!(v);
                }
                if let Some(r) = reason {
                    m["reason"] = json!(r);
                }
                m
            })
            .collect();
        let mut filt: Vec<Value> = Vec::new();
        for tag in [None, Some("language"), Some("qa")] {
            for q in ["", "alpha", "polish lang", "anna", "pl", "zzz"] {
                filt.push(json!(filter_catalog(&merged, tag, q).iter().map(|e| format!("{}{}", e.id, e.name)).collect::<Vec<_>>()));
            }
        }
        let got = json!({ "merged": to_value(&merged), "sug": sug.iter().map(|s| json!({ "id": s.entry.id, "score": s.score, "matched": s.matched })).collect::<Vec<_>>(), "status": status, "filt": filt });
        assert_same("catalog", i, &json!(null), &got, &c.output);
    }
}
