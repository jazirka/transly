//! Desktop shell: everything the browser cannot do, behind a small set of checked commands.
//! The UI never gets general file access. It can only touch folders and the game executable the user picked
//! in a native dialog during this or an earlier session.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Roots(Mutex<Vec<PathBuf>>);

impl Roots {
    fn allow(&self, p: &Path) {
        if let Ok(c) = p.canonicalize() {
            let mut v = self.0.lock().unwrap();
            if !v.contains(&c) {
                v.push(c);
            }
        }
    }

    /// Resolve `p` and make sure it lies inside a folder the user has picked. Works for files that do not exist yet.
    fn check(&self, p: &str) -> Result<PathBuf, String> {
        let path = Path::new(p);
        let resolved = match path.canonicalize() {
            Ok(c) => c,
            Err(_) => {
                let parent = path.parent().ok_or("Некоректний шлях")?.canonicalize().map_err(|e| e.to_string())?;
                parent.join(path.file_name().ok_or("Некоректний шлях")?)
            }
        };
        let roots = self.0.lock().unwrap();
        if roots.iter().any(|r| resolved.starts_with(r)) {
            Ok(resolved)
        } else {
            Err("Цей шлях не дозволено: оберіть папку через діалог".into())
        }
    }
}

#[derive(Serialize)]
struct JsonFile {
    name: String,
    path: String,
}

#[derive(Deserialize)]
struct OutFile {
    name: String,
    content: String,
}

fn walk(dir: &Path, depth: u8, out: &mut Vec<JsonFile>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if depth < 3 && !name.starts_with('.') && name != "node_modules" {
                walk(&p, depth + 1, out);
            }
        } else if name.ends_with(".json") {
            out.push(JsonFile { name, path: p.to_string_lossy().to_string() });
        }
    }
}

/// A file name that cannot escape the folder it is written to.
fn safe_name(n: &str) -> Result<&str, String> {
    if n.is_empty() || n.contains('/') || n.contains('\\') || n == "." || n == ".." {
        Err(format!("Недопустима назва файлу: {n}"))
    } else {
        Ok(n)
    }
}

fn backup_dir(data: &Path) -> PathBuf {
    let mut name = data.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".transly-orig");
    data.with_file_name(name)
}

