//! `filesync.ts`: синхронізація проєкту через будь-який спільний набір файлів (репозиторій GitHub тощо). Проєкт зберігається простими
//! файлами, зручними для diff:
//!
//! ```text
//! project.json                    глосарій, пам'ять, мовці, налаштування (усе, крім роботи по файлах і позначок копій і збірок цього пристрою)
//! translations/<файл>.tr.json     по одному на файл гри: ключ рядка → переклад, статус, коментарі, історія
//! originals/snapshot.json.gz      оригінальні рядки гри (щоб телефон без гри міг їх показати)
//! originals/reference.json.gz     тексти довідкової мови
//! ```
//!
//! Кілька пристроїв пишуть в одне місце; кожна синхронізація тягне те, що змінилось, зливає рядок за рядком (новіша правка виграє, як
//! в усіх інших злиттях тут) і пише результат однією зміною. Саме місце — `RemoteFiles`.
//!
//! Відмінності від TS: обмін блокувальний (платформа обгортає мережу), час `now` приходить параметром, а байти `.gz` залежать від
//! реалізації стиснення (читаються однаково, а ідентифікатор git-блоба в них може відрізнятися).

use crate::js;
use crate::project::{deserialize, merge_projects, SavedProject};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use indexmap::IndexMap;
use serde_json::{ser::PrettyFormatter, Map, Value};
use sha1::{Digest, Sha1};
use std::io::{Read, Write};

/// Поточний стан спільного місця.
pub struct Head {
    /// Непрозорий id цього стану.
    pub id: String,
    /// Ідентифікатор змісту (див. `git_blob_sha`) кожного файла.
    pub files: IndexMap<String, String>,
    pub is_private: bool,
}

pub enum PushResult {
    Ok(String),
    /// Хтось інший написав відтоді.
    Conflict,
}

pub trait RemoteFiles {
    fn head(&mut self) -> Result<Head, String>;
    /// Байти одного файла зі списку `head`.
    fn read(&mut self, path: &str, sha: &str) -> Result<Vec<u8>, String>;
    /// Записує ці файли однією зміною поверх стану `id`.
    fn push(&mut self, id: &str, changes: &IndexMap<String, Vec<u8>>, message: &str) -> Result<PushResult, String>;
}

pub struct FilesOptions {
    /// Тека всередині спільного місця; порожня — корінь.
    pub dir: String,
    /// Тримати там оригінальні рядки гри. Лише коли місце приватне.
    pub originals: bool,
}

/// Що цей пристрій бачив у спільному місці минулого разу; дає наступній синхронізації тягнути лише змінене.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FilesState {
    pub shas: IndexMap<String, String>,
    /// Id стану, який ми бачили чи записали востаннє.
    pub commit: String,
    /// Ревізія оригіналів гри, як вони там лежать.
    pub assets_rev: i64,
}

pub struct FilesReport {
    pub project: SavedProject,
    /// Скачано файлів.
    pub pulled: usize,
    /// Записано файлів (0 — нічого надсилати).
    pub pushed: usize,
    pub conflicts: usize,
    pub got_snapshot: bool,
    /// Місце не приватне, тож оригінальні рядки гри в нього не потрапили.
    pub skipped_originals: bool,
    pub state: FilesState,
}

/// Той самий JSON для тих самих даних на кожному пристрої (ключі впорядковано на кожному рівні), щоб незмінна робота не пушилась знову.
fn canonical(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort_by(|a, b| js::cmp(a, b));
            Value::Object(keys.into_iter().map(|k| (k.clone(), canonical(&o[k]))).collect())
        }
        other => other.clone(),
    }
}

/// `JSON.stringify(canonical(v), null, 1) + '\n'`.
fn pretty(v: &Value) -> String {
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut out, PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(&canonical(v), &mut ser).expect("серіалізація в пам'ять");
    String::from_utf8(out).expect("JSON — це UTF-8") + "\n"
}

/// Id, який git дає файлу: SHA-1 від «blob <розмір>\0» і байтів. Дає змогу бачити, що змінилось, не завантажуючи.
pub fn git_blob_sha(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn gzip(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).expect("запис у пам'ять");
    e.finish().expect("запис у пам'ять")
}

pub fn gunzip(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    GzDecoder::new(data).read_to_end(&mut out).map_err(|e| format!("не вдалося розпакувати: {e}"))?;
    Ok(out)
}

pub fn norm_dir(d: &str) -> String {
    let t = js::trim(d).trim_matches('/');
    if t.is_empty() {
        String::new()
    } else {
        format!("{t}/")
    }
}

/// Проєкт без роботи по файлах, оригіналів, довідкової мови і позначок цього пристрою (`stamps`): це `project.json`.
fn manifest_of(p: &SavedProject) -> Map<String, Value> {
    let mut m = match serde_json::to_value(p) {
        Ok(Value::Object(o)) => o,
        _ => Map::new(),
    };
    for k in ["files", "snapshot", "reference", "stamps"] {
        m.shift_remove(k);
    }
    m
}

