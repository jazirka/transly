//! Плагіни застосунку: вбудовані й установлені (лише з даних, без коду). Установлені лежать у теці даних застосунку:
//! `<тека>/<id>/transly-plugin.json` + файли пакета; вмикання зберігається в `<тека>/state.json`.

use indexmap::IndexMap;
use serde_json::Value;
use std::path::{Path, PathBuf};
use transly_core::builtin::register_builtins;
use transly_core::commands::{plugin_commands, PluginCommand};
use transly_core::i18n::I18n;
use transly_core::manifest::MANIFEST_FILE;
use transly_core::package::{build_package_from_text, Built, PluginPackage};
use transly_core::registry::{FormatHandler, PluginRecord, PluginRegistry, PluginSource};
use transly_core::sources::entries_from_files;

pub struct PluginHost {
    pub reg: PluginRegistry,
    pub i18n: I18n,
    dir: Option<PathBuf>,
}

/// Рядок списку для вікна менеджера.
pub struct PluginRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub builtin: bool,
    pub enabled: bool,
    pub state: &'static str,
    pub reason: Option<String>,
}

fn record_of(pkg: &PluginPackage, enabled: bool, source: PluginSource) -> PluginRecord {
    let id = pkg.manifest.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let handlers: Vec<FormatHandler> = pkg.manifest["contributes"]["formats"].as_array().into_iter().flatten().filter(|f| f.get("spec").is_some()).filter_map(|f| FormatHandler::declarative(&id, f)).collect();
    PluginRecord::new(pkg.manifest.clone(), false, enabled, handlers, pkg.files.clone(), source)
}

impl PluginHost {
    /// `dir` — тека установлених плагінів; None — лише вбудовані (тести).
    pub fn open(dir: Option<PathBuf>) -> PluginHost {
        let mut host = PluginHost { reg: PluginRegistry::new(None, None), i18n: I18n::new(), dir };
        register_builtins(&mut host.reg, &[], &mut host.i18n);
        host.load_installed();
        host
    }

    fn state_file(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join("state.json"))
    }

    fn read_state(&self) -> IndexMap<String, bool> {
        self.state_file().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn write_state(&self) {
        if let (Some(f), Some(d)) = (self.state_file(), &self.dir) {
            let m: IndexMap<String, bool> = self.reg.list().filter(|r| !r.builtin).map(|r| (r.id().to_string(), r.enabled)).collect();
            let _ = std::fs::create_dir_all(d);
            let _ = std::fs::write(f, serde_json::to_string(&m).unwrap_or_default());
        }
    }

    fn load_installed(&mut self) {
        let Some(dir) = self.dir.clone() else { return };
        let state = self.read_state();
        let Ok(rd) = std::fs::read_dir(&dir) else { return };
        for e in rd.flatten().filter(|e| e.path().is_dir()) {
            let Ok(pkg) = read_package_dir(&e.path()) else { continue };
            let id = pkg.manifest.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let enabled = state.get(&id).copied().unwrap_or(true);
            let rec = record_of(&pkg, enabled, PluginSource { kind: "file".into(), location: Some(e.path().to_string_lossy().to_string()), ..Default::default() });
            self.reg.add(rec, false, &mut self.i18n);
        }
        self.reg.refresh(&mut self.i18n);
    }

    pub fn rows(&self) -> Vec<PluginRow> {
        self.reg
            .list()
            .map(|r| PluginRow {
                id: r.id().to_string(),
                name: r.manifest.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                version: r.manifest.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
                builtin: r.builtin,
                enabled: r.enabled,
                state: r.state.as_str(),
                reason: r.reason.clone(),
            })
            .collect()
    }

    pub fn set_enabled(&mut self, id: &str, on: bool) {
        self.reg.set_enabled(id, on, &mut self.i18n);
        self.write_state();
    }

    /// Встановлює пакет із теки (з `transly-plugin.json`) чи з `.zip`/`.transly-plugin`. Повертає id.
    pub fn install(&mut self, path: &Path) -> Result<String, String> {
        let pkg = if path.is_dir() { read_package_dir(path)? } else { read_package_zip(path)? };
        let id = pkg.manifest.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        if self.reg.get(&id).is_some_and(|r| r.builtin) {
            return Err("Це id вбудованого плагіна".into());
        }
        let dir = self.dir.clone().ok_or("Немає теки для плагінів")?;
        let target = dir.join(&id);
        let _ = std::fs::remove_dir_all(&target);
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        std::fs::write(target.join(MANIFEST_FILE), &pkg.manifest_text).map_err(|e| e.to_string())?;
        for (p, text) in &pkg.files {
            let f = target.join(p);
            if let Some(parent) = f.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(f, text).map_err(|e| e.to_string())?;
        }
        let rec = record_of(&pkg, true, PluginSource { kind: "file".into(), location: Some(path.to_string_lossy().to_string()), ..Default::default() });
        self.reg.add(rec, true, &mut self.i18n);
        self.write_state();
        Ok(id)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if self.reg.get(id).is_some_and(|r| r.builtin) {
            return Err("Вбудований плагін не видаляється: його можна вимкнути".into());
        }
        self.reg.remove(id, &mut self.i18n);
        if let Some(d) = &self.dir {
            let _ = std::fs::remove_dir_all(d.join(id));
        }
        self.write_state();
        Ok(())
    }

    pub fn commands(&mut self) -> Vec<PluginCommand> {
        plugin_commands(&self.reg, &mut self.i18n)
    }
}

