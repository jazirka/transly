//! `scene.ts`, `sceneindex.ts`: сцена — одна сторінка події: команди події мапи, спільної події чи сторінки бою. Рядки сцени
//! мають спільний ключ до `.list`, наприклад `events[3].pages[0].list[12]` і `events[3].pages[0].list[14].choice[1]`.

use crate::model::{PageInfo, Unit, UnitKind};
use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

static LIST_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.*\.list)\[([0-9]+)\](?:\.(choice\[([0-9]+)\]|cmd))?$").unwrap());

/// Сцена, до якої належить ключ (ключ до `.list`), або None для рядків поза сторінкою події.
pub fn scene_key(key: &str) -> Option<String> {
    LIST_KEY.captures(key).map(|m| m[1].to_string())
}

/// Рядки сцени, до якої належить `key`, у порядку гри. Формати без сцен дають рядки навколо.
pub fn scene_units(units: &[Unit], key: &str, around: usize) -> Vec<Unit> {
    if let Some(m) = LIST_KEY.captures(key) {
        let prefix = format!("{}[", &m[1]);
        return units.iter().filter(|u| u.key.starts_with(&prefix)).cloned().collect();
    }
    match units.iter().position(|u| u.key == key) {
        None => Vec::new(),
        Some(i) => units[i.saturating_sub(around)..(i + around + 1).min(units.len())].to_vec(),
    }
}

/// Один крок сцени, як його бачить гравець.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SceneLine {
    One { kind: &'static str, unit: Unit },
    /// Вибір: варіанти, по рядку на кожен.
    Choice { kind: &'static str, units: Vec<Unit> },
}

/// Групує рядки сцени в те, що відбувається на екрані: варіанти вибору стоять разом під своїм питанням.
pub fn scene_lines(units: &[Unit]) -> Vec<SceneLine> {
    let mut out: Vec<SceneLine> = Vec::new();
    let mut at = String::new();
    for u in units {
        let m = LIST_KEY.captures(&u.key);
        let is_choice = u.kind == UnitKind::Choice && m.as_ref().and_then(|m| m.get(3)).is_some_and(|g| g.as_str().starts_with("choice"));
        if is_choice {
            let m = m.unwrap();
            let id = format!("{}[{}]", &m[1], &m[2]);
            if let Some(SceneLine::Choice { units, .. }) = out.last_mut().filter(|_| at == id) {
                units.push(u.clone());
            } else {
                out.push(SceneLine::Choice { kind: "choice", units: vec![u.clone()] });
                at = id;
            }
        } else {
            let kind = if u.kind == UnitKind::Scroll { "scroll" } else if m.as_ref().and_then(|m| m.get(3)).is_some_and(|g| g.as_str() == "cmd") { "plugin" } else { "say" };
            out.push(SceneLine::One { kind, unit: u.clone() });
        }
    }
    out
}

/// Де рядок у даних гри: досить, щоб запустити гру з нього.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SceneAddress {
    Map {
        #[serde(rename = "mapId")]
        map_id: u64,
        #[serde(rename = "eventIndex")]
        event_index: u64,
        page: u64,
        index: u64,
    },
    Common { common: u64, index: u64 },
    Troop { troop: u64, page: u64, index: u64 },
}

static MAP_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Map([0-9]+)\.json$").unwrap());
static MAP_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^events\[([0-9]+)\]\.pages\[([0-9]+)\]\.list\[([0-9]+)\]").unwrap());
static COMMON_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[([0-9]+)\]\.list\[([0-9]+)\]").unwrap());
static TROOP_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[([0-9]+)\]\.pages\[([0-9]+)\]\.list\[([0-9]+)\]").unwrap());

fn n(m: &regex::Captures, i: usize) -> u64 {
    m[i].parse().unwrap_or(0)
}

pub fn scene_address(file: &str, key: &str) -> Option<SceneAddress> {
    if let Some(map) = MAP_FILE.captures(file) {
        return MAP_KEY.captures(key).map(|m| SceneAddress::Map { map_id: n(&map, 1), event_index: n(&m, 1), page: n(&m, 2), index: n(&m, 3) });
    }
    if file == "CommonEvents.json" {
        return COMMON_KEY.captures(key).map(|m| SceneAddress::Common { common: n(&m, 1), index: n(&m, 2) });
    }
    if file == "Troops.json" {
        return TROOP_KEY.captures(key).map(|m| SceneAddress::Troop { troop: n(&m, 1), page: n(&m, 2), index: n(&m, 3) });
    }
    None
}

