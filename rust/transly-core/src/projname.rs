//! `projname.ts`: як проєкт називається для перекладача: назва теки, з якої відкрито гру (власної теки гри, не `data` чи `www`
//! всередині), або назва, яку гра дає собі (System.json), або назва, яку написав перекладач. Збережене `SavedProject.name` лишається
//! як було (це ідентичність проєкту для злиттів і приміток); тут лише те, що показується.

use crate::js;
use crate::project::SavedProject;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

pub const DEFAULT_NAME: &str = "Новий проєкт";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameSource {
    Folder,
    Game,
    Custom,
}
impl NameSource {
    pub fn as_str(self) -> &'static str {
        match self {
            NameSource::Folder => "folder",
            NameSource::Game => "game",
            NameSource::Custom => "custom",
        }
    }
}

/// Теки всередині гри, які ніколи не є її назвою.
const INSIDE: [&str; 11] = ["data", "www", "js", "img", "audio", "movies", "fonts", "locales", "resources", "app", "game"];

static SEP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\\/]+").unwrap());
static DRIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z]:$").unwrap());
static UNDERSCORES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"_+").unwrap());
static NON_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());

/// Назва теки гри зі шляху, з якого її відкрито. Порожньо, коли її нема.
pub fn name_from_folder(path: &str) -> String {
    let mut parts: Vec<&str> = SEP.split(path).map(js::trim).filter(|s| !s.is_empty()).collect();
    while parts.last().is_some_and(|l| INSIDE.contains(&l.to_lowercase().as_str())) {
        parts.pop();
    }
    let last = parts.last().copied().unwrap_or("");
    // літера диска чи корінь — не назва
    if DRIVE.is_match(last) {
        String::new()
    } else {
        js::trim(&UNDERSCORES.replace_all(last, " ")).to_string()
    }
}

/// Назва, яку гра дає собі (System.json `gameTitle`), з копії оригіналів. Порожньо, коли її нема.
pub fn game_title_of(snapshot: Option<&Value>) -> String {
    let Some(Value::Object(snap)) = snapshot else { return String::new() };
    let sys = snap.get("System.json").filter(|v| !v.is_null()).or_else(|| snap.iter().find(|(n, _)| n.rsplit('/').next() == Some("System.json")).map(|(_, v)| v));
    sys.and_then(Value::as_array)
        .and_then(|units| units.iter().find(|u| u.get("key").and_then(Value::as_str) == Some("gameTitle")))
        .and_then(|u| u.get("source").and_then(Value::as_str))
        .map_or(String::new(), |s| js::trim(s).to_string())
}

fn setting(p: &SavedProject, k: &str) -> Option<String> {
    p.settings.get(k).and_then(Value::as_str).map(|s| js::trim(s).to_string())
}

/// Звідки береться показувана назва (назва, написана вручну, враховується, лише коли вона є).
pub fn name_source_of(p: &SavedProject) -> NameSource {
    let from = p.settings.get("nameFrom").and_then(Value::as_str);
    if from == Some("custom") && setting(p, "title").is_some_and(|t| !t.is_empty()) {
        NameSource::Custom
    } else if from == Some("game") {
        NameSource::Game
    } else {
        NameSource::Folder
    }
}

/// Показувана назва за вибраним джерелом: те саме правило, що в `project_title`, але для значень, яких ще не збережено (чернетка в налаштуваннях проєкту).
pub fn title_from(from: NameSource, own: &str, folder: &str, game: &str, name: &str) -> String {
    let (own, folder) = (js::trim(own), js::trim(folder));
    if from == NameSource::Custom && !own.is_empty() {
        return own.to_string();
    }
    if from == NameSource::Game && !game.is_empty() {
        return game.to_string();
    }
    if !folder.is_empty() {
        return folder.to_string();
    }
    if !game.is_empty() {
        return game.to_string();
    }
    if name != DEFAULT_NAME && !name.is_empty() {
        return name.to_string();
    }
    DEFAULT_NAME.to_string()
}

/// Назва, що показується для проєкту скрізь.
pub fn project_title(p: &SavedProject) -> String {
    let game = game_title_of(p.snapshot.as_ref());
    title_from(name_source_of(p), &setting(p, "title").unwrap_or_default(), &setting(p, "folderName").unwrap_or_default(), &game, &p.name)
}

/// Слова, що не дають літери значку.
const SKIP: [&str; 21] = ["of", "the", "and", "a", "an", "in", "on", "at", "to", "for", "у", "в", "на", "та", "і", "й", "з", "до", "за", "по", "від"];

fn skipped(w: &str) -> bool {
    SKIP.contains(&w.to_lowercase().as_str())
}

/// Літери значка проєкту: одна чи дві. Два слова дають дві літери; перекладач може написати їх вручну.
pub fn icon_letters(p: &SavedProject) -> String {
    let own: String = js::trim(p.settings.get("iconText").and_then(Value::as_str).unwrap_or("")).chars().take(2).collect();
    if !own.is_empty() {
        return own.to_uppercase();
    }
    let title = project_title(p);
    if title == DEFAULT_NAME {
        return "Н".into();
    }
    let words: Vec<&str> = NON_WORD.split(&title).filter(|w| !w.is_empty()).collect();
    let real: Vec<&str> = words.iter().copied().filter(|w| !skipped(w)).collect();
    let pick = if real.is_empty() { &words } else { &real };
    let letters: String = pick.iter().take(2).filter_map(|w| w.chars().next()).collect::<String>().to_uppercase();
    if letters.is_empty() {
        "T".into()
    } else {
        letters
    }
}
