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
        .invoke_handler(tauri::generate_handler![pick_dir, pick_exe, allow_again, list_json, read_text, apply_data, restore_data, launch])
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
}
