//! Синхронізація через репозиторій GitHub, що належить перекладачеві (`app/src/core/github.ts`). Розкладку файлів і саму
//! синхронізацію дає `transly_core::filesync`; тут — репозиторій як набір файлів через git data API: голова гілки, її дерево
//! і коміти. Кілька пристроїв пушать в одну гілку; синхронізація — кілька запитів незалежно від кількості змінених файлів.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use indexmap::IndexMap;
use serde_json::{json, Value};
use transly_core::filesync::{Head, PushResult, RemoteFiles};

/// Запит до API: метод, шлях (від `https://api.github.com`), тіло. Повертає код і JSON відповіді.
pub trait GithubApi {
    fn request(&mut self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String>;
}

#[derive(Clone, Debug)]
pub struct GithubSettings {
    /// `власник/назва`.
    pub repo: String,
    /// Порожньо — типова гілка репозиторію. Гілка, якої ще нема, створюється від типової.
    pub branch: String,
    /// Тека в репозиторії; порожньо — корінь.
    pub dir: String,
    /// Тримати в репозиторії оригінальні рядки гри. Лише для приватного репозиторію.
    pub originals: bool,
}

/// Справжній API GitHub з токеном.
pub struct HttpApi {
    pub token: String,
    agent: ureq::Agent,
}

impl HttpApi {
    pub fn new(token: &str) -> HttpApi {
        let agent = ureq::AgentBuilder::new().user_agent("transly").timeout_connect(std::time::Duration::from_secs(30)).timeout_read(std::time::Duration::from_secs(60)).build();
        HttpApi { token: token.to_string(), agent }
    }
}

impl GithubApi for HttpApi {
    fn request(&mut self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        let url = format!("https://api.github.com{path}");
        let req = self.agent.request(method, &url).set("Authorization", &format!("Bearer {}", self.token)).set("Accept", "application/vnd.github+json").set("X-GitHub-Api-Version", "2022-11-28");
        let res = match body {
            Some(b) => req.send_json(b.clone()),
            None => req.call(),
        };
        match res {
            Ok(r) => {
                let status = r.status();
                Ok((status, r.into_json().unwrap_or(Value::Null)))
            }
            Err(ureq::Error::Status(code, r)) => Ok((code, r.into_json().unwrap_or(Value::Null))),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn explain(status: u16, what: &str) -> String {
    let why = match status {
        401 => "токен недійсний або прострочений".to_string(),
        403 => "немає прав або вичерпано ліміт запитів (токен має мати доступ «Contents: Read and write» до цього репозиторію)".to_string(),
        404 => "репозиторій не знайдено (для приватного токен має мати до нього доступ)".to_string(),
        409 => "репозиторій порожній: створіть у ньому будь-який файл (наприклад README) і повторіть".to_string(),
        422 => "GitHub відхилив запит".to_string(),
        0 => "немає з’єднання з GitHub".to_string(),
        s => format!("помилка {s}"),
    };
    format!("GitHub: {what}: {why}")
}

/// Одним запитом дерева не більше стільки байтів тексту.
const CHUNK_BYTES: usize = 6_000_000;

fn str_of<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn valid_repo(repo: &str) -> bool {
    let ok = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') && !p.chars().all(|c| c == '.');
    let mut it = repo.split('/');
    matches!((it.next(), it.next(), it.next()), (Some(a), Some(b), None) if ok(a) && ok(b))
}

/// Репозиторій як набір файлів.
pub struct GithubRemote<'a> {
    api: &'a mut dyn GithubApi,
    base: String,
    cfg: GithubSettings,
    branch: String,
    root_tree: String,
}

impl<'a> GithubRemote<'a> {
    pub fn new(api: &'a mut dyn GithubApi, cfg: &GithubSettings) -> Result<GithubRemote<'a>, String> {
        let repo = transly_core::js::trim(&cfg.repo).to_string();
        // «.» і «..» — дозволені символи, але не назви: `/repos/../x` API нормалізувало б до іншої точки
        if !valid_repo(&repo) {
            return Err("Репозиторій вкажіть як «власник/назва», наприклад ivan/my-translation".into());
        }
        Ok(GithubRemote { api, base: format!("/repos/{repo}"), cfg: cfg.clone(), branch: String::new(), root_tree: String::new() })
    }

    fn call(&mut self, method: &str, path: &str, what: &str, body: Option<&Value>) -> Result<Value, String> {
        let (status, json) = self.api.request(method, path, body).map_err(|_| explain(0, what))?;
        if status == 200 || status == 201 {
            Ok(json)
        } else {
            Err(explain(status, what))
        }
    }

    fn get_ref(&mut self, branch: &str) -> Result<Option<String>, String> {
        let path = format!("{}/git/ref/heads/{branch}", self.base);
        let (status, json) = self.api.request("GET", &path, None).map_err(|_| explain(0, "читання гілки"))?;
        match status {
            404 | 409 => Ok(None),
            200 => Ok(Some(json.get("object").map_or("", |o| str_of(o, "sha")).to_string())),
            s => Err(explain(s, "читання гілки")),
        }
    }
}

impl RemoteFiles for GithubRemote<'_> {
    fn head(&mut self) -> Result<Head, String> {
        let base = self.base.clone();
        let info = self.call("GET", &base, "відкриття репозиторію", None)?;
        let default = info.get("default_branch").and_then(Value::as_str).unwrap_or("main").to_string();
        self.branch = if transly_core::js::trim(&self.cfg.branch).is_empty() { default.clone() } else { transly_core::js::trim(&self.cfg.branch).to_string() };
        let branch = self.branch.clone();
        let head = match self.get_ref(&branch)? {
            Some(h) => h,
            None => {
                let Some(def) = self.get_ref(&default)? else { return Err(explain(409, "читання гілки")) };
                self.call("POST", &format!("{base}/git/refs"), "створення гілки", Some(&json!({ "ref": format!("refs/heads/{branch}"), "sha": def })))?;
                def
            }
        };
        let commit = self.call("GET", &format!("{base}/git/commits/{head}"), "читання коміту", None)?;
        self.root_tree = commit.get("tree").map_or("", |t| str_of(t, "sha")).to_string();
        let tree = self.call("GET", &format!("{base}/git/trees/{}?recursive=1", self.root_tree), "читання списку файлів", None)?;
        if tree.get("truncated") == Some(&Value::Bool(true)) {
            return Err("GitHub: у репозиторії забагато файлів. Вкажіть окрему папку або новий репозиторій".into());
        }
        let mut files = IndexMap::new();
        for t in tree.get("tree").and_then(Value::as_array).into_iter().flatten() {
            if str_of(t, "type") == "blob" {
                files.insert(str_of(t, "path").to_string(), str_of(t, "sha").to_string());
            }
        }
        Ok(Head { id: head, files, is_private: info.get("private") == Some(&Value::Bool(true)) })
    }

    fn read(&mut self, path: &str, sha: &str) -> Result<Vec<u8>, String> {
        let base = self.base.clone();
        let b = self.call("GET", &format!("{base}/git/blobs/{sha}"), &format!("читання {path}"), None)?;
        let clean: String = str_of(&b, "content").chars().filter(|c| !c.is_whitespace()).collect();
        STANDARD.decode(clean).map_err(|e| format!("GitHub: пошкоджений файл {path}: {e}"))
    }

    #[allow(unused_assignments)]
    // Текстові файли йдуть у нове дерево прямо, двійкові (стиснуті оригінали) — спершу як blob.
    fn push(&mut self, id: &str, changes: &IndexMap<String, Vec<u8>>, message: &str) -> Result<PushResult, String> {
        let base = self.base.clone();
        let mut base_tree = self.root_tree.clone();
        let mut batch: Vec<Value> = Vec::new();
        let mut size = 0usize;
        macro_rules! flush {
            () => {
                if !batch.is_empty() {
                    let made = self.call("POST", &format!("{base}/git/trees"), "запис файлів", Some(&json!({ "base_tree": base_tree, "tree": batch })))?;
                    base_tree = str_of(&made, "sha").to_string();
                    batch.clear();
                    size = 0;
                }
            };
        }
        for (path, bytes) in changes {
            if path.ends_with(".gz") {
                let blob = self.call("POST", &format!("{base}/git/blobs"), "запис файлу", Some(&json!({ "content": STANDARD.encode(bytes), "encoding": "base64" })))?;
                batch.push(json!({ "path": path, "mode": "100644", "type": "blob", "sha": str_of(&blob, "sha") }));
            } else {
                if size + bytes.len() > CHUNK_BYTES {
                    flush!();
                }
                batch.push(json!({ "path": path, "mode": "100644", "type": "blob", "content": String::from_utf8_lossy(bytes) }));
                size += bytes.len();
            }
        }
        flush!();
        let made = self.call("POST", &format!("{base}/git/commits"), "створення коміту", Some(&json!({ "message": message, "tree": base_tree, "parents": [id] })))?;
        let new_head = str_of(&made, "sha").to_string();
        let branch = self.branch.clone();
        let (status, upd) = self.api.request("PATCH", &format!("{base}/git/refs/heads/{branch}"), Some(&json!({ "sha": new_head, "force": false }))).map_err(|_| explain(0, "оновлення гілки"))?;
        if status == 422 {
            // Справжня гонка лишає гілку не там, де ми будували; усе інше — GitHub відмовляє в оновленні.
            // Коли й повторне читання не вдалося (мережа, 5xx), гонку від відмови не відрізнити: пробуємо знову, а не припиняємо.
            return match self.get_ref(&branch) {
                Err(_) => Ok(PushResult::Conflict),
                Ok(now) if now.as_deref().is_some_and(|n| n != id) => Ok(PushResult::Conflict),
                Ok(_) => Err(format!("GitHub: оновлення гілки відхилено: {}", upd.get("message").and_then(Value::as_str).unwrap_or("без пояснення"))),
            };
        }
        if status != 200 {
            return Err(explain(status, "оновлення гілки"));
        }
        Ok(PushResult::Ok(new_head))
    }
}

/// Одна синхронізація проєкту через репозиторій.
pub fn github_sync(
    api: &mut dyn GithubApi,
    cfg: &GithubSettings,
    state: &transly_core::filesync::FilesState,
    local: &transly_core::project::SavedProject,
    since: i64,
    now: i64,
) -> Result<transly_core::filesync::FilesReport, String> {
    let mut remote = GithubRemote::new(api, cfg)?;
    transly_core::filesync::sync_files(&mut remote, &transly_core::filesync::FilesOptions { dir: cfg.dir.clone(), originals: cfg.originals }, state, local, since, 4, now).map_err(|e| if e.starts_with("GitHub:") { e } else { format!("GitHub: {e}") })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use transly_core::filesync::FilesState;
    use transly_core::project::{deserialize, SavedProject};

    /// Крихітний GitHub у пам'яті: гілки, коміти, дерева й blob-и.
    #[derive(Default)]
    struct Fake {
        blobs: HashMap<String, Vec<u8>>,
        trees: HashMap<String, IndexMap<String, String>>,
        commits: HashMap<String, (String, String)>,
        refs: HashMap<String, String>,
        n: usize,
        private: bool,
    }

    impl Fake {
        fn id(&mut self, kind: &str) -> String {
            self.n += 1;
            format!("{kind}{:037}", self.n)
        }
        fn blob(&mut self, bytes: Vec<u8>) -> String {
            // як у git: ідентифікатор — хеш змісту (за ним синхронізація бачить, що змінилось)
            let id = transly_core::filesync::git_blob_sha(&bytes);
            self.blobs.insert(id.clone(), bytes);
            id
        }
        fn new() -> Fake {
            let mut f = Fake { private: true, ..Default::default() };
            let readme = f.blob(b"hi".to_vec());
            let tree = f.id("t");
            f.trees.insert(tree.clone(), IndexMap::from([("README.md".to_string(), readme)]));
            let c = f.id("c");
            f.commits.insert(c.clone(), (tree, String::new()));
            f.refs.insert("main".into(), c);
            f
        }
    }

    impl GithubApi for Fake {
        fn request(&mut self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
            let p = path.strip_prefix("/repos/me/repo").ok_or("чужий репозиторій")?;
            let seg: Vec<&str> = p.trim_start_matches('/').split('/').collect();
            Ok(match (method, seg.as_slice()) {
                ("GET", [""]) => (200, json!({ "default_branch": "main", "private": self.private })),
                ("GET", ["git", "ref", "heads", b]) => match self.refs.get(*b) {
                    Some(sha) => (200, json!({ "object": { "sha": sha } })),
                    None => (404, Value::Null),
                },
                ("POST", ["git", "refs"]) => {
                    let b = body.unwrap();
                    self.refs.insert(str_of(b, "ref").trim_start_matches("refs/heads/").to_string(), str_of(b, "sha").to_string());
                    (201, json!({}))
                }
                ("GET", ["git", "commits", sha]) => (200, json!({ "tree": { "sha": self.commits[*sha].0 } })),
                ("GET", ["git", "trees", rest]) => {
                    let t = rest.split('?').next().unwrap();
                    (200, json!({ "truncated": false, "tree": self.trees[t].iter().map(|(p, s)| json!({ "path": p, "type": "blob", "sha": s })).collect::<Vec<_>>() }))
                }
                ("GET", ["git", "blobs", sha]) => (200, json!({ "content": STANDARD.encode(&self.blobs[*sha]), "encoding": "base64" })),
                ("POST", ["git", "blobs"]) => {
                    let b = body.unwrap();
                    let bytes = if str_of(b, "encoding") == "base64" { STANDARD.decode(str_of(b, "content")).unwrap() } else { str_of(b, "content").as_bytes().to_vec() };
                    (201, json!({ "sha": self.blob(bytes) }))
                }
                ("POST", ["git", "trees"]) => {
                    let b = body.unwrap();
                    let mut tree = self.trees[str_of(b, "base_tree")].clone();
                    for e in b["tree"].as_array().unwrap() {
                        let sha = match e.get("sha").and_then(Value::as_str) {
                            Some(s) => s.to_string(),
                            None => self.blob(str_of(e, "content").as_bytes().to_vec()),
                        };
                        tree.insert(str_of(e, "path").to_string(), sha);
                    }
                    let id = self.id("t");
                    self.trees.insert(id.clone(), tree);
                    (201, json!({ "sha": id }))
                }
                ("POST", ["git", "commits"]) => {
                    let b = body.unwrap();
                    let id = self.id("c");
                    self.commits.insert(id.clone(), (str_of(b, "tree").to_string(), b["parents"][0].as_str().unwrap().to_string()));
                    (201, json!({ "sha": id }))
                }
                ("PATCH", ["git", "refs", "heads", br]) => {
                    let b = body.unwrap();
                    let new = str_of(b, "sha").to_string();
                    // не швидке перемотування (гілка пішла вперед) — 422, як у GitHub
                    if self.commits[&new].1 != self.refs[*br] {
                        (422, json!({ "message": "Update is not a fast forward" }))
                    } else {
                        self.refs.insert(br.to_string(), new);
                        (200, json!({}))
                    }
                }
                _ => (404, Value::Null),
            })
        }
    }

    fn project(target: &str, mt: i64) -> SavedProject {
        let t = format!(
            r#"{{"version":1,"name":"p","sourceLang":"en","targetLang":"uk","resetEpoch":0,"files":{{"a.json":{{"k":{{"target":"{target}","status":"draft","mt":{mt}}}}}}},"memory":[],"terms":[],"settings":{{"tolerancePct":25,"blockErrors":true,"who":"Ви","propagate":true,"pluginCommands":[],"pluginsAsked":false,"lineLimit":0}}}}"#
        );
        deserialize(&t, Some(1)).unwrap()
    }

    fn cfg() -> GithubSettings {
        GithubSettings { repo: "me/repo".into(), branch: String::new(), dir: "tr".into(), originals: false }
    }

    #[test]
    fn two_devices_sync_through_the_repository() {
        let mut api = Fake::new();
        let a = github_sync(&mut api, &cfg(), &FilesState::default(), &project("Привіт", 10), 0, 1).unwrap();
        assert!(a.pushed >= 2, "project.json і файл перекладу");
        // другий пристрій із пізнішою правкою того ж рядка
        let b = github_sync(&mut api, &cfg(), &FilesState::default(), &project("Вітаю", 20), 0, 1).unwrap();
        assert_eq!(b.project.files["a.json"]["k"].target, "Вітаю");
        // перший пристрій підтягує чужу правку
        let a2 = github_sync(&mut api, &cfg(), &a.state, &a.project, 0, 1).unwrap();
        assert_eq!(a2.project.files["a.json"]["k"].target, "Вітаю");
        assert!(a2.pulled >= 1);
        // нічого не змінилось: пушити нема що
        let again = github_sync(&mut api, &cfg(), &a2.state, &a2.project, 0, 1).unwrap();
        assert_eq!(again.pushed, 0);
        assert!(api.trees.values().any(|t| t.contains_key("tr/project.json")));
    }

    #[test]
    fn a_missing_branch_is_created_and_errors_are_explained() {
        let mut api = Fake::new();
        let c = GithubSettings { branch: "translation".into(), ..cfg() };
        github_sync(&mut api, &c, &FilesState::default(), &project("x", 5), 0, 1).unwrap();
        assert!(api.refs.contains_key("translation"));
        assert_ne!(api.refs["translation"], api.refs["main"]);
        assert!(GithubRemote::new(&mut api, &GithubSettings { repo: "../x".into(), ..cfg() }).is_err());
        assert!(GithubRemote::new(&mut api, &GithubSettings { repo: "noslash".into(), ..cfg() }).is_err());
        let bad = GithubSettings { repo: "other/repo".into(), ..cfg() };
        let err = github_sync(&mut api, &bad, &FilesState::default(), &project("x", 5), 0, 1);
        assert!(err.err().is_some_and(|e| e.starts_with("GitHub:")));
        assert!(explain(401, "x").contains("токен недійсний"));
    }
}
