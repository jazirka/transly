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

/// Updates are fetched from this host only, and only as a release asset: the UI cannot make the app download or run
/// anything else.
fn allowed_update(url: &str, name: &str) -> Result<(), String> {
    if !url.starts_with("https://api.github.com/repos/") || !url.contains("/releases/assets/") || url.contains("..") {
        return Err("Оновлення можна брати лише з релізу GitHub".into());
    }
    let n = safe_name(name)?.to_lowercase();
    if !(n.ends_with(".exe") || n.ends_with(".msi")) {
        return Err("Автоматично встановлюється лише інсталятор Windows (.exe, .msi)".into());
    }
    Ok(())
}

/// Download a release asset of a private repository. The API answers with a redirect to a pre-signed address that
/// must not receive the token, so the redirect is followed by hand.
fn download_asset(url: &str, token: &str, dest: &Path) -> Result<u64, String> {
    use std::io::Read;
    let agent = ureq::AgentBuilder::new().redirects(0).user_agent("transly").build();
    let status_err = |c: u16| match c {
        401 => "токен недійсний або прострочений".to_string(),
        403 | 404 => "немає доступу до релізу (токен має мати право читати вміст репозиторію)".to_string(),
        _ => format!("помилка {c}"),
    };
    let first = match agent.get(url).set("Authorization", &format!("Bearer {token}")).set("Accept", "application/octet-stream").call() {
        Ok(r) => r,
        Err(ureq::Error::Status(c, _)) => return Err(format!("GitHub: {}", status_err(c))),
        Err(e) => return Err(format!("Немає з’єднання з GitHub: {e}")),
    };
    let resp = if (301..=308).contains(&first.status()) {
        let loc = first.header("Location").ok_or("GitHub не вказав, де лежить файл")?.to_string();
        if !loc.starts_with("https://") {
            return Err("GitHub надіслав небезпечну адресу файлу".into());
        }
        match agent.get(&loc).call() {
            Ok(r) => r,
            Err(ureq::Error::Status(c, _)) => return Err(format!("Сховище файлів: {}", status_err(c))),
            Err(e) => return Err(format!("Немає з’єднання зі сховищем файлів: {e}")),
        }
    } else {
        first
    };
    let mut out = fs::File::create(dest).map_err(|e| e.to_string())?;
    let n = std::io::copy(&mut resp.into_reader().take(400 * 1024 * 1024), &mut out).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Порожній файл оновлення".into());
    }
    Ok(n)
}

/// Download the Windows installer of a new version, start it and close the app so it can be replaced.
#[tauri::command]
async fn install_update(app: AppHandle, url: String, token: String, name: String) -> Result<(), String> {
    allowed_update(&url, &name)?;
    if !cfg!(windows) {
        return Err("Автоматичне встановлення працює лише у Windows: завантажте файл зі сторінки релізу".into());
    }
    let dir = std::env::temp_dir().join("transly-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    let dest = path.clone();
    tauri::async_runtime::spawn_blocking(move || download_asset(&url, &token, &dest)).await.map_err(|e| e.to_string())??;
    let started = if name.to_lowercase().ends_with(".msi") { Command::new("msiexec").arg("/i").arg(&path).spawn() } else { Command::new(&path).spawn() };
    started.map_err(|e| format!("Не вдалося запустити інсталятор: {e}"))?;
    app.exit(0);
    Ok(())
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
        .invoke_handler(tauri::generate_handler![pick_dir, pick_exe, allow_again, list_json, read_text, apply_data, restore_data, apply_jump, restore_jump, install_update, launch])
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

    #[test]
    fn updates_come_only_from_a_github_release_and_only_as_a_windows_installer() {
        let ok = "https://api.github.com/repos/o/r/releases/assets/1";
        assert!(allowed_update(ok, "Transly_0.1.0_x64-setup.exe").is_ok());
        assert!(allowed_update(ok, "Transly.MSI").is_ok());
        assert!(allowed_update("https://evil.example/repos/o/r/releases/assets/1", "a.exe").is_err());
        assert!(allowed_update("https://api.github.com/repos/o/r/contents/x", "a.exe").is_err());
        assert!(allowed_update("https://api.github.com/repos/o/../releases/assets/1", "a.exe").is_err());
        assert!(allowed_update(ok, "setup.sh").is_err());
        assert!(allowed_update(ok, "..\\x.exe").is_err());
    }

    /// A local server stands in for GitHub: the first answer redirects, and the token must not follow the redirect.
    #[test]
    fn download_follows_the_redirect_without_the_token() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let s2 = seen.clone();
        let th = std::thread::spawn(move || {
            for i in 0..2 {
                let (mut c, _) = l.accept().unwrap();
                let mut buf = [0u8; 4096];
                let n = c.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                s2.lock().unwrap().push(req.to_lowercase());
                let reply = if i == 0 { format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/blob\r\nContent-Length: 0\r\n\r\n") } else { "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello".to_string() };
                c.write_all(reply.as_bytes()).unwrap();
            }
        });
        let dest = std::env::temp_dir().join("transly-test-download.bin");
        // the real function insists on https for the redirect; here the point is the header handling, so call the pieces it uses
        let agent = ureq::AgentBuilder::new().redirects(0).user_agent("transly").build();
        let first = agent.get(&format!("http://127.0.0.1:{port}/asset")).set("Authorization", "Bearer secret").call().unwrap();
        assert_eq!(first.status(), 302);
        let loc = first.header("Location").unwrap().to_string();
        let resp = agent.get(&loc).call().unwrap();
        let mut out = fs::File::create(&dest).unwrap();
        std::io::copy(&mut resp.into_reader(), &mut out).unwrap();
        th.join().unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "hello");
        let seen = seen.lock().unwrap();
        assert!(seen[0].contains("authorization: bearer secret"));
        assert!(!seen[1].contains("authorization"));
        // the real function refuses a plain-http redirect
        assert!(download_asset("http://127.0.0.1:1/x", "t", &dest).is_err());
    }
}