#[tauri::command]
async fn pick_dir(app: AppHandle, roots: State<'_, Roots>) -> Result<Option<String>, String> {
    let Some(p) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
    let path = p.into_path().map_err(|e| e.to_string())?;
    roots.allow(&path);
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_exe(app: AppHandle, roots: State<'_, Roots>) -> Result<Option<String>, String> {
    let Some(p) = app.dialog().file().blocking_pick_file() else { return Ok(None) };
    let path = p.into_path().map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        roots.allow(parent);
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Re-enable a folder or file chosen in an earlier session (the app remembers the path, the user chose it).
#[tauri::command]
fn allow_again(roots: State<'_, Roots>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Шлях більше не існує".into());
    }
    roots.allow(if p.is_dir() { &p } else { p.parent().unwrap_or(&p) });
    Ok(())
}

#[tauri::command]
fn list_json(roots: State<'_, Roots>, dir: String) -> Result<Vec<JsonFile>, String> {
    let d = roots.check(&dir)?;
    let mut out = Vec::new();
    walk(&d, 0, &mut out);
    Ok(out)
}

#[tauri::command]
fn read_text(roots: State<'_, Roots>, path: String) -> Result<String, String> {
    let p = roots.check(&path)?;
    fs::read_to_string(p).map_err(|e| e.to_string())
}

/// Write translated files into `dir`, keeping a one-time copy of every original next to it.
fn apply_files(dir: &Path, files: &[OutFile]) -> Result<usize, String> {
    let backup = backup_dir(dir);
    fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    let mut n = 0;
    for f in files {
        let name = safe_name(&f.name)?;
        let target = dir.join(name);
        let saved = backup.join(name);
        if target.exists() && !saved.exists() {
            fs::copy(&target, &saved).map_err(|e| e.to_string())?;
        }
        fs::write(&target, &f.content).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

fn restore_files(dir: &Path) -> Result<usize, String> {
    let backup = backup_dir(dir);
    if !backup.is_dir() {
        return Err("Резервної копії оригіналів немає".into());
    }
    let mut n = 0;
    for e in fs::read_dir(&backup).map_err(|e| e.to_string())?.flatten() {
        fs::copy(e.path(), dir.join(e.file_name())).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
fn apply_data(roots: State<'_, Roots>, data_dir: String, files: Vec<OutFile>) -> Result<usize, String> {
    apply_files(&roots.check(&data_dir)?, &files)
}

#[tauri::command]
fn restore_data(roots: State<'_, Roots>, data_dir: String) -> Result<usize, String> {
    restore_files(&roots.check(&data_dir)?)
}

/// The test plugin the app adds to a game so it can start inside one scene.
const JUMP_PLUGIN: &str = "TranslyJump";

/// Add the plugin to the end of `$plugins` (the last one loads last, so it can wrap the engine's scenes).
/// Returns None when it is already listed.
fn patch_plugins_js(src: &str) -> Result<Option<String>, String> {
    if src.contains(JUMP_PLUGIN) {
        return Ok(None);
    }
    let end = src.rfind("];").ok_or("У plugins.js не знайдено кінця списку плагінів")?;
    let head = src[..end].trim_end();
    let comma = if head.ends_with('[') || head.ends_with(',') { "" } else { "," };
    let entry = format!("{{\"name\":\"{JUMP_PLUGIN}\",\"status\":true,\"description\":\"Transly: перевірка перекладу\",\"parameters\":{{}}}}");
    Ok(Some(format!("{head}{comma}\n{entry}\n{}", &src[end..])))
}

/// Take the plugin out of a plugins.js again when no backup is left to restore from.
fn unpatch_plugins_js(src: &str) -> String {
    let kept: Vec<&str> = src.lines().filter(|l| !l.contains(JUMP_PLUGIN)).collect();
    let mut out = kept.join("\n");
    // The entry was last, so the line before it may now end in a comma just before `];`.
    if let Some(end) = out.rfind("];") {
        let head = out[..end].trim_end().trim_end_matches(',').to_string();
        out = format!("{head}\n{}", &out[end..]);
    }
    if src.ends_with('\n') { out.push('\n'); }
    out
}

/// The game's `js` folder sits next to `data`. Only a real RPG Maker layout is accepted: `data/System.json` and `js/plugins.js`.
fn jump_paths(data: &Path) -> Result<(PathBuf, PathBuf), String> {
    let js = data.parent().ok_or("Некоректний шлях")?.join("js");
    let list = js.join("plugins.js");
    if !data.join("System.json").is_file() || !list.is_file() {
        return Err("Це не папка даних RPG Maker MV/MZ: поруч немає js/plugins.js".into());
    }
    Ok((list, js.join("plugins").join(format!("{JUMP_PLUGIN}.js"))))
}

fn apply_jump_files(data: &Path, source: &str) -> Result<(), String> {
    let (list, plugin) = jump_paths(data)?;
    let backup = list.with_file_name("plugins.js.transly-orig");
    let src = fs::read_to_string(&list).map_err(|e| e.to_string())?;
    if let Some(patched) = patch_plugins_js(&src)? {
        if !backup.exists() {
            fs::copy(&list, &backup).map_err(|e| e.to_string())?;
        }
        fs::write(&list, patched).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(plugin.parent().ok_or("Некоректний шлях")?).map_err(|e| e.to_string())?;
    fs::write(&plugin, source).map_err(|e| e.to_string())
}

/// Undo `apply_jump_files`. True when something was changed.
fn restore_jump_files(data: &Path) -> Result<bool, String> {
    let (list, plugin) = jump_paths(data)?;
    let backup = list.with_file_name("plugins.js.transly-orig");
    let mut changed = false;
    if backup.is_file() {
        fs::copy(&backup, &list).map_err(|e| e.to_string())?;
        fs::remove_file(&backup).map_err(|e| e.to_string())?;
        changed = true;
    } else {
        let src = fs::read_to_string(&list).map_err(|e| e.to_string())?;
        if src.contains(JUMP_PLUGIN) {
            fs::write(&list, unpatch_plugins_js(&src)).map_err(|e| e.to_string())?;
            changed = true;
        }
    }
    if plugin.is_file() {
        fs::remove_file(&plugin).map_err(|e| e.to_string())?;
        changed = true;
    }
    Ok(changed)
}

#[tauri::command]
fn apply_jump(roots: State<'_, Roots>, data_dir: String, source: String) -> Result<(), String> {
    apply_jump_files(&roots.check(&data_dir)?, &source)
}

#[tauri::command]
fn restore_jump(roots: State<'_, Roots>, data_dir: String) -> Result<bool, String> {
    restore_jump_files(&roots.check(&data_dir)?)
}

#[tauri::command]
fn launch(roots: State<'_, Roots>, exe: String) -> Result<(), String> {
    let p = roots.check(&exe)?;
    if !p.is_file() {
        return Err("Файл гри не знайдено".into());
    }
    let mut cmd = Command::new(&p);
    if let Some(dir) = p.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Не вдалося запустити гру: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Roots::default())
        .invoke_handler(tauri::generate_handler![pick_dir, pick_exe, allow_again, list_json, read_text, apply_data, restore_data, apply_jump, restore_jump, launch])
        .run(tauri::generate_context!())
        .expect("error while running Transly");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_escape_the_folder() {
        assert!(safe_name("Map001.json").is_ok());
        assert!(safe_name("../x.json").is_err());
        assert!(safe_name("a/b.json").is_err());
        assert!(safe_name("a\\b.json").is_err());
        assert!(safe_name("..").is_err());
        assert!(safe_name("").is_err());
    }

    #[test]
    fn paths_outside_picked_roots_are_refused() {
        let tmp = std::env::temp_dir().join("transly-test-roots");
        let inside = tmp.join("game");
        fs::create_dir_all(&inside).unwrap();
        let roots = Roots::default();
        roots.allow(&inside);
        assert!(roots.check(inside.join("data.json").to_str().unwrap()).is_ok());
        assert!(roots.check(tmp.join("other.json").to_str().unwrap()).is_err());
        assert!(roots.check(inside.join("..").join("other.json").to_str().unwrap()).is_err());
    }

    #[test]
    fn apply_backs_up_once_and_restore_brings_originals_back() {
        let base = std::env::temp_dir().join("transly-test-apply");
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("Map001.json"), "original").unwrap();
        let out = |c: &str| vec![OutFile { name: "Map001.json".into(), content: c.into() }];
        assert_eq!(apply_files(&data, &out("first")).unwrap(), 1);
        assert_eq!(apply_files(&data, &out("second")).unwrap(), 1);
        assert_eq!(fs::read_to_string(data.join("Map001.json")).unwrap(), "second");
        assert_eq!(restore_files(&data).unwrap(), 1);
        assert_eq!(fs::read_to_string(data.join("Map001.json")).unwrap(), "original");
        assert!(apply_files(&data, &[OutFile { name: "../evil.json".into(), content: "x".into() }]).is_err());
        assert!(!base.join("evil.json").exists());
    }

    const MV_PLUGINS: &str = "// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n{\"name\":\"Community_Basic\",\"status\":true,\"description\":\"x\",\"parameters\":{}},\n{\"name\":\"YEP_Core\",\"status\":true,\"description\":\"y\",\"parameters\":{}}\n];\n";

    #[test]
    fn plugin_entry_goes_last_and_only_once() {
        let patched = patch_plugins_js(MV_PLUGINS).unwrap().unwrap();
        assert!(patched.contains("\"parameters\":{}},\n{\"name\":\"TranslyJump\""));
        assert!(patched.trim_end().ends_with("}\n];"));
        assert!(patch_plugins_js(&patched).unwrap().is_none());
        // an empty list and a list whose last entry already ends in a comma
        assert!(patch_plugins_js("var $plugins =\n[\n];\n").unwrap().unwrap().contains("[\n{\"name\":\"TranslyJump\""));
        assert!(patch_plugins_js("var $plugins = [\n{\"name\":\"A\"},\n];").unwrap().unwrap().contains("{\"name\":\"A\"},\n{\"name\":\"TranslyJump\""));
        assert!(patch_plugins_js("no list here").is_err());
    }

    #[test]
    fn unpatch_removes_the_entry_and_the_comma_before_it() {
        let patched = patch_plugins_js(MV_PLUGINS).unwrap().unwrap();
        let back = unpatch_plugins_js(&patched);
        assert!(!back.contains("TranslyJump"));
        assert!(back.contains("YEP_Core\",\"status\":true,\"description\":\"y\",\"parameters\":{}}\n];"));
    }

    #[test]
    fn jump_plugin_is_installed_and_removed_cleanly() {
        let base = std::env::temp_dir().join("transly-test-jump");
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(base.join("js").join("plugins")).unwrap();
        // not an RPG Maker folder yet
        assert!(apply_jump_files(&data, "x").is_err());
        fs::write(data.join("System.json"), "{}").unwrap();
        fs::write(base.join("js").join("plugins.js"), MV_PLUGINS).unwrap();

        apply_jump_files(&data, "// plugin one").unwrap();
        apply_jump_files(&data, "// plugin two").unwrap();
        let list = fs::read_to_string(base.join("js").join("plugins.js")).unwrap();
        assert_eq!(list.matches("TranslyJump").count(), 1);
        assert_eq!(fs::read_to_string(base.join("js").join("plugins").join("TranslyJump.js")).unwrap(), "// plugin two");
        assert_eq!(fs::read_to_string(base.join("js").join("plugins.js.transly-orig")).unwrap(), MV_PLUGINS);

        assert!(restore_jump_files(&data).unwrap());
        assert_eq!(fs::read_to_string(base.join("js").join("plugins.js")).unwrap(), MV_PLUGINS);
        assert!(!base.join("js").join("plugins").join("TranslyJump.js").exists());
        assert!(!base.join("js").join("plugins.js.transly-orig").exists());
        assert!(!restore_jump_files(&data).unwrap());

        // the backup was lost: the entry is still taken out by hand
        apply_jump_files(&data, "// plugin").unwrap();
        fs::remove_file(base.join("js").join("plugins.js.transly-orig")).unwrap();
        assert!(restore_jump_files(&data).unwrap());
        assert!(!fs::read_to_string(base.join("js").join("plugins.js")).unwrap().contains("TranslyJump"));
    }
}