/* ---------- sceneindex ---------- */

/// Одна сцена файлу: рядки однієї сторінки події, у порядку гри.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SceneInfo {
    /// Ключ списку команд сторінки, наприклад `events[3].pages[0].list`.
    pub id: String,
    /// Де відбувається: назва події так, як її дають рядки.
    pub title: String,
    /// Яка це сторінка події (з 1), коли подія має кілька сторінок із текстом.
    pub page: Option<usize>,
    /// Скільки сторінок події мають текст.
    pub pages: usize,
    /// Умови сторінки з її першого рядка.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cond: Option<PageInfo>,
    /// Індекс першого рядка серед рядків файлу.
    pub from: usize,
    pub units: Vec<Unit>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SceneIndex {
    pub scenes: Vec<SceneInfo>,
    /// Ключ рядка → позиція в `scenes`.
    pub by_key: IndexMap<String, usize>,
    /// Рядки файлу поза будь-якою сценою (наприклад, назва мапи).
    pub loose: Vec<Unit>,
}

static PAGES_LIST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.pages\[[0-9]+\]\.list$").unwrap());
static PAGE_NUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.pages\[([0-9]+)\]\.list$").unwrap());

/// Частина ключа сторінки події, що називає подію, тобто ключ без сторінки: `events[3]`, `[5]`.
fn event_of(id: &str) -> String {
    let a = PAGES_LIST.replace(id, "").into_owned();
    a.strip_suffix(".list").map(String::from).unwrap_or(a)
}
fn page_of(id: &str) -> Option<usize> {
    PAGE_NUM.captures(id).map(|m| m[1].parse::<usize>().unwrap_or(0) + 1)
}

/// Сцени файлу, або None, коли їх нема (файли бази, System.json, текстові формати). Файл ніколи не ділиться штучно: сцену
/// утворюють лише рядки, що справді стоять у списку команд сторінки події.
pub fn build_scene_index(units: &[Unit]) -> Option<SceneIndex> {
    let mut scenes: Vec<SceneInfo> = Vec::new();
    let mut by_id: IndexMap<String, usize> = IndexMap::new();
    let mut by_key: IndexMap<String, usize> = IndexMap::new();
    let mut loose: Vec<Unit> = Vec::new();
    for (i, u) in units.iter().enumerate() {
        let Some(id) = scene_key(&u.key) else {
            loose.push(u.clone());
            continue;
        };
        let at = *by_id.entry(id.clone()).or_insert_with(|| {
            scenes.push(SceneInfo { page: page_of(&id), id: id.clone(), title: u.context.clone(), pages: 1, from: i, units: Vec::new(), cond: u.page.clone() });
            scenes.len() - 1
        });
        let sc = &mut scenes[at];
        sc.units.push(u.clone());
        if u.page.is_some() && sc.cond.is_none() {
            sc.cond = u.page.clone();
        }
        by_key.insert(u.key.clone(), at);
    }
    if scenes.is_empty() {
        return None;
    }
    let mut per_event: IndexMap<String, usize> = IndexMap::new();
    for sc in &scenes {
        *per_event.entry(event_of(&sc.id)).or_insert(0) += 1;
    }
    for sc in scenes.iter_mut() {
        sc.pages = per_event.get(&event_of(&sc.id)).copied().unwrap_or(1);
    }
    Some(SceneIndex { scenes, by_key, loose })
}

/// Сцена, до якої належить рядок.
pub fn scene_at<'a>(idx: Option<&'a SceneIndex>, key: &str) -> Option<&'a SceneInfo> {
    let idx = idx?;
    idx.by_key.get(key).and_then(|&i| idx.scenes.get(i))
}

/// Назва зі сторінкою, коли в події їх більше однієї: `EV003 · Старий солдат · сторінка 2`.
pub fn scene_title(sc: &SceneInfo) -> String {
    match sc.page {
        Some(p) if sc.pages > 1 && p > 0 => format!("{} · сторінка {p}", sc.title),
        _ => sc.title.clone(),
    }
}

/// Сцена перед (-1) чи після (1) тією, де рядок, або None на краях.
pub fn step_scene<'a>(idx: Option<&'a SceneIndex>, key: &str, dir: i64) -> Option<&'a SceneInfo> {
    let idx = idx?;
    let at = *idx.by_key.get(key)? as i64;
    usize::try_from(at + dir).ok().and_then(|i| idx.scenes.get(i))
}
