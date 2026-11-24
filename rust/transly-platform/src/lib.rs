//! Платформа Transly (перенесено з `app/src-tauri/src/lib.rs` без Tauri): усе, чого не може інтерфейс, за невеликим набором
//! перевірених операцій. Інтерфейс не отримує загального доступу до файлів: він може торкатися лише папок і програми гри,
//! які користувач обрав у системному діалозі в цьому чи попередньому сеансі. Сам діалог показує інтерфейс (`rfd` чи подібне)
//! і повідомляє результат через `Roots::allow` + `Picked::add`.

pub mod github;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct Roots(Mutex<Vec<PathBuf>>);

/// The folders the user has picked in a native dialog, in this or an earlier session. The list is kept by the app in its
/// own data folder and is written only by `pick_dir` / `pick_exe`: a page (or a stored string) cannot add to it, so
/// `allow_again` can bring back a folder that was really chosen, and nothing else.
pub struct Picked {
    pub(crate) file: Option<PathBuf>,
    pub(crate) list: Mutex<Vec<PathBuf>>,
}

impl Picked {
    pub fn open(file: PathBuf) -> Self {
        let list = fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect();
        Picked { file: Some(file), list: Mutex::new(list) }
    }

    pub fn add(&self, p: &Path) {
        let Ok(c) = p.canonicalize() else { return };
        let mut v = self.list.lock().unwrap();
        if !v.contains(&c) {
            v.push(c);
            if let Some(f) = &self.file {
                let names: Vec<String> = v.iter().map(|x| x.to_string_lossy().to_string()).collect();
                if let Some(dir) = f.parent() {
                    let _ = fs::create_dir_all(dir);
                }
                let _ = fs::write(f, serde_json::to_string(&names).unwrap_or_default());
            }
        }
    }

    pub fn has(&self, p: &Path) -> bool {
        p.canonicalize().is_ok_and(|c| self.list.lock().unwrap().contains(&c))
    }
}

impl Roots {
    pub fn allow(&self, p: &Path) {
        if let Ok(c) = p.canonicalize() {
            let mut v = self.0.lock().unwrap();
            if !v.contains(&c) {
                v.push(c);
            }
        }
    }

    /// Resolve `p` and make sure it lies inside a folder the user has picked. Works for files that do not exist yet.
    pub fn check(&self, p: &str) -> Result<PathBuf, String> {
        self.resolve(p, false)
    }

    /// Like `check`, and also allows the game's spare `data1` folder: for reading only, never for writing.
    pub fn check_read(&self, p: &str) -> Result<PathBuf, String> {
        self.resolve(p, true)
    }

    fn resolve(&self, p: &str, read_only: bool) -> Result<PathBuf, String> {
        let path = Path::new(p);
        let resolved = match path.canonicalize() {
            Ok(c) => c,
            Err(_) => {
                let parent = path.parent().ok_or("Некоректний шлях")?.canonicalize().map_err(|e| e.to_string())?;
                parent.join(path.file_name().ok_or("Некоректний шлях")?)
            }
        };
        let roots = self.0.lock().unwrap();
        // The backup of a picked folder's originals (or the game's own spare `data1`) sits next to it: reading it is allowed too.
        if roots.iter().any(|r| resolved.starts_with(r) || resolved.starts_with(backup_dir(r)) || (read_only && alt_dir(r).is_some_and(|a| resolved.starts_with(a)))) {
            Ok(resolved)
        } else {
            Err("Цей шлях не дозволено: оберіть папку через діалог".into())
        }
    }
}

#[derive(Serialize)]
pub struct JsonFile {
    pub name: String,
    pub path: String,
    /// The untouched original of this file, when the app has backed it up (the file itself may hold a translation).
    pub orig: Option<String>,
}

#[derive(Deserialize)]
pub struct OutFile {
    pub name: String,
    pub content: String,
}

/// Whether a file name ends with one of the extensions (lower case, with the dot) the app can read now.
fn ext_ok(name: &str, exts: &[String]) -> bool {
    let lower = name.to_lowercase();
    exts.iter().any(|e| lower.ends_with(e.as_str()))
}

/// The extensions the page asks for, checked: a dot and letters or digits, at most 32 of them; `.json` is always read.
pub fn clean_exts(asked: Option<Vec<String>>) -> Vec<String> {
    let mut out = vec![".json".to_string()];
    for e in asked.unwrap_or_default().into_iter().take(32) {
        let e = e.to_lowercase();
        let ok = e.len() >= 2 && e.len() <= 17 && e.starts_with('.') && e[1..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if ok && !out.contains(&e) {
            out.push(e);
        }
    }
    out
}

pub fn walk(dir: &Path, depth: u8, out: &mut Vec<JsonFile>, exts: &[String]) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let written = read_written(dir);
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if depth < 3 && !name.starts_with('.') && name != "node_modules" && !name.ends_with(".transly-orig") {
                walk(&p, depth + 1, out, exts);
            }
        } else if ext_ok(&name, exts) {
            let orig = original_of(dir, &name, &written);
            out.push(JsonFile { name, path: p.to_string_lossy().to_string(), orig });
        }
    }
}

