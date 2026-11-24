//! `pages.ts`: сторінки довгого списку. Список можна показувати сторінками (малюються лише рядки однієї сторінки: сторінка — місце,
//! куди перекладач може повернутись), одним безперервним списком з позначкою на початку кожної сторінки або просто безперервним.
//! Усе тут — арифметика над кількістю рядків; що малюється й де зберігається місце — справа екрана.

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PagesMode {
    Pages,
    Flow,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct PagesPrefs {
    pub mode: PagesMode,
    /// Рядків на сторінці.
    pub size: u32,
    /// Чи пам'ятаються сторінка, рядок і прокрутка кожного списку й повертаються.
    pub remember: bool,
}

pub const PAGE_SIZES: [u32; 4] = [25, 50, 100, 200];
pub const DEFAULT_PAGES: PagesPrefs = PagesPrefs { mode: PagesMode::Pages, size: 50, remember: true };

/// Налаштування з того, що збережено: пошкоджене чи старе значення повертається до типового по одному.
pub fn normalize_pages(raw: &Value) -> PagesPrefs {
    let mode = match raw.get("mode").and_then(Value::as_str) {
        Some("pages") => PagesMode::Pages,
        Some("flow") => PagesMode::Flow,
        Some("off") => PagesMode::Off,
        _ => DEFAULT_PAGES.mode,
    };
    let size = raw.get("size").and_then(Value::as_f64).and_then(|s| PAGE_SIZES.iter().copied().find(|p| *p as f64 == s)).unwrap_or(DEFAULT_PAGES.size);
    let remember = raw.get("remember").and_then(Value::as_bool).unwrap_or(DEFAULT_PAGES.remember);
    PagesPrefs { mode, size, remember }
}

/// Скільки сторінок дають `total` рядків (порожній список — одна порожня сторінка).
pub fn page_count(total: f64, size: f64) -> f64 {
    (total.max(0.0) / size.max(1.0)).ceil().max(1.0)
}

/// Сторінка (з 0), найближча до `page`, яку дозволяє список.
pub fn clamp_page(page: f64, total: f64, size: f64) -> f64 {
    (if page.is_finite() { page.floor() } else { 0.0 }).max(0.0).min(page_count(total, size) - 1.0)
}

/// Сторінка, на якій рядок із номером `index` (з 0).
pub fn page_of_index(index: f64, size: f64) -> f64 {
    (index / size.max(1.0)).floor().max(0.0)
}

/// Рядки сторінки як індекси [перший, після останнього).
pub fn page_range(page: f64, total: f64, size: f64) -> (f64, f64) {
    let p = clamp_page(page, total, size);
    (p * size, total.min((p + 1.0) * size))
}

/// Сторінка, де в `keys` стоїть рядок `key`, або None, коли його там нема.
pub fn page_of_key(keys: &[String], key: Option<&str>, size: f64) -> Option<f64> {
    let key = key.filter(|k| !k.is_empty())?;
    keys.iter().position(|k| k == key).map(|i| page_of_index(i as f64, size))
}

/// Яким був список, коли перекладач його залишив: сторінка, перший видимий рядок і наскільки прокручено.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Place {
    pub page: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
}

const PLACES_MAX: usize = 120;

/// `places` з `place` для `id` останнім (найстаріші відкидаються, щоб пам'ять не росла з кожним файлом і фільтром).
pub fn remember_place(places: &IndexMap<String, Place>, id: &str, place: Place) -> IndexMap<String, Place> {
    let mut out: IndexMap<String, Place> = places.iter().filter(|(k, _)| k.as_str() != id).map(|(k, v)| (k.clone(), v.clone())).collect();
    out.insert(id.to_string(), place);
    if out.len() > PLACES_MAX {
        let drop = out.len() - PLACES_MAX;
        out.drain(0..drop);
    }
    out
}

/// Місця з того, що збережено: усе, що не схоже на місце, відкидається.
pub fn normalize_places(raw: &Value) -> IndexMap<String, Place> {
    let mut out = IndexMap::new();
    let Some(o) = raw.as_object() else { return out };
    for (k, v) in o {
        let Some(p) = v.as_object() else { continue };
        let Some(page) = p.get("page").and_then(Value::as_f64).filter(|p| p.is_finite() && *p >= 0.0) else { continue };
        out.insert(
            k.clone(),
            Place {
                page: page.floor(),
                key: p.get("key").and_then(Value::as_str).map(String::from),
                top: p.get("top").and_then(Value::as_f64).filter(|t| t.is_finite() && *t >= 0.0),
            },
        );
    }
    out
}
