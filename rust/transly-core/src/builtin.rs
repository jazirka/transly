//! `ext/builtin.ts`: плагіни, що йдуть із застосунком і працюють від першого запуску: те, що програма вміла завжди,
//! тепер через ті самі двері, що й будь-який плагін. Їхній код — той, що був (нічого не переписано): обробник лише каже, які файли бере.

use crate::i18n::I18n;
use crate::manifest::{check_manifest, Checked, APP_VERSION};
use crate::registry::{FormatHandler, HandlerImpl, PluginRecord, PluginRegistry, PluginSource};
use indexmap::IndexMap;
use serde_json::{json, Value};

pub const RPGMAKER_ID: &str = "transly.rpgmaker";
pub const TEXT_FORMATS_ID: &str = "transly.text-formats";

/// Можливості, які пропонує інтерфейс для гри на RPG Maker (назви використовують місця, що їх перевіряють).
pub const RPGMAKER_FEATURES: [&str; 7] = ["scenes", "play-scene", "speakers", "plugin-texts", "game-window", "game-images", "game-names"];

fn manifest(m: Value) -> Value {
    let mut full = json!({ "manifestVersion": 1, "version": APP_VERSION, "author": "Transly", "license": "MIT", "sourceLanguage": "uk" });
    for (k, v) in m.as_object().unwrap() {
        full[k] = v.clone();
    }
    match check_manifest(&full, true) {
        Checked::Ok { manifest, .. } => manifest,
        Checked::Err { errors } => panic!("вбудований плагін {}: {}", m["id"], errors.join("; ")),
    }
}

pub fn rpgmaker_plugin() -> (Value, Vec<FormatHandler>) {
    let m = manifest(json!({
        "id": RPGMAKER_ID, "name": "RPG Maker MV / MZ",
        "description": "Ігри на RPG Maker MV і MZ: діалоги, вибори, бази даних, події мап, сцени, запуск гри на потрібній сцені, мовці, тексти з плагінів гри.",
        "contributes": {
            "formats": [{ "id": "rpgmaker", "label": "RPG Maker MV/MZ (data/*.json)", "extensions": [".json"], "text": false, "handler": "rpgmaker", "priority": 100, "help": "rpgmaker-open" }],
            "engines": [{
                "id": "rpgmaker", "label": "RPG Maker MV / MZ", "formats": ["rpgmaker"], "dataFolders": ["data", "www/data"], "features": RPGMAKER_FEATURES, "help": "rpgmaker-open",
                "description": "Файли гри лежать у папці data (для MV часто www/data): Map001.json, System.json, Actors.json…",
                "detect": { "anyFiles": ["**/system.json", "**/mapinfos.json", "**/actors.json", "**/commonevents.json", "**/map001.json"], "min": 2 }
            }],
            "help": [{ "id": "rpgmaker-open", "topic": "engine:rpgmaker", "title": "Як відкрити гру на RPG Maker", "body": "Оберіть папку гри (там, де лежить Game.exe), а не окремий файл.\n\n- Для MV файли лежать у `www/data`, для MZ — у `data`.\n- Файли JSON з розширених ігор зі змінами в плагінах можуть містити додаткові тексти: їх додають у «Налаштування → Гра і мови → Тексти плагінів».\n- Оригінальні файли гри не змінюються: збірка кладе переклад окремо або (на ПК) із копією оригіналів." }]
        }
    }));
    let h = FormatHandler::new("rpgmaker", RPGMAKER_ID, "RPG Maker MV/MZ (data/*.json)", &[".json".into()], false, 100, Some(format!("{RPGMAKER_ID}:rpgmaker-open")), HandlerImpl::RpgMaker, &[]);
    (m, vec![h])
}