/// A file name that cannot escape the folder it is written to.
pub fn safe_name(n: &str) -> Result<&str, String> {
    let odd = |c: char| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*');
    if n.is_empty() || n.contains('/') || n.contains('\\') || n == "." || n == ".." || n.chars().any(odd) || n.ends_with('.') || n.ends_with(' ') {
        Err(format!("Недопустима назва файлу: {n}"))
    } else {
        Ok(n)
    }
}

/// Some games ship an untouched spare copy of `data` named `data1` next to it.
pub fn alt_dir(data: &Path) -> Option<PathBuf> {
    if data.file_name()? != "data" {
        return None;
    }
    Some(data.with_file_name("data1")).filter(|a| a.is_dir())
}

/// A small fingerprint (FNV-1a) of what the app last wrote into a file: it tells the app's own output from a file that
/// somebody else has changed since (a game update puts a new original where the translation was).
fn fingerprint(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// `<data>.transly-written`: one line per file the app wrote, `name<TAB>fingerprint`. Kept next to the backup folder, never inside it.
fn written_file(data: &Path) -> PathBuf {
    let mut name = data.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".transly-written");
    data.with_file_name(name)
}

pub fn read_written(data: &Path) -> std::collections::HashMap<String, u64> {
    let Ok(text) = fs::read_to_string(written_file(data)) else { return Default::default() };
    text.lines().filter_map(|l| l.split_once('\t')).filter_map(|(n, h)| Some((n.to_string(), h.parse().ok()?))).collect()
}

fn save_written(data: &Path, m: &std::collections::HashMap<String, u64>) {
    let mut lines: Vec<String> = m.iter().map(|(n, h)| format!("{n}\t{h}")).collect();
    lines.sort();
    let _ = fs::write(written_file(data), lines.join("\n"));
}

/// True when the file in the game folder is not what the app wrote last: somebody (a game update) changed it, so it is a new original.
fn changed_outside(written: &std::collections::HashMap<String, u64>, name: &str, live: &[u8]) -> bool {
    written.get(name).is_some_and(|h| *h != fingerprint(live))
}

/// The folder where the previous original of a file goes when a game update replaces it.
pub fn previous_dir(data: &Path) -> PathBuf {
    let mut name = data.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".transly-prev");
    data.with_file_name(name)
}

/// Where the untouched original of `name` can be read: the app's backup first, else the game's spare `data1`. A file that was
/// changed since the app wrote it (a game update) is itself the newest original: then nothing is returned and the file is read.
pub fn original_of(dir: &Path, name: &str, written: &std::collections::HashMap<String, u64>) -> Option<String> {
    dir.parent()?;
    if fs::read(dir.join(name)).is_ok_and(|live| changed_outside(written, name, &live)) {
        return None;
    }
    let backup = backup_dir(dir).join(name);
    let spare = alt_dir(dir).map(|a| a.join(name));
    [Some(backup), spare].into_iter().flatten().find(|b| b.is_file()).map(|b| b.to_string_lossy().to_string())
}

pub fn backup_dir(data: &Path) -> PathBuf {
    let mut name = data.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".transly-orig");
    data.with_file_name(name)
}
/// Re-enable a folder (or the folder of a program) that the user picked in a dialog in an earlier session. A path the user
/// never picked is refused, however it got here: the app does not take a remembered string for a permission.
pub fn allow_picked(roots: &Roots, picked: &Picked, path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err("Шлях більше не існує".into());
    }
    let dir = if p.is_dir() { p.as_path() } else { p.parent().unwrap_or(&p) };
    if !picked.has(dir) {
        return Err("Цю папку не обирали в діалозі: оберіть її знову".into());
    }
    roots.allow(dir);
    Ok(())
}

pub fn names_in(base: &Path, dir: &Path, depth: u8, out: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= 4000 {
            return;
        }
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if depth < 4 && !name.starts_with('.') && name != "node_modules" && !name.ends_with(".transly-orig") {
                names_in(base, &p, depth + 1, out);
            }
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

pub fn read_text_checked(roots: &Roots, path: &str) -> Result<String, String> {
    let p = roots.check_read(path)?;
    // a file saved with a byte-order mark would not parse as JSON; the browser's own reader drops it too
    fs::read_to_string(p).map(|t| t.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(t)).map_err(|e| e.to_string())
}

/// Picture from the game folder (`img/...`, also under `www/` for MV), as raw bytes. Only inside the picked folder.
pub fn find_image(roots: &Roots, game: &str, rel: &str) -> Result<PathBuf, String> {
    let r = Path::new(rel);
    if r.is_absolute() || r.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("Некоректний шлях".into());
    }
    for base in [Path::new(game).to_path_buf(), Path::new(game).join("www")] {
        let p = base.join(r);
        if p.is_file() {
            return roots.check_read(&p.to_string_lossy());
        }
    }
    Err("Зображення не знайдено".into())
}

