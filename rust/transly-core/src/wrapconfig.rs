//! `wrapconfig.ts` і `gamewindow.ts`: налаштування перенесення рядків і вікно повідомлень гри.
//! Налаштування живуть у проєкті як необов'язковий об'єкт `wrap`: проєкт, збережений до їх появи, чи копія з іншого пристрою без
//! нього, просто отримує типові значення для кожного поля, якого немає чи значення якого ця збірка не знає.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapMode {
    Build,
    Text,
    Off,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapUnit {
    Chars,
    Px,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HyphenMode {
    Off,
    Needed,
    Fill,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapKeep {
    Reflow,
    Long,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Px {
    pub width: i64,
    pub font: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WrapSettings {
    /// Коли рядки ламаються: у файлах гри під час збірки чи запуску (текст проєкту лишається цілим), у тексті при надсиланні, чи ніколи.
    pub mode: WrapMode,
    /// Ширина в символах (однакова на всіх пристроях) чи в пікселях вікна гри (міряється в браузері, приблизно).
    pub unit: WrapUnit,
    /// Перенос слова по складах: ніколи, лише коли рядок був би закороткий чи слово не влазить у вікно, чи щоразу, коли краще заповнює рядок.
    pub hyphen: HyphenMode,
    #[serde(rename = "hyphenChar")]
    pub hyphen_char: String,
    /// Найменше літер до й після дефіса.
    #[serde(rename = "minLeft")]
    pub min_left: i64,
    #[serde(rename = "minRight")]
    pub min_right: i64,
    /// `long`: повідомлення переформатовується, лише коли один із рядків задовгий; `reflow`: завжди.
    pub keep: WrapKeep,
    /// Вікно повідомлення показує стільки рядків; більше — лише попередження. 0 = не рахується.
    #[serde(rename = "maxLines")]
    pub max_lines: i64,
    /// Вікно гри для ширини в пікселях.
    pub px: Px,
}

pub fn default_wrap() -> WrapSettings {
    WrapSettings { mode: WrapMode::Build, unit: WrapUnit::Chars, hyphen: HyphenMode::Needed, hyphen_char: "-".into(), min_left: 2, min_right: 2, keep: WrapKeep::Long, max_lines: 4, px: Px { width: 816, font: 28 } }
}

fn num(v: Option<&Value>, lo: i64, hi: i64, d: i64) -> i64 {
    match v.and_then(|v| v.as_f64()).filter(|f| f.is_finite()) {
        // Math.round: половина вгору
        Some(f) => ((f + 0.5).floor() as i64).clamp(lo, hi),
        None => d,
    }
}
fn pick<T: Copy>(v: Option<&Value>, ok: &[(&str, T)], d: T) -> T {
    v.and_then(|v| v.as_str()).and_then(|s| ok.iter().find(|(k, _)| *k == s).map(|(_, t)| *t)).unwrap_or(d)
}

/// Налаштування перенесення проєкту, кожне поле перевірене й добране з типових. `wrap` — значення `settings.wrap`, якщо воно є.
pub fn wrap_of(wrap: Option<&Value>) -> WrapSettings {
    let d = default_wrap();
    let g = |k: &str| wrap.and_then(|w| w.get(k));
    let hc = match g("hyphenChar").and_then(|v| v.as_str()) {
        Some(s) if s.chars().count() == 1 && !s.chars().any(crate::js::is_space) => s.to_string(),
        _ => d.hyphen_char.clone(),
    };
    let px = g("px");
    WrapSettings {
        mode: pick(g("mode"), &[("build", WrapMode::Build), ("text", WrapMode::Text), ("off", WrapMode::Off)], d.mode),
        unit: pick(g("unit"), &[("chars", WrapUnit::Chars), ("px", WrapUnit::Px)], d.unit),
        hyphen: pick(g("hyphen"), &[("off", HyphenMode::Off), ("needed", HyphenMode::Needed), ("fill", HyphenMode::Fill)], d.hyphen),
        hyphen_char: hc,
        min_left: num(g("minLeft"), 1, 6, d.min_left),
        min_right: num(g("minRight"), 1, 6, d.min_right),
        keep: pick(g("keep"), &[("reflow", WrapKeep::Reflow), ("long", WrapKeep::Long)], d.keep),
        max_lines: num(g("maxLines"), 0, 12, d.max_lines),
        px: Px { width: num(px.and_then(|p| p.get("width")), 320, 4096, d.px.width), font: num(px.and_then(|p| p.get("font")), 10, 96, d.px.font) },
    }
}

/// Вікно повідомлень RPG Maker MV/MZ, як його бачить ширина рядка. Числа — типові для рушія.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GameWindow {
    pub width: f64,
    pub padding: f64,
    pub face: f64,
    pub font: f64,
}
pub const MV_WINDOW: GameWindow = GameWindow { width: 816.0, padding: 18.0, face: 168.0, font: 28.0 };

/// Ширина текстової області в пікселях: вікно без полів і без картинки обличчя, якщо в повідомленні вона є.
pub fn pixel_budget(has_face: bool, win: GameWindow) -> f64 {
    win.width - 2.0 * win.padding - if has_face { win.face } else { 0.0 }
}
