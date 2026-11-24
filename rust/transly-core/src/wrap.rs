//! `wrap.ts`: перенесення рядків повідомлень під вікно гри. Керівні коди не рахуються й не рвуться; слово ламається по складах
//! дефісом, коли це дозволено (слово з кодом посередині, цифрами чи латиницею — ні).
//!
//! Відмінність від TS: функція виміру в пікселях (`measure`, у браузері) — `Option<Measure>`; у ядрі її дає той, хто викликає.

use crate::controlcodes::{display_length, visible_text, CODE_SOURCE};
use crate::hyphen::{hyphen_points, is_hyphenatable};
use crate::journal::FileView;
use crate::wrapconfig::*;
use regex::Regex;
use std::sync::LazyLock;

pub type Measure = std::rc::Rc<dyn Fn(&str) -> f64>;

fn disp(s: &str) -> f64 {
    display_length(s) as f64
}

/// Ширина найдовшого рядка без керівних кодів.
pub fn max_line_width(text: &str) -> usize {
    text.split('\n').map(display_length).max().unwrap_or(0)
}

/// Жадібний перенос слів без розриву слів. Стара точка входу: весь текст формується заново, коди не мають ширини.
pub fn wrap_lines(text: &str, width: f64) -> String {
    plan_wrap(text, &WrapOptions { width, hyphen: HyphenMode::Off, keep: WrapKeep::Reflow, ..WrapOptions::default() }).text
}

#[derive(Clone)]
pub struct WrapOptions {
    /// Місце в одному рядку в тому, що рахує `measure`. 0 чи менше — не переносити.
    pub width: f64,
    /// Ширина шматка тексту; коди мають бути безширинні. Типово `display_length`.
    pub measure: Option<Measure>,
    pub hyphen: HyphenMode,
    pub hyphen_char: String,
    pub min_left: usize,
    pub min_right: usize,
    /// `Long`: повідомлення, де всі рядки влазять, лишається як є; `Reflow` (типово): завжди формується заново.
    pub keep: WrapKeep,
    /// Вікно показує стільки рядків; `too_many` каже, що в тексті більше (0 — не рахується).
    pub max_lines: usize,
}
impl Default for WrapOptions {
    fn default() -> Self {
        WrapOptions { width: 0.0, measure: None, hyphen: HyphenMode::Off, hyphen_char: "-".into(), min_left: 2, min_right: 2, keep: WrapKeep::Reflow, max_lines: 0 }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WrapResult {
    pub text: String,
    pub lines: usize,
    /// Індекси рядків, що все ще ширші за вікно (слово, яке не розірвати).
    pub over: Vec<usize>,
    /// Скільки дефісів поставлено.
    pub hyphenated: usize,
    pub changed: bool,
    pub too_many: bool,
}

static WORD_PARTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"(?s)^((?:{CODE_SOURCE})*)(.*?)((?:{CODE_SOURCE})*)$")).unwrap());

/// Місця, де слово можна розірвати дефісом: голова (з дефісом) і хвіст, найдовша голова першою. Коди на краях ідуть зі своїм краєм слова.
fn break_candidates(word: &str, hc: &str, min_left: usize, min_right: usize) -> Vec<(String, String)> {
    let Some(m) = WORD_PARTS.captures(word) else { return Vec::new() };
    let (lead, core, trail) = (&m[1], &m[2], &m[3]);
    if !is_hyphenatable(core) {
        return Vec::new();
    }
    let ch: Vec<char> = core.chars().collect();
    hyphen_points(core, min_left, min_right)
        .into_iter()
        .rev()
        .map(|p| (format!("{lead}{}{hc}", ch[..p].iter().collect::<String>()), format!("{}{trail}", ch[p..].iter().collect::<String>())))
        .collect()
}

fn count(s: &str) -> usize {
    if s.is_empty() { 0 } else { s.split('\n').count() }
}