/// Файли проєкту. Двійкові оригінали — лише коли їх просять.
pub fn project_files(p: &SavedProject, dir_in: &str, with_assets: bool) -> IndexMap<String, Vec<u8>> {
    let dir = norm_dir(dir_in);
    let mut out: IndexMap<String, Vec<u8>> = IndexMap::new();
    // `stamps` (коли зроблено останню копію й збірку) — про зовнішній світ цього пристрою, а не про переклад: записані після кожної
    // синхронізації, вони змусили б наступну бачити зміну й пушити коміт, де лише новий час, знову й знову.
    out.insert(format!("{dir}project.json"), pretty(&Value::Object(manifest_of(p))).into_bytes());
    for (name, entries) in &p.files {
        if entries.is_empty() {
            continue;
        }
        let mut shown = serde_json::to_value(entries).expect("рядки в JSON");
        // `src` — власний текст гри: він іде лише туди, куди можуть іти оригінали (приватний репозиторій, на прохання), не в публічний.
        if !with_assets {
            if let Value::Object(rows) = &mut shown {
                for e in rows.values_mut() {
                    if let Value::Object(e) = e {
                        e.shift_remove("src");
                    }
                }
            }
        }
        out.insert(format!("{dir}translations/{name}.tr.json"), pretty(&shown).into_bytes());
    }
    if with_assets {
        if let Some(s) = &p.snapshot {
            out.insert(format!("{dir}originals/snapshot.json.gz"), gzip(js::stringify(s).as_bytes()));
        }
        if let Some(r) = &p.reference {
            out.insert(format!("{dir}originals/reference.json.gz"), gzip(js::stringify(r).as_bytes()));
        }
    }
    out
}

fn parse_json(bytes: &[u8]) -> Result<Value, String> {
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).map_err(|e| format!("пошкоджений JSON у спільному місці: {e}"))
}

