mod common;

use common::{assert_same, cases};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::filesync::*;
use transly_core::project::{deserialize, serialize, SavedProject};

struct Mock {
    files: IndexMap<String, Vec<u8>>,
    id: String,
    n: usize,
    pushes: usize,
    is_private: bool,
    interfere: Option<(usize, IndexMap<String, String>)>,
    messages: usize,
}

impl RemoteFiles for Mock {
    fn head(&mut self) -> Result<Head, String> {
        Ok(Head { id: self.id.clone(), files: self.files.iter().map(|(p, b)| (p.clone(), git_blob_sha(b))).collect(), is_private: self.is_private })
    }
    fn read(&mut self, path: &str, _sha: &str) -> Result<Vec<u8>, String> {
        Ok(self.files[path].clone())
    }
    fn push(&mut self, id: &str, changes: &IndexMap<String, Vec<u8>>, _message: &str) -> Result<PushResult, String> {
        self.pushes += 1;
        if let Some((on, files)) = &self.interfere {
            if self.pushes == *on {
                for (p, t) in files {
                    self.files.insert(p.clone(), t.clone().into_bytes());
                }
                self.n += 1;
                self.id = format!("c{}", self.n);
            }
        }
        if id != self.id {
            return Ok(PushResult::Conflict);
        }
        for (p, b) in changes {
            self.files.insert(p.clone(), b.clone());
        }
        self.messages += 1;
        self.n += 1;
        self.id = format!("c{}", self.n);
        Ok(PushResult::Ok(self.id.clone()))
    }
}

impl Mock {
    fn listing(&self) -> Value {
        let mut v: Vec<(&String, String)> = self.files.iter().map(|(p, b)| (p, if p.ends_with(".gz") { String::from_utf8(gunzip(b).unwrap()).unwrap() } else { String::from_utf8(b.clone()).unwrap() })).collect();
        v.sort_by(|a, b| transly_core::js::cmp(a.0, b.0));
        json!(v.into_iter().map(|(p, t)| json!([p, t])).collect::<Vec<_>>())
    }
}

#[test]
fn norm_dir_matches() {
    for (i, c) in cases("filesync", "normDir").iter().enumerate() {
        assert_same("normDir", i, &c.input, &json!(norm_dir(c.input.as_str().unwrap())), &c.output);
    }
}

#[test]
fn project_files_match() {
    for (i, c) in cases("filesync", "files").iter().enumerate() {
        let p = deserialize(c.input["project"].as_str().unwrap(), Some(1)).unwrap();
        let files = project_files(&p, c.input["dir"].as_str().unwrap(), c.input["withAssets"].as_bool().unwrap());
        let mut v: Vec<(&String, String, String)> = files
            .iter()
            .map(|(path, b)| if path.ends_with(".gz") { (path, String::from_utf8(gunzip(b).unwrap()).unwrap(), String::new()) } else { (path, String::from_utf8(b.clone()).unwrap(), git_blob_sha(b)) })
            .collect();
        v.sort_by(|a, b| transly_core::js::cmp(a.0, b.0));
        let got: Vec<Value> = v.into_iter().map(|(p, t, s)| json!([p, t, s])).collect();
        assert_same("files", i, &c.input["dir"], &json!(got), &c.output);
    }
}

#[test]
fn sync_matches() {
    for (i, c) in cases("filesync", "sync").iter().enumerate() {
        let mut devs: Vec<SavedProject> = c.input["initial"].as_array().unwrap().iter().map(|t| deserialize(t.as_str().unwrap(), Some(1)).unwrap()).collect();
        let mut states: Vec<FilesState> = devs.iter().map(|_| FilesState::default()).collect();
        let cfg = FilesOptions { dir: c.input["cfg"]["dir"].as_str().unwrap().to_string(), originals: c.input["cfg"]["originals"].as_bool().unwrap() };
        let interfere = (!c.input["interfere"].is_null()).then(|| (c.input["interfere"]["onPush"].as_u64().unwrap() as usize, c.input["interfere"]["files"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect::<IndexMap<_, _>>()));
        let mut remote = Mock { files: IndexMap::new(), id: "c0".into(), n: 0, pushes: 0, is_private: c.input["isPrivate"].as_bool().unwrap(), interfere, messages: 0 };
        let mut log: Vec<Value> = Vec::new();
        for s in c.input["steps"].as_array().unwrap() {
            let dev = s["dev"].as_u64().unwrap() as usize;
            let mut local = devs[dev].clone();
            for e in s["edit"].as_array().unwrap() {
                let entry = json!({ "target": e["target"], "status": "draft", "mt": e["mt"] });
                local.files.entry(e["file"].as_str().unwrap().to_string()).or_default().insert(e["key"].as_str().unwrap().to_string(), serde_json::from_value(entry).unwrap());
            }
            match sync_files(&mut remote, &cfg, &states[dev], &local, s["since"].as_i64().unwrap(), 6, 4_000_000_000_000) {
                Ok(rep) => {
                    devs[dev] = rep.project.clone();
                    let shas: IndexMap<String, String> = rep.state.shas.iter().filter(|(p, _)| !p.contains("originals/")).map(|(k, v)| (k.clone(), v.clone())).collect();
                    states[dev] = rep.state.clone();
                    log.push(json!({ "ok": {
                        "project": serialize(&rep.project), "pulled": rep.pulled, "pushed": rep.pushed, "conflicts": rep.conflicts, "gotSnapshot": rep.got_snapshot, "skippedOriginals": rep.skipped_originals,
                        "state": { "shas": shas, "commit": rep.state.commit, "assetsRev": rep.state.assets_rev }, "remote": remote.listing(), "id": remote.id, "messages": remote.messages,
                    } }));
                }
                Err(e) => log.push(json!({ "err": e })),
            }
        }
        let want = c.output["log"].as_array().unwrap();
        assert_eq!(want.len(), log.len(), "sync #{i}: число кроків");
        for (k, (g, w)) in log.iter().zip(want).enumerate() {
            if g.get("ok").is_some() && w.get("ok").is_some() {
                // проєкт порівнюється як JSON (порядок полів запису в Rust — порядок структури, в TS — порядок читання)
                let parse = |v: &Value| serde_json::from_str::<Value>(v.as_str().unwrap()).unwrap();
                assert_same(&format!("sync #{i} крок {k} поле project"), i, &json!(null), &parse(&g["ok"]["project"]), &parse(&w["ok"]["project"]));
                for f in ["pulled", "pushed", "conflicts", "gotSnapshot", "skippedOriginals", "state", "remote", "id", "messages"] {
                    assert_same(&format!("sync #{i} крок {k} поле {f}"), i, &json!(null), &g["ok"][f], &w["ok"][f]);
                }
            } else {
                assert_same(&format!("sync #{i} крок {k}"), i, &json!(null), g, w);
            }
        }
    }
}
