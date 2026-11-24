mod common;

use common::{assert_same, cases};
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::builtin::*;
use transly_core::i18n::I18n;
use transly_core::registry::*;

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

fn topic(t: &HelpTopic) -> Value {
    json!({ "plugin": t.plugin, "id": t.id, "title": t.title, "body": t.body, "order": t.order })
}

fn snapshot(reg: &PluginRegistry, i18n: &mut I18n, input: &Value) -> Value {
    let states: Vec<Value> = reg.list().map(|r| json!([r.id(), r.state.as_str(), r.reason])).collect();
    let engines: Vec<Value> = reg
        .engines()
        .iter()
        .map(|e| json!({ "plugin": e.plugin, "id": e.id, "label": e.label, "description": e.description, "features": e.features, "help": e.help, "dataFolders": e.data_folders, "detect": e.detect, "formats": e.formats, "state": e.state.as_str(), "builtin": e.builtin }))
        .collect();
    let detect: Vec<Value> = input["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| json!(reg.detect(&strings(p)).iter().map(|m| json!({ "id": m.engine.id, "score": m.score, "matched": m.matched })).collect::<Vec<_>>()))
        .collect();
    let helps: Vec<Value> = ["general", "engine:e0", "engine:rpgmaker"].iter().map(|t| json!(reg.help(t).iter().map(topic).collect::<Vec<_>>())).collect();
    let refs: Vec<Value> = ["acme.one:h1", "acme.two:h2", "acme.one:none", "nope:h1", "noColon", "transly.rpgmaker:rpgmaker-open"].iter().map(|r| reg.help_by_id(r).map_or(Value::Null, |t| topic(&t))).collect();
    let langs = i18n.languages();
    let prev = i18n.language().to_string();
    let tr: Vec<Value> = langs
        .iter()
        .map(|(code, _)| {
            i18n.set_language(code, &[]);
            json!(input["probes"].as_array().unwrap().iter().map(|p| i18n.t(p[0].as_str().unwrap(), &vec![], p.get(1).and_then(Value::as_str).unwrap_or("core"))).collect::<Vec<_>>())
        })
        .collect();
    i18n.set_language(&prev, &[]);
    let handler_ids: Vec<Option<String>> = ["rpgmaker", "acme.one/f0", "nope"].iter().map(|i| reg.handler(Some(i)).map(|h| h.id.clone())).collect();
    let cmds: Vec<Value> = transly_core::commands::plugin_commands(reg, i18n)
        .iter()
        .map(|c| {
            let mut m = json!({ "ref": c.r#ref, "plugin": c.plugin, "pluginName": c.plugin_name, "title": c.title, "action": c.action });
            if let Some(d) = &c.description { m["description"] = json!(d); }
            if let Some(st) = &c.steps { m["steps"] = json!(st.iter().map(|x| json!({ "find": x.find, "replace": x.replace })).collect::<Vec<_>>()); }
            if let Some(h) = &c.help { m["help"] = json!(h); }
            if let Some(u) = &c.url { m["url"] = json!(u); }
            m
        })
        .collect();
    json!({
        "cmds": cmds,
        "states": states,
        "handlers": reg.formats().iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
        "extensions": reg.extensions(), "engines": engines, "features": reg.features(), "detect": detect, "helps": helps, "refs": refs,
        "handlerOf": input["names"].as_array().unwrap().iter().map(|n| reg.handler_of(n.as_str().unwrap()).map(|h| h.id.clone())).collect::<Vec<_>>(),
        "handler": handler_ids,
        "langs": langs.iter().map(|(c, n)| json!([c, n])).collect::<Vec<_>>(),
        "tr": tr, "revisionBump": true,
    })
}

fn make(x: &Value, lang: &Value) -> PluginRecord {
    let enabled = x["enabled"].as_bool().unwrap();
    let source = |k: &str| PluginSource { kind: k.into(), ..Default::default() };
    match x["kind"].as_str().unwrap() {
        "rpgmaker" | "text" => {
            let (m, h) = if x["kind"] == "rpgmaker" { rpgmaker_plugin() } else { text_formats_plugin() };
            PluginRecord::new(m, true, enabled, h, IndexMap::new(), source("builtin"))
        }
        "lang" => {
            let s = |k: &str| lang[k].as_str().unwrap();
            let (m, files) = language_plugin(s("code"), s("name"), s("nativeName"), s("po"));
            PluginRecord::new(m, true, true, vec![], files, source("builtin"))
        }
        _ => {
            let m = x["manifest"].clone();
            let id = m["id"].as_str().unwrap().to_string();
            let handlers: Vec<FormatHandler> = m["contributes"]["formats"].as_array().into_iter().flatten().filter(|f| f.get("spec").is_some()).filter_map(|f| FormatHandler::declarative(&id, f)).collect();
            let files: IndexMap<String, String> = x["files"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
            let mut r = PluginRecord::new(m, x["builtin"].as_bool().unwrap(), enabled, handlers, files, source("file"));
            r.load_error = x.get("loadError").and_then(Value::as_str).map(String::from);
            r
        }
    }
}

#[test]
fn match_detect_matches() {
    for (i, c) in cases("registry", "matchDetect").iter().enumerate() {
        let got = match_detect(&c.input["d"], &strings(&c.input["paths"])).map_or(Value::Null, |(score, matched)| json!({ "score": score, "matched": matched }));
        assert_same("matchDetect", i, &c.input, &got, &c.output);
    }
}

#[test]
fn scenarios_match() {
    for (i, c) in cases("registry", "scenario").iter().enumerate() {
        let inp = &c.input;
        let mut i18n = I18n::new();
        let mut reg = PluginRegistry::new(inp["app"].as_str(), inp["api"].as_str());
        let pool = inp["pool"].as_array().unwrap();
        let mut log: Vec<Value> = Vec::new();
        for s in inp["steps"].as_array().unwrap() {
            match s["op"].as_str().unwrap() {
                "add" => {
                    let refresh = s["refresh"].as_bool().unwrap();
                    reg.add(make(&pool[s["at"].as_u64().unwrap() as usize], &inp["lang"]), refresh, &mut i18n);
                    if refresh {
                        log.push(snapshot(&reg, &mut i18n, inp));
                    }
                }
                "enable" => {
                    reg.set_enabled(s["id"].as_str().unwrap(), s["on"].as_bool().unwrap(), &mut i18n);
                    log.push(snapshot(&reg, &mut i18n, inp));
                }
                "remove" => {
                    reg.remove(s["id"].as_str().unwrap(), &mut i18n);
                    log.push(snapshot(&reg, &mut i18n, inp));
                }
                _ => {
                    let id = s["id"].as_str().unwrap();
                    let warned = reg.fail(id, s["what"].as_str().unwrap(), 0);
                    let errors = reg.get(id).map(|r| r.errors.iter().map(|e| e.1.clone()).collect::<Vec<_>>());
                    log.push(json!({ "failed": { "warned": warned, "errors": errors } }));
                }
            }
        }
        assert_same("scenario", i, &json!({ "steps": inp["steps"] }), &json!(log), &c.output);
    }
}

#[test]
fn builtins_match() {
    for (i, c) in cases("registry", "builtins").iter().enumerate() {
        let l = &c.input["lang"];
        let s = |k: &str| l[k].as_str().unwrap().to_string();
        let (code, name, native, po) = (s("code"), s("name"), s("nativeName"), s("po"));
        let mut i18n = I18n::new();
        let mut reg = PluginRegistry::new(None, None);
        register_builtins(&mut reg, &[(&code, &name, &native, &po)], &mut i18n);
        let got = json!({
            "manifests": reg.list().map(|r| r.manifest.clone()).collect::<Vec<_>>(),
            "handlers": reg.formats().iter().map(|h| json!({ "id": h.id, "plugin": h.plugin, "label": h.label, "extensions": h.extensions, "text": h.text, "priority": h.priority, "help": h.help })).collect::<Vec<_>>(),
            "snapshot": snapshot(&reg, &mut i18n, &c.input),
        });
        assert_same("builtins", i, &c.input, &got, &c.output);
    }
}