fn check(built: Built) -> Result<PluginPackage, String> {
    match built {
        Built::Ok(p) => Ok(*p),
        Built::Err(errors) => Err(errors.join("; ")),
    }
}

/// Пакет із теки: опис і файли, які він називає.
pub fn read_package_dir(dir: &Path) -> Result<PluginPackage, String> {
    let manifest_text = std::fs::read_to_string(dir.join(MANIFEST_FILE)).map_err(|_| format!("У теці немає файлу «{MANIFEST_FILE}»"))?;
    let manifest: Value = serde_json::from_str(manifest_text.strip_prefix('\u{feff}').unwrap_or(&manifest_text)).map_err(|e| format!("Опис не є JSON: {e}"))?;
    let mut files: IndexMap<String, String> = IndexMap::new();
    for name in manifest.get("files").and_then(Value::as_object).map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
        let p = transly_core::manifest::safe_path(&Value::String(name.clone()));
        if !p {
            return Err(format!("Небезпечний шлях у описі: {name}"));
        }
        files.insert(name.clone(), std::fs::read_to_string(dir.join(&name)).map_err(|e| format!("Файл «{name}»: {e}"))?);
    }
    check(build_package_from_text(&manifest_text, &files, false))
}

/// Пакет із `.zip`/`.transly-plugin`.
pub fn read_package_zip(path: &Path) -> Result<PluginPackage, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let name = path.file_name().map_or(String::new(), |n| n.to_string_lossy().to_string());
    let (entries, _) = entries_from_files(&[(name, data)])?;
    check(transly_core::package::build_package(&entries, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(text: &str) -> String {
        format!("sha256-{}", transly_core::package::sha256_hex(text.as_bytes()))
    }

    fn make_plugin(dir: &Path) {
        let terms = "sword\tменч\n";
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("terms.tsv"), terms).unwrap();
        let manifest = format!(r#"{{"manifestVersion":1,"id":"acme.words","name":"Words","version":"1.0.0","files":{{"terms.tsv":"{}"}},"contributes":{{"glossaries":[{{"id":"g","title":"G","file":"terms.tsv"}}],"commands":[{{"id":"c","title":"Замінити","action":"replace","steps":[{{"find":"a","replace":"b"}}]}}]}}}}"#, sha(terms));
        std::fs::write(dir.join(MANIFEST_FILE), manifest).unwrap();
    }

    #[test]
    fn install_toggle_remove_and_reload() {
        let base = std::env::temp_dir().join(format!("transly-app-plugins-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        make_plugin(&src);
        let store = base.join("store");
        let mut h = PluginHost::open(Some(store.clone()));
        let builtins = h.rows().len();
        assert!(builtins >= 2);
        assert_eq!(h.install(&src).unwrap(), "acme.words");
        assert_eq!(h.rows().len(), builtins + 1);
        assert!(h.commands().iter().any(|c| c.r#ref == "acme.words/c"));
        h.set_enabled("acme.words", false);
        assert!(h.commands().iter().all(|c| c.r#ref != "acme.words/c"));
        // новий запуск бачить установлений і вимкнений плагін
        let h2 = PluginHost::open(Some(store.clone()));
        let row = h2.rows().into_iter().find(|r| r.id == "acme.words").unwrap();
        assert!(!row.enabled && row.state == "disabled");
        let mut h3 = PluginHost::open(Some(store));
        assert!(h3.install(&base.join("nope")).is_err());
        assert!(h3.remove("transly.rpgmaker").is_err());
        h3.remove("acme.words").unwrap();
        assert!(h3.rows().iter().all(|r| r.id != "acme.words"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_package_with_a_wrong_checksum_is_refused() {
        let base = std::env::temp_dir().join(format!("transly-app-plugins-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        make_plugin(&base);
        std::fs::write(base.join("terms.tsv"), "other\tтекст\n").unwrap();
        assert!(read_package_dir(&base).unwrap_err().contains("контрольною сумою"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