/// Write translated files into `dir`, keeping a copy of every original next to it. Everything is written to temporary files
/// first and only then put in place, so a failure while writing leaves the game exactly as it was. The copy of the original
/// is taken the first time, and again when the game itself changed the file since the app wrote it (an update of the game:
/// then the old copy is kept in `<data>.transly-prev`).
pub fn apply_files(dir: &Path, files: &[OutFile]) -> Result<usize, String> {
    let backup = backup_dir(dir);
    fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    let mut written = read_written(dir);
    let mut staged: Vec<(String, PathBuf, PathBuf, u64)> = Vec::new();
    let undo = |staged: &[(String, PathBuf, PathBuf, u64)]| {
        for (_, tmp, _, _) in staged {
            let _ = fs::remove_file(tmp);
        }
    };
    for f in files {
        let name = match safe_name(&f.name) {
            Ok(n) => n,
            Err(e) => { undo(&staged); return Err(e); }
        };
        let target = dir.join(name);
        let saved = backup.join(name);
        if target.is_file() {
            let step = (|| -> Result<(), String> {
                let live = fs::read(&target).map_err(|e| e.to_string())?;
                if !saved.exists() {
                    fs::copy(&target, &saved).map_err(|e| e.to_string())?;
                } else if changed_outside(&written, name, &live) {
                    let prev = previous_dir(dir);
                    fs::create_dir_all(&prev).map_err(|e| e.to_string())?;
                    fs::copy(&saved, prev.join(name)).map_err(|e| e.to_string())?;
                    fs::write(&saved, &live).map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            if let Err(e) = step { undo(&staged); return Err(e); }
        }
        let tmp = dir.join(format!("{name}.transly-tmp"));
        if let Err(e) = fs::write(&tmp, &f.content) {
            let _ = fs::remove_file(&tmp);
            undo(&staged);
            return Err(e.to_string());
        }
        staged.push((name.to_string(), tmp, target, fingerprint(f.content.as_bytes())));
    }
    let total = staged.len();
    let mut done = 0;
    for (name, tmp, target, fp) in &staged {
        if let Err(e) = fs::rename(tmp, target) {
            undo(&staged[done..]);
            save_written(dir, &written);
            return Err(format!("Записано {done} із {total} файлів, далі збій: {e}"));
        }
        written.insert(name.clone(), *fp);
        done += 1;
    }
    save_written(dir, &written);
    Ok(done)
}

pub fn restore_files(dir: &Path) -> Result<usize, String> {
    let backup = backup_dir(dir);
    if !backup.is_dir() {
        return Err("Резервної копії оригіналів немає".into());
    }
    let mut n = 0;
    let mut written = read_written(dir);
    for e in fs::read_dir(&backup).map_err(|e| e.to_string())?.flatten() {
        fs::copy(e.path(), dir.join(e.file_name())).map_err(|e| e.to_string())?;
        written.remove(&e.file_name().to_string_lossy().to_string());
        n += 1;
    }
    save_written(dir, &written);
    Ok(n)
}

/// The test plugin the app adds to a game so it can start inside one scene.
pub const JUMP_PLUGIN: &str = "TranslyJump";

/// Add the plugin to the end of `$plugins` (the last one loads last, so it can wrap the engine's scenes).
/// Returns None when it is already listed.
pub fn patch_plugins_js(src: &str) -> Result<Option<String>, String> {
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
pub fn unpatch_plugins_js(src: &str) -> String {
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

pub fn apply_jump_files(data: &Path, source: &str) -> Result<(), String> {
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
pub fn restore_jump_files(data: &Path) -> Result<bool, String> {
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

/// Updates are fetched from this host only, and only as a release asset: the UI cannot make the app download or run
/// anything else.
pub fn allowed_update(url: &str, name: &str) -> Result<(), String> {
    allowed_update_from(url, name, option_env!("TRANSLY_UPDATE_REPO"))
}

/// `repo` is the repository this build was made in (the CI sets it): updates are taken from there and from nowhere else, so a
/// page cannot send the app to another repository. A local build has none and keeps the general rule.
pub fn allowed_update_from(url: &str, name: &str, repo: Option<&str>) -> Result<(), String> {
    if !url.starts_with("https://api.github.com/repos/") || !url.contains("/releases/assets/") || url.contains("..") {
        return Err("Оновлення можна брати лише з релізу GitHub".into());
    }
    if let Some(repo) = repo.filter(|r| !r.is_empty()) {
        let want = format!("https://api.github.com/repos/{}/releases/assets/", repo.to_lowercase());
        if !url.to_lowercase().starts_with(&want) {
            return Err("Оновлення можна брати лише з репозиторію, з якого зібрано цей застосунок".into());
        }
    }
    let n = safe_name(name)?.to_lowercase();
    if !(n.ends_with(".exe") || n.ends_with(".msi")) {
        return Err("Автоматично встановлюється лише інсталятор Windows (.exe, .msi)".into());
    }
    Ok(())
}

/// Download a release asset of a private repository. The API answers with a redirect to a pre-signed address that
/// must not receive the token, so the redirect is followed by hand.
pub fn download_asset(url: &str, token: &str, dest: &Path) -> Result<u64, String> {
    use std::io::Read;
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .user_agent("transly")
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(60))
        .build();
    // what GitHub says about the file (size, sha-256): the download is checked against it
    let meta: Option<serde_json::Value> = agent
        .get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|t| serde_json::from_str(&t).ok());
    let want_size = meta.as_ref().and_then(|m| m.get("size")).and_then(|v| v.as_u64());
    let want_sum = meta.as_ref().and_then(|m| m.get("digest")).and_then(|v| v.as_str()).and_then(|d| d.strip_prefix("sha256:")).map(|d| d.to_lowercase());
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
    drop(out);
    let bad = |why: &str| {
        let _ = fs::remove_file(dest);
        Err(why.to_string())
    };
    if n == 0 {
        return bad("Порожній файл оновлення");
    }
    if want_size.is_some_and(|s| s != n) {
        return bad("Файл оновлення завантажився не повністю: розмір не збігається з тим, що вказав GitHub");
    }
    // Without a checksum from GitHub the file cannot be checked at all: an installer is never started unchecked.
    let Some(sum) = want_sum else {
        return bad("GitHub не повідомив контрольну суму файлу оновлення: інсталятор не запущено");
    };
    if sha256_hex(dest)? != sum {
        return bad("Контрольна сума файлу оновлення не збігається з тією, що вказав GitHub");
    }
    Ok(n)
}

pub fn sha256_hex(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let k = f.read(&mut buf).map_err(|e| e.to_string())?;
        if k == 0 {
            break;
        }
        h.update(&buf[..k]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/* ---------- the update in the background: fetched while the app works, installed without a window when it closes ---------- */

/// What the UI asked for, and what has already been done (the installer is started once).
#[derive(Default)]
pub struct UpdateFlags {
    /// Install a downloaded update when the app closes.
    pub auto: std::sync::atomic::AtomicBool,
    /// The app is being closed on purpose to update: start it again afterwards.
    pub relaunch: std::sync::atomic::AtomicBool,
    pub started: std::sync::atomic::AtomicBool,
}

/// The installer that waits in the app's data folder: its name, its SHA-256 and the build (the commit) it is.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct PendingUpdate {
    pub name: String,
    pub sum: String,
    pub build: String,
}

pub const PENDING_FILE: &str = "pending.json";


pub fn read_pending(dir: &Path) -> Option<PendingUpdate> {
    serde_json::from_str(&fs::read_to_string(dir.join(PENDING_FILE)).ok()?).ok()
}

/// The waiting installer, checked once more right before it is started: it must be exactly the file that was downloaded and checked.
pub fn verified_pending(dir: &Path) -> Result<(PathBuf, PendingUpdate), String> {
    let p = read_pending(dir).ok_or("Оновлення не завантажено")?;
    let path = dir.join(safe_name(&p.name)?);
    if !path.is_file() || sha256_hex(&path)? != p.sum {
        return Err("Файл оновлення змінився або пошкоджений: інсталятор не запущено".into());
    }
    Ok((path, p))
}

/// A string for PowerShell in single quotes.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// What the helper does after the app has closed: waits for it, runs the installer without a window, starts the app again when asked, tidies up.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn silent_install_script(pid: u32, installer: &Path, exe: &Path, relaunch: bool) -> String {
    let again = if relaunch { format!("; Start-Process -FilePath {}", ps_quote(&exe.to_string_lossy())) } else { String::new() };
    let dir = installer.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "Wait-Process -Id {pid} -ErrorAction SilentlyContinue; Start-Process -FilePath {} -ArgumentList '/S' -Wait{again}; Remove-Item -Path {} -Recurse -Force -ErrorAction SilentlyContinue",
        ps_quote(&installer.to_string_lossy()),
        ps_quote(&dir)
    )
}

#[cfg(windows)]
pub fn spawn_silent_install(installer: &Path, relaunch: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = silent_install_script(std::process::id(), installer, &exe, relaunch);
    // no window of its own (CREATE_NO_WINDOW), its own process group, and it outlives the app
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x0800_0000 | 0x0000_0200)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Не вдалося запустити встановлення: {e}"))
}

#[cfg(not(windows))]
pub fn spawn_silent_install(_installer: &Path, _relaunch: bool) -> Result<(), String> {
    Err("Автоматичне встановлення працює лише у Windows".into())
}

/// Only the two dictionaries the app links to: https, no credentials in the address, no spaces.
pub fn dictionary_url_ok(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    matches!(host, "goroh.pp.ua" | "multitran.com" | "www.multitran.com")
}


// ---------- операції верхнього рівня (були командами Tauri) ----------

/// Запам'ятати папку, яку користувач щойно обрав у діалозі: дозволити її в цьому сеансі й записати в список обраних.
pub fn register_picked(roots: &Roots, picked: &Picked, path: &Path) {
    roots.allow(path);
    picked.add(path);
}

/// Те саме для програми гри: дозволяється її папка.
pub fn register_picked_exe(roots: &Roots, picked: &Picked, exe: &Path) {
    if let Some(parent) = exe.parent() {
        register_picked(roots, picked, parent);
    }
}

pub fn list_json(roots: &Roots, dir: &str, exts: Option<Vec<String>>) -> Result<Vec<JsonFile>, String> {
    let d = roots.check_read(dir)?;
    let mut out = Vec::new();
    walk(&d, 0, &mut out, &clean_exts(exts));
    Ok(out)
}

/// Шляхи всіх файлів обраної теки (лише назви, нічого не читається): щоб визначити, що це за гра, коли її не можна прочитати.
pub fn list_names(roots: &Roots, dir: &str) -> Result<Vec<String>, String> {
    let d = roots.check_read(dir)?;
    let mut out = Vec::new();
    names_in(&d, &d, 0, &mut out);
    Ok(out)
}

pub fn read_text(roots: &Roots, path: &str) -> Result<String, String> {
    read_text_checked(roots, path)
}

/// Картинка з теки гри як сирі байти. Лише всередині обраної теки.
pub fn read_image(roots: &Roots, game: &str, rel: &str) -> Result<Vec<u8>, String> {
    fs::read(find_image(roots, game, rel)?).map_err(|e| e.to_string())
}

pub fn apply_data(roots: &Roots, data_dir: &str, files: &[OutFile]) -> Result<usize, String> {
    apply_files(&roots.check(data_dir)?, files)
}

pub fn restore_data(roots: &Roots, data_dir: &str) -> Result<usize, String> {
    restore_files(&roots.check(data_dir)?)
}

pub fn apply_jump(roots: &Roots, data_dir: &str, source: &str) -> Result<(), String> {
    apply_jump_files(&roots.check(data_dir)?, source)
}

pub fn restore_jump(roots: &Roots, data_dir: &str) -> Result<bool, String> {
    restore_jump_files(&roots.check(data_dir)?)
}

pub fn launch(roots: &Roots, exe: &str) -> Result<(), String> {
    let p = roots.check(exe)?;
    if !p.is_file() {
        return Err("Файл гри не знайдено".into());
    }
    let mut cmd = Command::new(&p);
    if let Some(dir) = p.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Не вдалося запустити гру: {e}"))
}

pub fn open_url(url: &str) -> Result<(), String> {
    if !dictionary_url_ok(url) {
        return Err("Цю адресу не дозволено".into());
    }
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url).spawn().map(|_| ()).map_err(|e| format!("Не вдалося відкрити браузер: {e}"))
}

/// Завантажує інсталятор Windows нової версії й запускає його. Застосунок після цього має закритися (це робить виклик).
/// Блокувальна: викликається з окремого потоку.
pub fn install_update(url: &str, token: &str, name: &str) -> Result<(), String> {
    allowed_update(url, name)?;
    if !cfg!(windows) {
        return Err("Автоматичне встановлення працює лише у Windows: завантажте файл зі сторінки релізу".into());
    }
    let dir = std::env::temp_dir().join("transly-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    download_asset(url, token, &path)?;
    let started = if name.to_lowercase().ends_with(".msi") { Command::new("msiexec").arg("/i").arg(&path).spawn() } else { Command::new(&path).spawn() };
    started.map(|_| ()).map_err(|e| format!("Не вдалося запустити інсталятор: {e}"))
}

/// Завантажує й перевіряє інсталятор нової версії в теку оновлень застосунку (`dir`); нічого не запускається.
/// Версія, що вже там лежить, не качається знову. Блокувальна.
pub fn prefetch_update(dir: &Path, url: &str, token: &str, name: &str, build: &str) -> Result<(), String> {
    allowed_update(url, name)?;
    if !name.to_lowercase().ends_with(".exe") {
        return Err("У фоні встановлюється лише інсталятор .exe".into());
    }
    if build.is_empty() || build.len() > 64 || !build.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Невідомий номер збірки".into());
    }
    if read_pending(dir).is_some_and(|p| p.build == build) && verified_pending(dir).is_ok() {
        return Ok(());
    }
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(name)?);
    download_asset(url, token, &path)?;
    let sum = sha256_hex(&path)?;
    let meta = serde_json::to_string(&PendingUpdate { name: name.to_string(), sum, build: build.to_string() }).map_err(|e| e.to_string())?;
    fs::write(dir.join(PENDING_FILE), meta).map_err(|e| e.to_string())
}

/// Збірка (коміт) інсталятора, що чекає, коли він цілий.
pub fn pending_update(dir: &Path) -> Option<String> {
    verified_pending(dir).ok().map(|(_, p)| p.build)
}

pub fn clear_pending_update(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
}

/// Застосунок закривається: інсталятор, що чекає й перевірений, запускається без вікна (раз), а застосунок стартує знову, якщо закриття було оновленням.
pub fn install_on_exit(flags: &UpdateFlags, dir: &Path) {
    use std::sync::atomic::Ordering::SeqCst;
    let relaunch = flags.relaunch.load(SeqCst);
    if !(flags.auto.load(SeqCst) || relaunch) || flags.started.swap(true, SeqCst) {
        return;
    }
    let Ok((path, _)) = verified_pending(dir) else { return };
    let _ = spawn_silent_install(&path, relaunch);
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
        // a drive prefix would take the file out of the folder on Windows, a colon names an alternate stream
        assert!(safe_name("D:evil.json").is_err());
        assert!(safe_name("Map001.json:stream").is_err());
        assert!(safe_name("a|b.json").is_err());
        assert!(safe_name("trailing.").is_err());
        assert!(safe_name("with space ").is_err());
    }

    #[test]
    fn updates_are_taken_only_from_the_repository_the_build_came_from() {
        let ok = "https://api.github.com/repos/Jazirka/Transly/releases/assets/123";
        assert!(allowed_update_from(ok, "Transly_setup.exe", Some("jazirka/transly")).is_ok());
        assert!(allowed_update_from("https://api.github.com/repos/evil/transly/releases/assets/1", "x.exe", Some("jazirka/transly")).is_err());
        assert!(allowed_update_from("https://api.github.com/repos/jazirka/transly-evil/releases/assets/1", "x.exe", Some("jazirka/transly")).is_err());
        // a local build keeps the general rule
        assert!(allowed_update_from("https://api.github.com/repos/evil/transly/releases/assets/1", "x.exe", None).is_ok());
        assert!(allowed_update_from(ok, "x.zip", Some("jazirka/transly")).is_err());
    }

    #[test]
    fn a_byte_order_mark_is_dropped_when_a_file_is_read() {
        let tmp = std::env::temp_dir().join("transly-test-bom");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("A.json");
        fs::write(&f, "\u{feff}{\"a\":1}").unwrap();
        let roots = Roots::default();
        roots.allow(&tmp);
        let text = fs::read_to_string(roots.check_read(f.to_str().unwrap()).unwrap()).unwrap();
        assert!(text.starts_with('\u{feff}'));
        assert_eq!(read_text_checked(&roots, f.to_str().unwrap()).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn sha256_of_a_known_string() {
        let tmp = std::env::temp_dir().join("transly-test-sha");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("abc.bin");
        fs::write(&f, b"abc").unwrap();
        assert_eq!(sha256_hex(&f).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn a_folder_nobody_picked_is_not_brought_back() {
        let tmp = std::env::temp_dir().join("transly-test-picked");
        let _ = fs::remove_dir_all(&tmp);
        let game = tmp.join("game");
        let other = tmp.join("other");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&other).unwrap();
        let picked = Picked::open(tmp.join("picked.json"));
        picked.add(&game);
        // a later session reads the list from the app's own file
        let roots = Roots::default();
        let later = Picked::open(tmp.join("picked.json"));
        assert!(allow_picked(&roots, &later, game.to_str().unwrap()).is_ok());
        assert!(roots.check(game.join("x.json").to_str().unwrap()).is_ok());
        let fresh = Roots::default();
        assert!(allow_picked(&fresh, &later, other.to_str().unwrap()).is_err());
        assert!(fresh.check(other.join("x.json").to_str().unwrap()).is_err());
        // a parent of a picked folder is not picked either
        assert!(allow_picked(&fresh, &later, tmp.to_str().unwrap()).is_err());
        // the program's folder counts when the program was picked
        let exe = game.join("game.exe");
        fs::write(&exe, b"x").unwrap();
        assert!(allow_picked(&fresh, &later, exe.to_str().unwrap()).is_ok());
        assert!(!Picked { file: None, list: Mutex::new(Vec::new()) }.has(&game));
    }

    #[test]
    fn a_failed_write_leaves_the_game_as_it_was_and_an_update_refreshes_the_backup() {
        let base = std::env::temp_dir().join("transly-test-apply-update");
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("A.json"), "\"orig A v1\"").unwrap();
        fs::write(data.join("B.json"), "\"orig B v1\"").unwrap();
        let out = |n: &str, c: &str| OutFile { name: n.into(), content: c.into() };
        // the second file cannot be staged (its temporary name is taken by a folder): nothing of the game changes
        fs::create_dir_all(data.join("B.json.transly-tmp")).unwrap();
        assert!(apply_files(&data, &[out("A.json", "\"uk A\""), out("B.json", "\"uk B\"")]).is_err());
        assert_eq!(fs::read_to_string(data.join("A.json")).unwrap(), "\"orig A v1\"");
        assert_eq!(fs::read_to_string(data.join("B.json")).unwrap(), "\"orig B v1\"");
        assert!(!data.join("A.json.transly-tmp").exists());
        fs::remove_dir_all(data.join("B.json.transly-tmp")).unwrap();
        // a normal apply keeps the originals
        assert_eq!(apply_files(&data, &[out("A.json", "\"uk A\""), out("B.json", "\"uk B\"")]).unwrap(), 2);
        assert_eq!(fs::read_to_string(data.join("A.json")).unwrap(), "\"uk A\"");
        let written = read_written(&data);
        assert_eq!(fs::read_to_string(original_of(&data, "A.json", &written).unwrap()).unwrap(), "\"orig A v1\"");
        // the publisher updates the game: the file is a new original, and it is what the list offers as the original
        fs::write(data.join("A.json"), "\"orig A v2\"").unwrap();
        assert!(original_of(&data, "A.json", &written).is_none());
        // applying again takes the new original as the backup (the old one is kept aside), and a restore gives v2 back
        assert_eq!(apply_files(&data, &[out("A.json", "\"uk A 2\"")]).unwrap(), 1);
        assert_eq!(fs::read_to_string(backup_dir(&data).join("A.json")).unwrap(), "\"orig A v2\"");
        assert_eq!(fs::read_to_string(previous_dir(&data).join("A.json")).unwrap(), "\"orig A v1\"");
        assert_eq!(restore_files(&data).unwrap(), 2);
        assert_eq!(fs::read_to_string(data.join("A.json")).unwrap(), "\"orig A v2\"");
        assert_eq!(fs::read_to_string(data.join("B.json")).unwrap(), "\"orig B v1\"");
        // an unchanged translated file is not mistaken for an update
        assert_eq!(apply_files(&data, &[out("B.json", "\"uk B\"")]).unwrap(), 1);
        assert_eq!(apply_files(&data, &[out("B.json", "\"uk B again\"")]).unwrap(), 1);
        assert_eq!(fs::read_to_string(backup_dir(&data).join("B.json")).unwrap(), "\"orig B v1\"");
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
    fn only_the_two_dictionaries_can_be_opened() {
        assert!(dictionary_url_ok("https://goroh.pp.ua/%D0%A2%D0%BB/%D0%BC%D0%B5%D1%87"));
        assert!(dictionary_url_ok("https://www.multitran.com/m.exe?l1=1&l2=33&s=sword"));
        assert!(!dictionary_url_ok("http://goroh.pp.ua/x"));
        assert!(!dictionary_url_ok("https://evil.com/goroh.pp.ua"));
        assert!(!dictionary_url_ok("https://goroh.pp.ua@evil.com/"));
        assert!(!dictionary_url_ok("https://goroh.pp.ua.evil.com/"));
        assert!(!dictionary_url_ok("javascript:alert(1)"));
        assert!(!dictionary_url_ok("https://goroh.pp.ua/a b"));
    }

    #[test]
    fn images_are_found_in_game_or_www_and_cannot_escape() {
        let base = std::env::temp_dir().join("transly-test-img");
        let _ = fs::remove_dir_all(&base);
        let game = base.join("game");
        fs::create_dir_all(game.join("www").join("img").join("system")).unwrap();
        fs::write(game.join("www").join("img").join("system").join("IconSet.png"), b"png").unwrap();
        fs::write(base.join("secret.png"), b"x").unwrap();
        let roots = Roots::default();
        roots.allow(&game);
        let g = game.to_str().unwrap();
        assert!(find_image(&roots, g, "img/system/IconSet.png").is_ok());
        assert!(find_image(&roots, g, "img/system/Nope.png").is_err());
        assert!(find_image(&roots, g, "../secret.png").is_err());
        assert!(find_image(&roots, g, "/etc/passwd").is_err());
    }

    #[test]
    fn listing_points_at_the_backed_up_original_and_skips_the_backup_folder() {
        let base = std::env::temp_dir().join("transly-test-orig");
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("A.json"), "\"Тулуб\"").unwrap();
        fs::write(data.join("B.json"), "\"fresh\"").unwrap();
        let backup = backup_dir(&data);
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("A.json"), "\"Body\"").unwrap();
        let mut out = Vec::new();
        walk(&base, 0, &mut out, &[".json".to_string()]);
        out.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(out.len(), 2, "the backup folder must not be listed");
        assert!(out[0].path.ends_with("A.json") && out[0].path.contains("data") && !out[0].path.contains("transly-orig"));
        let orig = out[0].orig.as_ref().expect("A.json has a backup");
        assert_eq!(fs::read_to_string(orig).unwrap(), "\"Body\"");
        assert!(out[1].orig.is_none());
        // the backup next to a picked folder can be read, other siblings cannot
        let roots = Roots::default();
        roots.allow(&data);
        assert!(roots.check(backup.join("A.json").to_str().unwrap()).is_ok());
        assert!(roots.check(base.join("other.json").to_str().unwrap()).is_err());
    }

    #[test]
    fn spare_data1_is_the_original_when_there_is_no_backup() {
        let base = std::env::temp_dir().join("transly-test-data1");
        let _ = fs::remove_dir_all(&base);
        let (data, spare) = (base.join("data"), base.join("data1"));
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&spare).unwrap();
        fs::write(data.join("A.json"), "\"Тулуб\"").unwrap();
        fs::write(data.join("B.json"), "\"b\"").unwrap();
        fs::write(spare.join("A.json"), "\"Body\"").unwrap();
        assert_eq!(fs::read_to_string(original_of(&data, "A.json", &Default::default()).unwrap()).unwrap(), "\"Body\"");
        assert!(original_of(&data, "B.json", &Default::default()).is_none());
        let backup = backup_dir(&data);
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("A.json"), "\"Backup\"").unwrap();
        assert_eq!(fs::read_to_string(original_of(&data, "A.json", &Default::default()).unwrap()).unwrap(), "\"Backup\"");
        let roots = Roots::default();
        roots.allow(&data);
        assert!(roots.check_read(spare.join("A.json").to_str().unwrap()).is_ok());
        assert!(roots.check(spare.join("A.json").to_str().unwrap()).is_err(), "the spare copy is read-only");
        assert!(alt_dir(&base.join("other")).is_none());
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

    /// A one-shot GitHub: the metadata request (Accept: json) is answered with `meta`, the file request with the bytes.
    fn serve_asset(meta: &'static str, body: &'static str) -> (u16, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let th = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut c, _) = listener.accept().unwrap();
                let mut buf = [0u8; 4096];
                let n = c.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                let (ctype, payload) = if req.contains("application/vnd.github+json") { ("application/json", meta) } else { ("application/octet-stream", body) };
                let _ = write!(c, "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len());
            }
        });
        (port, th)
    }

    #[test]
    fn an_update_is_never_started_without_a_checksum_from_github_and_never_with_a_wrong_one() {
        let dest = std::env::temp_dir().join("transly-test-update-sum.bin");
        // no checksum in the metadata: refused, nothing is left behind
        let (port, th) = serve_asset("{\"size\":5}", "hello");
        let err = download_asset(&format!("http://127.0.0.1:{port}/asset"), "t", &dest).unwrap_err();
        th.join().unwrap();
        assert!(err.contains("контрольну суму"), "{err}");
        assert!(!dest.exists());
        // a wrong checksum: refused
        let (port, th) = serve_asset("{\"size\":5,\"digest\":\"sha256:0000000000000000000000000000000000000000000000000000000000000000\"}", "hello");
        let err = download_asset(&format!("http://127.0.0.1:{port}/asset"), "t", &dest).unwrap_err();
        th.join().unwrap();
        assert!(err.contains("не збігається"), "{err}");
        assert!(!dest.exists());
        // the right one: accepted
        let (port, th) = serve_asset("{\"size\":5,\"digest\":\"sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824\"}", "hello");
        assert_eq!(download_asset(&format!("http://127.0.0.1:{port}/asset"), "t", &dest).unwrap(), 5);
        th.join().unwrap();
        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn a_waiting_update_is_started_only_when_it_is_the_file_that_was_downloaded() {
        let dir = std::env::temp_dir().join(format!("transly-pending-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(verified_pending(&dir).is_err(), "nothing is waiting");
        fs::write(dir.join("setup.exe"), b"installer").unwrap();
        let sum = sha256_hex(&dir.join("setup.exe")).unwrap();
        let meta = |sum: &str| serde_json::to_string(&PendingUpdate { name: "setup.exe".into(), sum: sum.into(), build: "abc123".into() }).unwrap();
        fs::write(dir.join(PENDING_FILE), meta(&sum)).unwrap();
        let (path, p) = verified_pending(&dir).unwrap();
        assert!(path.ends_with("setup.exe") && p.build == "abc123");
        fs::write(dir.join("setup.exe"), b"changed").unwrap();
        assert!(verified_pending(&dir).is_err(), "a changed installer is never started");
        fs::write(dir.join(PENDING_FILE), "{\"name\":\"../evil.exe\",\"sum\":\"0\",\"build\":\"x\"}").unwrap();
        assert!(verified_pending(&dir).is_err(), "a name that leaves the folder is refused");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_helper_waits_for_the_app_installs_silently_and_starts_the_app_only_when_asked() {
        let inst = Path::new("C:\\Users\\O'Neil\\AppData\\transly\\updates\\Transly_setup.exe");
        let exe = Path::new("C:\\Program Files\\Transly\\Transly.exe");
        let quiet = silent_install_script(4242, inst, exe, false);
        assert!(quiet.starts_with("Wait-Process -Id 4242"), "{quiet}");
        assert!(quiet.contains("-ArgumentList '/S' -Wait"), "{quiet}");
        assert!(!quiet.contains("Transly.exe"), "closing the app does not start it again: {quiet}");
        assert!(quiet.contains("O''Neil"), "a quote in a path is doubled: {quiet}");
        let again = silent_install_script(4242, inst, exe, true);
        assert!(again.contains("Start-Process -FilePath 'C:\\Program Files\\Transly\\Transly.exe'"), "{again}");
        assert!(again.find("/S").unwrap() < again.find("Transly.exe").unwrap(), "the app starts after the installer: {again}");
        assert_eq!(ps_quote("a'b"), "'a''b'");
    }

    #[test]
    fn only_a_checked_installer_exe_is_fetched_in_the_background() {
        assert!(allowed_update_from("https://api.github.com/repos/o/r/releases/assets/1", "Transly_setup.exe", None).is_ok());
        assert!(allowed_update_from("https://example.com/Transly_setup.exe", "Transly_setup.exe", None).is_err());
    }

    #[test]
    fn walk_reads_the_extensions_asked_for_and_names_are_listed() {
        let base = std::env::temp_dir().join(format!("transly-exts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let game = base.join("game");
        fs::create_dir_all(&game).unwrap();
        fs::write(game.join("a.json"), "{}").unwrap();
        fs::write(game.join("script.RPY"), "label start:").unwrap();
        fs::write(game.join("x.lang"), "k=v").unwrap();
        fs::write(game.join("pic.png"), "png").unwrap();
        let mut out = Vec::new();
        walk(&base, 0, &mut out, &clean_exts(None));
        assert_eq!(out.len(), 1, "without asking only json is listed");
        let mut out = Vec::new();
        walk(&base, 0, &mut out, &clean_exts(Some(vec![".rpy".into(), ".lang".into(), "bad".into(), "..x".into(), ".a/b".into()])));
        let mut names: Vec<_> = out.iter().map(|f| f.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["a.json", "script.RPY", "x.lang"], "case does not matter and odd extensions are ignored");
        let mut all = Vec::new();
        names_in(&base, &base, 0, &mut all);
        all.sort();
        assert_eq!(all, vec!["game/a.json", "game/pic.png", "game/script.RPY", "game/x.lang"]);
        let _ = fs::remove_dir_all(&base);
    }
}