/// Розбиває повідомлення на рядки для вікна гри. Текст спершу збирається в один потік (`unwrap`), тож раніше перенесений
/// текст переноситься заново.
pub fn plan_wrap(text: &str, o: &WrapOptions) -> WrapResult {
    let measure = |s: &str| -> f64 { o.measure.as_ref().map_or_else(|| disp(s), |m| m(s)) };
    let width = o.width;
    let too_many = |n: usize| o.max_lines > 0 && n > o.max_lines;
    if width <= 0.0 || width.is_nan() || crate::js::trim(text).is_empty() {
        return WrapResult { text: text.into(), lines: count(text), over: vec![], hyphenated: 0, changed: false, too_many: too_many(count(text)) };
    }
    if o.keep == WrapKeep::Long {
        let ls: Vec<&str> = text.split('\n').collect();
        if ls.iter().all(|l| measure(l) <= width) {
            return WrapResult { text: text.into(), lines: ls.len(), over: vec![], hyphenated: 0, changed: false, too_many: too_many(ls.len()) };
        }
    }
    let (hyphen, hc) = (o.hyphen, o.hyphen_char.as_str());
    let mut lines: Vec<String> = Vec::new();
    let (mut cur, mut hyphenated) = (String::new(), 0usize);
    for word in unwrap(text).split(crate::js::is_space).filter(|w| !w.is_empty()) {
        let mut rest = word.to_string();
        while !rest.is_empty() {
            let joined = if cur.is_empty() { rest.clone() } else { format!("{cur} {rest}") };
            if measure(&joined) <= width {
                cur = joined;
                break;
            }
            // не влазить: розірвати слово, якщо це дозволено й допомагає
            let forced = cur.is_empty() && measure(&rest) > width;
            let mut cut: Option<(String, String)> = None;
            if hyphen != HyphenMode::Off && (hyphen == HyphenMode::Fill || forced || (!cur.is_empty() && measure(&cur) < 0.55 * width)) {
                cut = break_candidates(&rest, hc, o.min_left, o.min_right).into_iter().find(|(head, _)| measure(&if cur.is_empty() { head.clone() } else { format!("{cur} {head}") }) <= width);
            }
            if let Some((head, tail)) = cut {
                lines.push(if cur.is_empty() { head } else { format!("{cur} {head}") });
                hyphenated += 1;
                cur.clear();
                rest = tail;
                continue;
            }
            if !cur.is_empty() {
                lines.push(std::mem::take(&mut cur));
                continue;
            }
            lines.push(std::mem::take(&mut rest)); // сам у рядку й не розривається: виходить за вікно
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    let out = lines.join("\n");
    WrapResult { over: lines.iter().enumerate().filter(|(_, l)| measure(l) > width).map(|(i, _)| i).collect(), lines: lines.len(), changed: out != text, too_many: too_many(lines.len()), text: out, hyphenated }
}

/// Скільки рядків тексту ширші за `width` і скільки всього рядків: факти, з яких зроблено пораду QA.
pub fn line_facts(text: &str, width: f64, measure: Option<&dyn Fn(&str) -> f64>) -> (usize, usize) {
    let ls: Vec<&str> = text.split('\n').collect();
    let m = |s: &str| measure.map_or_else(|| disp(s), |f| f(s));
    (ls.len(), if width > 0.0 { ls.iter().filter(|l| m(l) > width).count() } else { 0 })
}

/// Яка ширина повідомлення, до якої воно не виходить за вікно: 95-й процентиль власних рядків оригіналу, бо автори
/// переносили вручну під вікно. 0, коли тексту замало.
pub fn auto_line_limit(views: &[FileView]) -> usize {
    let mut widths: Vec<usize> = Vec::new();
    for v in views {
        for u in &v.units {
            if !matches!(u.kind, crate::model::UnitKind::Dialogue | crate::model::UnitKind::Scroll) {
                continue;
            }
            if u.source.contains('\n') {
                widths.extend(u.source.split('\n').map(display_length));
            }
            if widths.len() > 200_000 {
                break;
            }
        }
    }
    if widths.len() < 200 {
        return 0;
    }
    widths.sort_unstable();
    widths[(widths.len() as f64 * 0.95).floor() as usize].clamp(20, 120)
}

/// Ширина в символах, коли оригінал не підказує (замало рядків, перенесених вручну): близько до стандартного вікна 816 px RPG Maker MV/MZ.
pub const DEFAULT_LINE_LIMIT: f64 = 50.0;

/// Межа для одного рядка: повідомлення з обличчям має вужчу текстову область.
pub fn limit_for(limit: f64, face: Option<&str>) -> f64 {
    if limit != 0.0 && face.is_some_and(|f| !f.is_empty()) { (limit * 0.8).floor() } else { limit }
}

static HYPHEN_BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([\p{L}'’ʼ])[-‐‑\x{00AD}]\n(\p{Ll})").unwrap());
static LINE_BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]*\n[ \t]*").unwrap());

/// Текст як один потік абзацу, для порівняння й пошуку (пам'ять перекладів, зв'язки, QA, пошук): переноси лише формували текст
/// під вікно гри. Слово, розірване дефісом наприкінці рядка, склеюється.
pub fn unwrap(text: &str) -> String {
    let a = HYPHEN_BREAK.replace_all(text, "${1}${2}");
    crate::js::trim(&LINE_BREAK.replace_all(&a, " ")).to_string()
}

/// Усе, від чого залежить перенесення повідомлень проєкту, визначене раз.
#[derive(Clone)]
pub struct WrapPlan {
    pub settings: WrapSettings,
    /// Ширина в символах рядка без обличчя; 0 — оригінал не підказує (тоді береться `DEFAULT_LINE_LIMIT`).
    pub limit: f64,
    /// Перекладач вимкнув ширину: нічого не переноситься, жоден рядок не «задовгий».
    pub disabled: bool,
    /// Ширина тексту в пікселях шрифту гри; без неї ширина в пікселях повертається до символів.
    pub measure: Option<Measure>,
}

#[derive(Clone, Debug, Default)]
pub struct MessageLike {
    pub kind: Option<String>,
    pub key: Option<String>,
    pub face: Option<String>,
}

/// Рядок Ren'Py (`L12`): його формує рушій.
fn is_renpy_line(key: &str) -> bool {
    let t = key.trim_end_matches(|c: char| c.is_ascii_digit());
    if t.len() == key.len() {
        return false;
    }
    match t.strip_suffix('L') {
        Some(rest) => rest.is_empty() || rest.ends_with('\u{241F}'),
        None => false,
    }
}

/// Одиниця, що є повідомленням у вікні гри (діалог і прокрутний текст RPG Maker).
pub fn is_message_unit(u: &MessageLike) -> bool {
    matches!(u.kind.as_deref(), Some("dialogue") | Some("scroll")) && !is_renpy_line(u.key.as_deref().unwrap_or(""))
}

/// Ширина лічиться в пікселях і є чим міряти.
pub fn uses_pixels(plan: &WrapPlan) -> bool {
    plan.settings.unit == WrapUnit::Px && plan.measure.is_some()
}

/// Ширина одного повідомлення в тому, що рахує `measure_of`; 0 — нема за чим переносити. Обличчя забирає місце в тексту.
pub fn width_of(plan: &WrapPlan, unit: &MessageLike) -> f64 {
    if plan.disabled {
        return 0.0;
    }
    if uses_pixels(plan) {
        return pixel_budget(unit.face.as_deref().is_some_and(|f| !f.is_empty()), GameWindow { width: plan.settings.px.width as f64, font: plan.settings.px.font as f64, ..MV_WINDOW });
    }
    limit_for(if plan.limit != 0.0 { plan.limit } else { DEFAULT_LINE_LIMIT }, unit.face.as_deref())
}

/// Як план міряє шматок тексту: пікселі через функцію браузера, інакше символи. Коди не займають місця в обох випадках.
pub fn measure_of(plan: &WrapPlan) -> Measure {
    match (&plan.measure, uses_pixels(plan)) {
        (Some(m), true) => {
            let m = m.clone();
            std::rc::Rc::new(move |s: &str| m(&visible_text(s)))
        }
        _ => std::rc::Rc::new(disp),
    }
}

/// Переносить одне повідомлення так, як налаштований проєкт; текст повертається як був, коли нема ширини.
pub fn wrap_message(plan: &WrapPlan, unit: &MessageLike, text: &str) -> WrapResult {
    let s = &plan.settings;
    plan_wrap(
        text,
        &WrapOptions {
            width: width_of(plan, unit),
            measure: Some(measure_of(plan)),
            hyphen: s.hyphen,
            hyphen_char: s.hyphen_char.clone(),
            min_left: s.min_left as usize,
            min_right: s.min_right as usize,
            keep: s.keep,
            max_lines: if unit.kind.as_deref() == Some("dialogue") { s.max_lines as usize } else { 0 },
        },
    )
}

fn mode_str(m: WrapMode) -> &'static str {
    match m { WrapMode::Build => "build", WrapMode::Text => "text", WrapMode::Off => "off" }
}

/// Частини плану, що змінюють результат, одним коротким текстом (для кешів).
pub fn plan_sig(p: Option<&WrapPlan>) -> String {
    let Some(p) = p else { return String::new() };
    let s = &p.settings;
    let unit = if s.unit == WrapUnit::Px { "px" } else { "chars" };
    let hy = match s.hyphen { HyphenMode::Off => "off", HyphenMode::Needed => "needed", HyphenMode::Fill => "fill" };
    let keep = if s.keep == WrapKeep::Long { "long" } else { "reflow" };
    format!("{},{unit},{hy},{},{},{},{keep},{},{},{},{},{},{}", mode_str(s.mode), s.hyphen_char, s.min_left, s.min_right, s.max_lines, s.px.width, s.px.font, p.limit, u8::from(p.disabled), if p.measure.is_some() { "m" } else { "" })
}

/// Що рахує ширина плану, словом для речення («символів», «пікселів»).
pub fn unit_word(plan: &WrapPlan) -> &'static str {
    if uses_pixels(plan) { "пікселів" } else { "символів" }
}

/// Скільки рядків має одне повідомлення, коли гра його показує: перенесене, якщо проєкт переносить, як написано, коли ні.
pub fn lines_shown(plan: &WrapPlan, unit: &MessageLike, text: &str) -> usize {
    if plan.settings.mode == WrapMode::Off || width_of(plan, unit) <= 0.0 {
        return count(text);
    }
    wrap_message(plan, unit, text).lines
}

pub struct TooWide {
    pub count: usize,
    pub widest: f64,
    pub width: f64,
}

/// Рядки повідомлення, ширші за вікно: скільки, і найширший у мірі плану.
pub fn too_wide(plan: &WrapPlan, unit: &MessageLike, text: &str) -> TooWide {
    let width = if is_message_unit(unit) { width_of(plan, unit) } else { 0.0 };
    let measure = measure_of(plan);
    if width <= 0.0 {
        return TooWide { count: 0, widest: 0.0, width: 0.0 };
    }
    let widths: Vec<f64> = text.split('\n').map(|l| measure(l)).collect();
    TooWide { count: widths.iter().filter(|&&w| w > width).count(), widest: widths.iter().cloned().fold(0.0, f64::max), width }
}

/// `unwrap` для пошуку: текст без переносу повертається як є.
pub fn flow_text(text: &str) -> String {
    if text.contains('\n') { unwrap(text) } else { text.to_string() }
}
