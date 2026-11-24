//! `engine.ts`: який формат читає файл і як з нього витягти рядки та записати переклад. Тут лише вбудовані формати
//! (RPG Maker, JSON локалізації, gettext, CSV, Ren'Py) у порядку пріоритету; формати плагінів прийдуть з `ext/*`.

use crate::formats::{csv, localejson, po, renpy};
use crate::model::{GameFile, Translations, Unit};
use crate::rpgmaker::{apply_rpgmaker, extract_rpgmaker, is_rpgmaker_file, ExtractOptions};
use serde_json::Value;

/// Ідентифікатор формату: `rpgmaker`, `locale-json`, `gettext`, `csv`, `renpy`.
pub type FormatId = &'static str;

/// Результат запису: розібраний JSON для JSON-форматів, рядок для текстових.
#[derive(Clone, Debug, PartialEq)]
pub enum Applied {
    Json(Value),
    Text(String),
}

pub fn base(name: &str) -> &str {
    name.rsplit(['\\', '/']).next().unwrap_or(name)
}
pub fn ext(name: &str) -> String {
    match name.rfind(['.', '/', '\\']) {
        Some(i) if name[i..].starts_with('.') && i + 1 < name.len() => name[i..].to_lowercase(),
        _ => String::new(),
    }
}

/// Який формат обробляє цей файл, або None, коли в ньому нема тексту для нас. Перший за пріоритетом.
pub fn format_of(name: &str) -> Option<FormatId> {
    let b = base(name);
    let e = ext(b);
    if e == ".json" && is_rpgmaker_file(b) {
        return Some("rpgmaker");
    }
    if e == ".json" && localejson::looks_like_locale_file(name) {
        return Some("locale-json");
    }
    match e.as_str() {
        ".po" | ".pot" => Some("gettext"),
        ".csv" | ".tsv" => Some("csv"),
        ".rpy" => Some("renpy"),
        _ => None,
    }
}

/// Текстові формати несуть вміст у `text`; JSON-формати — у `json`.
pub fn is_text_format(id: Option<FormatId>) -> bool {
    matches!(id, Some("gettext" | "csv" | "renpy"))
}

/// Витягує кожен рядок для перекладу з одного файлу. Невідомі файли не дають рядків.
pub fn extract(file: &GameFile, opts: &ExtractOptions) -> Vec<Unit> {
    match format_of(&file.name) {
        Some("rpgmaker") => extract_rpgmaker(&GameFile { name: base(&file.name).to_string(), ..file.clone() }, opts),
        Some("locale-json") => localejson::extract_locale_json(&file.json),
        Some("gettext") => file.text.as_deref().map_or(vec![], po::extract_po),
        Some("csv") => file.text.as_deref().map_or(vec![], csv::extract_csv),
        Some("renpy") => file.text.as_deref().map_or(vec![], renpy::extract_renpy),
        _ => vec![],
    }
}

/// Перекладена копія файлу. Вхід не змінюється.
pub fn apply(file: &GameFile, tr: &Translations) -> Applied {
    match format_of(&file.name) {
        Some("rpgmaker") => Applied::Json(apply_rpgmaker(&GameFile { name: base(&file.name).to_string(), ..file.clone() }, tr)),
        Some("locale-json") => Applied::Json(localejson::apply_locale_json(&file.json, tr)),
        Some("gettext") => Applied::Text(po::apply_po(file.text.as_deref().unwrap_or(""), tr)),
        Some("csv") => Applied::Text(csv::apply_csv(file.text.as_deref().unwrap_or(""), tr)),
        Some("renpy") => Applied::Text(renpy::apply_renpy(file.text.as_deref().unwrap_or(""), tr)),
        _ => Applied::Json(file.json.clone()),
    }
}