pub fn text_formats_plugin() -> (Value, Vec<FormatHandler>) {
    let m = manifest(json!({
        "id": TEXT_FORMATS_ID, "name": "Текстові формати: gettext, CSV, JSON локалізації, Ren’Py",
        "description": "Файли перекладу й тексти ігор у відкритих форматах: .po/.pot, таблиці .csv/.tsv, JSON з рядками інтерфейсу (en.json…) і скрипти Ren’Py (.rpy).",
        "contributes": {
            "formats": [
                { "id": "locale-json", "label": "JSON локалізації (en.json, strings.json…)", "extensions": [".json"], "text": false, "handler": "localeJson", "priority": 90 },
                { "id": "gettext", "label": "gettext (.po, .pot)", "extensions": [".po", ".pot"], "text": true, "handler": "gettext", "priority": 80 },
                { "id": "csv", "label": "Таблиця CSV/TSV (ключ, оригінал, переклад)", "extensions": [".csv", ".tsv"], "text": true, "handler": "csv", "priority": 80 },
                { "id": "renpy", "label": "Ren’Py (.rpy)", "extensions": [".rpy"], "text": true, "handler": "renpy", "priority": 80 }
            ],
            "engines": [{ "id": "renpy", "label": "Ren’Py", "formats": ["renpy"], "detect": { "anyFiles": ["**/*.rpy"] }, "description": "Візуальні новели на Ren’Py: скрипти лежать у папці game (.rpy)." }]
        }
    }));
    let h = |id: &str, label: &str, exts: &[&str], text: bool, priority: i64, imp: HandlerImpl| {
        let exts: Vec<String> = exts.iter().map(|e| e.to_string()).collect();
        FormatHandler::new(id, TEXT_FORMATS_ID, label, &exts, text, priority, None, imp, &[])
    };
    let handlers = vec![
        h("locale-json", "JSON локалізації (en.json, strings.json…)", &[".json"], false, 90, HandlerImpl::LocaleJson),
        h("gettext", "gettext (.po, .pot)", &[".po", ".pot"], true, 80, HandlerImpl::Gettext),
        h("csv", "Таблиця CSV/TSV (ключ, оригінал, переклад)", &[".csv", ".tsv"], true, 80, HandlerImpl::Csv),
        h("renpy", "Ren’Py (.rpy)", &[".rpy"], true, 80, HandlerImpl::Renpy),
    ];
    (m, handlers)
}

pub fn lang_plugin_id(code: &str) -> String {
    format!("transly.lang-{}", code.to_lowercase())
}

/// Мовний пакет, що йде із застосунком: той самий плагін, що ставить користувач, лише каталог усередині застосунку.
pub fn language_plugin(code: &str, name: &str, native_name: &str, po: &str) -> (Value, IndexMap<String, String>) {
    let file = format!("lang/{code}.po");
    let m = manifest(json!({
        "id": lang_plugin_id(code), "name": format!("{native_name}: мова інтерфейсу"),
        "description": format!("Переклад інтерфейсу застосунку ({name}). Рядки, яких тут немає, лишаються українською."),
        "contributes": { "languages": [{ "code": code, "name": name, "nativeName": native_name, "catalogs": [{ "file": file }] }] }
    }));
    (m, IndexMap::from([(file, po.to_string())]))
}

/// Кладе вбудовані плагіни в реєстр (увімкнені; користувач може вимкнути в менеджері). `languages` — (код, назва, рідна назва, каталог `.po`).
pub fn register_builtins(reg: &mut PluginRegistry, languages: &[(&str, &str, &str, &str)], i18n: &mut I18n) {
    let builtin = || PluginSource { kind: "builtin".into(), ..Default::default() };
    for (m, handlers) in [rpgmaker_plugin(), text_formats_plugin()] {
        reg.add(PluginRecord::new(m, true, true, handlers, IndexMap::new(), builtin()), false, i18n);
    }
    for (code, name, native, po) in languages {
        let (m, files) = language_plugin(code, name, native, po);
        reg.add(PluginRecord::new(m, true, true, vec![], files, builtin()), false, i18n);
    }
    reg.refresh(i18n);
}
