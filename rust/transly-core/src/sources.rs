//! `ext/sources.ts`: звідки можна взяти плагін. Тут лише чиста частина (перевірка адрес, розбір посилань на GitHub, пакет із файлів,
//! вибраних користувачем); завантаження з мережі робить платформа.

use crate::manifest::MANIFEST_FILE;
use crate::registry::PluginSource;
use crate::zipread::read_zip;
use indexmap::IndexMap;
use regex::Regex;
use std::sync::LazyLock;
use url::Url;

fn is_local(u: &Url) -> bool {
    u.scheme() == "http" && matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"))
}

/// Адреса, з якої можна брати плагін: https (і локальний сервер розробки через http).
pub fn allowed_url(raw: &str) -> Option<Url> {
    let u = Url::parse(raw).ok()?;
    ((u.scheme() == "https" || is_local(&u)) && u.username().is_empty() && u.password().is_none()).then_some(u)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GithubSpec {
    pub owner: String,
    pub repo: String,
    pub r#ref: Option<String>,
    pub dir: Option<String>,
}

static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}$").unwrap());
static REPO_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.-]{1,100}$").unwrap());
static REF_OK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_./+-]{1,100}$").unwrap());
static DIR_OK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_. -]+(/[A-Za-z0-9_. -]+)*$").unwrap());
static GH_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^https://github\.com/([^/]+)/([^/#?]+?)(?:\.git)?(?:/tree/([^/]+)(?:/(.+?))?)?/?$").unwrap());
static SHORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([^/\s@#]+)/([^/\s@#]+?)(?:@([^#\s]+))?(?:#(.+))?$").unwrap());

fn ref_ok(r: &str) -> bool {
    REF_OK.is_match(r) && !r.contains("..")
}
fn dir_ok(d: &str) -> bool {
    DIR_OK.is_match(d) && !d.split('/').any(|x| x == ".." || x == ".")
}

/// `owner/repo`, `owner/repo@ref`, `owner/repo#folder` або адреса `https://github.com/owner/repo[/tree/ref[/folder]]`.
pub fn parse_github_ref(input: &str) -> Option<GithubSpec> {
    let s = crate::js::trim(input);
    let caps = GH_URL.captures(s).or_else(|| SHORT.captures(s))?;
    let (o, r) = (&caps[1], &caps[2]);
    let (rf, dir) = (caps.get(3).map(|m| m.as_str()), caps.get(4).map(|m| m.as_str()));
    (NAME.is_match(o) && REPO_NAME.is_match(r) && rf.is_none_or(ref_ok) && dir.is_none_or(dir_ok)).then(|| GithubSpec { owner: o.into(), repo: r.into(), r#ref: rf.map(String::from), dir: dir.map(String::from) })
}

static ZIP_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(zip|transly-plugin)$").unwrap());

/// Файли, які вибрав користувач: один zip чи `.transly-plugin`, або файли пакета, вибрані разом (тека).
pub fn entries_from_files(files: &[(String, Vec<u8>)]) -> Result<(IndexMap<String, Vec<u8>>, PluginSource), String> {
    let source = PluginSource { kind: "file".into(), ..Default::default() };
    if files.len() == 1 && ZIP_NAME.is_match(&files[0].0) {
        return Ok((read_zip(&files[0].1)?, source));
    }
    let mut entries: IndexMap<String, Vec<u8>> = IndexMap::new();
    for (name, data) in files {
        entries.insert(name.replace('\\', "/"), data.clone());
    }
    // файли, вибрані текою, приходять з назвою теки попереду: вона не частина пакета
    if !entries.contains_key(MANIFEST_FILE) {
        let tail = format!("/{MANIFEST_FILE}");
        if let Some(hit) = entries.keys().find(|p| p.ends_with(&tail)) {
            let dir = hit[..hit.len() - MANIFEST_FILE.len()].to_string();
            let moved: IndexMap<String, Vec<u8>> = entries.iter().filter(|(p, _)| p.starts_with(&dir)).map(|(p, b)| (p[dir.len()..].to_string(), b.clone())).collect();
            return Ok((moved, source));
        }
    }
    Ok((entries, source))
}