pub fn sync_files(remote: &mut dyn RemoteFiles, cfg: &FilesOptions, state: &FilesState, local: &SavedProject, since: i64, max_tries: usize, now: i64) -> Result<FilesReport, String> {
    let dir = norm_dir(&cfg.dir);
    let mut project = local.clone();
    let (mut pulled, mut conflicts, mut got_snapshot) = (0usize, 0usize, false);
    let pj = format!("{dir}project.json");
    let tr_prefix = format!("{dir}translations/");
    let asset_prefix = format!("{dir}originals/");
    let wanted = |path: &str| path == pj || (path.starts_with(&tr_prefix) && path.ends_with(".tr.json"));

    for _ in 0..max_tries {
        let head = remote.head()?;
        let with_assets = cfg.originals && head.is_private;
        let skipped_originals = cfg.originals && !head.is_private;
        let remote_files: IndexMap<&String, &String> = head.files.iter().filter(|(p, _)| p.starts_with(&dir)).collect();

        // ---- скачати те, що змінилося відтоді, як цей пристрій дивився, і те, що відрізняється від того, що ми б записали
        let mine = project_files(&project, &dir, with_assets);
        let mine_sha: IndexMap<&String, String> = mine.iter().map(|(p, b)| (p, git_blob_sha(b))).collect();
        // Файл, який ми вже тримаємо (той самий зміст) чи бачили минулого разу, качати не треба, хіба що цей пристрій загубив копію.
        let to_get: Vec<String> = remote_files
            .iter()
            .filter(|(path, sha)| wanted(path) && (state.shas.get(path.as_str()) != Some(**sha) || !mine.contains_key(path.as_str())) && mine_sha.get(*path) != Some(*sha))
            .map(|(path, _)| (*path).clone())
            .collect();
        let mut blobs: IndexMap<String, Vec<u8>> = IndexMap::new();
        for path in &to_get {
            blobs.insert(path.clone(), remote.read(path, remote_files[path])?);
        }
        pulled += to_get.len();

        // Ревізія оригіналів, що тримає віддалене: з його project.json, коли ми його читали, інакше те, що знали.
        let same_manifest = remote_files.get(&pj).map(|s| s.as_str()) == mine_sha.get(&pj).map(|s| s.as_str());
        let mut remote_rev = if same_manifest { project.assets_rev.unwrap_or(0) } else { state.assets_rev };
        if !to_get.is_empty() {
            let mut files = Map::new();
            for path in &to_get {
                if let Some(rest) = path.strip_prefix(&tr_prefix) {
                    let name = rest.strip_suffix(".tr.json").unwrap_or(rest);
                    files.insert(name.to_string(), parse_json(&blobs[path])?);
                }
            }
            let manifest_bytes = blobs.get(&pj);
            // Без зміненого project.json у віддаленого нічого нового, крім роботи по файлах: зливаємо її на наш власний маніфест.
            let manifest: Map<String, Value> = match manifest_bytes {
                Some(b) => match parse_json(b)? {
                    Value::Object(o) => o,
                    _ => Map::new(),
                },
                None => manifest_of(&project),
            };
            // Репозиторій без оригіналів має рядки без `src`: цей пристрій лишає той, що знає (рядок від цього не «неперевірений»).
            for (name, rows) in files.iter_mut() {
                if let Value::Object(rows) = rows {
                    for (k, e) in rows.iter_mut() {
                        let mine_src = project.files.get(name).and_then(|m| m.get(k)).and_then(|e| e.src.clone()).filter(|s| !s.is_empty());
                        if let (Value::Object(e), Some(src)) = (e, mine_src) {
                            if !e.get("src").is_some_and(|s| !matches!(s, Value::Null | Value::Bool(false)) && s.as_str() != Some("")) {
                                e.insert("src".into(), Value::String(src));
                            }
                        }
                    }
                }
            }
            let mut doc = manifest;
            doc.insert("files".into(), Value::Object(files));
            let theirs = deserialize(&js::stringify(&Value::Object(doc)), Some(now))?;
            if manifest_bytes.is_some() {
                remote_rev = theirs.assets_rev.unwrap_or(0);
            }
            let my_rev = project.assets_rev.unwrap_or(0);
            let mut remote_project = theirs;
            let mut got_assets = false;
            if remote_rev > my_rev && with_assets {
                let snap_path = format!("{dir}originals/snapshot.json.gz");
                let ref_path = format!("{dir}originals/reference.json.gz");
                let mut read = |path: &String| -> Result<Value, String> { parse_json(&gunzip(&remote.read(path, remote_files[path])?)?) };
                let (mut snapshot, mut reference) = (None, None);
                if remote_files.contains_key(&snap_path) {
                    snapshot = Some(read(&snap_path)?);
                    pulled += 1;
                }
                if remote_files.contains_key(&ref_path) {
                    reference = Some(read(&ref_path)?);
                    pulled += 1;
                }
                if snapshot.is_some() || reference.is_some() {
                    if snapshot.is_some() {
                        remote_project.snapshot = snapshot;
                    }
                    if reference.is_some() {
                        remote_project.reference = reference;
                    }
                    got_assets = true;
                    got_snapshot = true;
                }
            }
            let m = merge_projects(&project, &remote_project, since);
            conflicts += m.conflicts.len();
            project = m.project;
            // Не заявляти новішу ревізію оригіналів, ніж ми справді тримаємо.
            if remote_rev > my_rev && !got_assets && project.snapshot.is_none() {
                project.assets_rev = (my_rev != 0).then_some(my_rev);
            }
        }

        // ---- що писати: файли, чий зміст відрізняється від віддаленого; оригінали лише коли вони там нові
        let out = project_files(&project, &dir, with_assets);
        let out_sha: IndexMap<&String, String> = out.iter().map(|(p, b)| (p, git_blob_sha(b))).collect();
        let is_asset = |p: &str| p.starts_with(&asset_prefix);
        let newer = project.assets_rev.unwrap_or(0) > remote_rev;
        let changed: Vec<&String> = out.keys().filter(|p| if is_asset(p) { !remote_files.contains_key(*p) || newer } else { Some(&out_sha[*p]) != remote_files.get(*p).copied() }).collect();
        let pushed_assets = changed.iter().any(|p| is_asset(p));

        let mut next_shas: IndexMap<String, String> = IndexMap::new();
        for (p, sha) in &remote_files {
            if wanted(p) || is_asset(p) {
                next_shas.insert((*p).clone(), (*sha).clone());
            }
        }
        if changed.is_empty() {
            return Ok(FilesReport { project, pulled, pushed: 0, conflicts, got_snapshot, skipped_originals, state: FilesState { shas: next_shas, commit: head.id, assets_rev: remote_rev } });
        }
        let n = changed.len();
        let batch: IndexMap<String, Vec<u8>> = changed.iter().map(|p| ((*p).clone(), out[*p].clone())).collect();
        let message = format!("Transly: синхронізація ({n} {})", if n == 1 { "файл" } else { "файлів" });
        match remote.push(&head.id, &batch, &message)? {
            PushResult::Conflict => continue, // хтось писав між тим: зливаємо його роботу й пробуємо знову
            PushResult::Ok(id) => {
                for p in &changed {
                    next_shas.insert((*p).clone(), out_sha[*p].clone());
                }
                let rev = if pushed_assets { project.assets_rev.unwrap_or(0) } else { remote_rev };
                return Ok(FilesReport { project, pulled, pushed: n, conflicts, got_snapshot, skipped_originals, state: FilesState { shas: next_shas, commit: id, assets_rev: rev } });
            }
        }
    }
    Err("Інший пристрій постійно змінює дані. Спробуйте ще раз".into())
}
