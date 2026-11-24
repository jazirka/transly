//! `qa.ts`: перевірки рядка (керівні коди, довжина, ширина вікна, терміни глосарія, правила форми) і непроігноровані примітки.
//!
//! Відмінність від TS: пам'ять відповідей по об'єкту рядка (`WeakMap`) не переноситься — кешування в Rust буде своє.

use crate::controlcodes::{display_length, missing_codes, with_codes};
use crate::glossary::{candidate_terms, has_term_in, prepare_text, target_has_term, Term};
use crate::model::{Entry, Unit};
use crate::plural::plural;
use crate::qarules::{run_rules, QaRules};
use crate::wrap::*;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Bad,
    Warn,
}
/// Яка це примітка, щоб перекладач не плутав пораду з обов'язковим: `error` ламає текст гри, `term` розходиться з глосарієм,
/// `context` — від ситуації рядка, `style` — рекомендація, `info` — довідка.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueCat {
    Error,
    Term,
    Context,
    Style,
    Info,
}
/// Готове виправлення: `text` замінює весь переклад.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IssueFix {
    pub label: String,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Issue {
    /// Правило, що її підняло. Ігнорування примітки зберігає цей ключ (`Entry.ign`).
    pub key: String,
    pub severity: Severity,
    pub cat: IssueCat,
    pub message: String,
    /// Чому це важливо чи як читати, показується на вимогу.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<IssueFix>,
    /// Керівні коди, яких бракує в перекладі (ключ `codes`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codes: Option<Vec<String>>,
}
impl Issue {
    fn new(key: &str, severity: Severity, cat: IssueCat, message: String) -> Issue {
        Issue { key: key.into(), severity, cat, message, detail: None, fix: None, codes: None }
    }
}

#[derive(Clone)]
pub struct QaOptions {
    pub tolerance_pct: f64,
    pub terms: Vec<Term>,
    /// Найдовший рядок повідомлення; 0 чи нема — не перевіряється. Ігнорується, коли є `wrap`.
    pub line_limit: Option<f64>,
    /// Перенесення проєкту: коли є, правило ширини йде за його режимом, одиницею й шириною, а кількість рядків стежиться.
    pub wrap: Option<WrapPlan>,
    /// Правила про форму тексту, визначені з налаштувань проєкту. Без них працюють лише п'ять перших перевірок.
    pub rules: Option<QaRules>,
}

pub fn default_qa() -> QaOptions {
    QaOptions { tolerance_pct: 25.0, terms: Vec::new(), line_limit: None, wrap: None, rules: None }
}

/// Менше символів різниці від оригіналу ніколи не варте примітки про довжину.
const MIN_LENGTH_GAP: usize = 6;

/// Відхилення довжини перекладу від оригіналу у відсотках (округлене, як `Math.round`).
pub fn length_deviation(source: &str, target: &str) -> i64 {
    let s = display_length(source);
    if s == 0 {
        return 0;
    }
    let v = (display_length(target) as f64 - s as f64) / s as f64 * 100.0;
    (v + 0.5).floor() as i64
}

/// Те, що з рядка потрібно перевіркам.
#[derive(Clone, Debug, Default)]
pub struct UnitLike {
    pub source: String,
    pub kind: Option<String>,
    pub face: Option<String>,
    pub key: Option<String>,
}
impl From<&Unit> for UnitLike {
    fn from(u: &Unit) -> UnitLike {
        let kind = serde_json::to_value(&u.kind).ok().and_then(|v| v.as_str().map(String::from));
        UnitLike { source: u.source.clone(), kind, face: u.face.clone(), key: Some(u.key.clone()) }
    }
}
impl UnitLike {
    fn msg(&self) -> MessageLike {
        MessageLike { kind: self.kind.clone(), key: self.key.clone(), face: self.face.clone() }
    }
}

/// Дві поради про форму повідомлення. `wrap`: рядок ширший за вікно, і ніщо його не перенесе (режим «у тексті» чи «вимкнено»;
/// в режимі «при збірці» файли гри переносить збірка). `lines`: у повідомленні більше рядків, ніж показує вікно; гра розіб'є на сторінки.
fn wrap_issues(unit: &UnitLike, target: &str, plan: &WrapPlan) -> Vec<Issue> {
    let m = unit.msg();
    if !is_message_unit(&m) {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mode = plan.settings.mode;
    let wide = too_wide(plan, &m, target);
    if wide.count > 0 && mode != crate::wrapconfig::WrapMode::Build {
        let r = wrap_message(plan, &m, target);
        let mut i = Issue::new(
            "wrap",
            Severity::Warn,
            IssueCat::Style,
            format!("Рядок задовгий для вікна: {} {}, зазвичай до {}. {}", (wide.widest + 0.5).floor(), unit_word(plan), wide.width, if r.changed { "Натисніть «Перенести за шириною»" } else { "Слово не вміщається, скоротіть його" }),
        );
        if r.changed {
            i.fix = Some(IssueFix { label: "Перенести за шириною".into(), text: r.text });
        }
        out.push(i);
    }
    let max = plan.settings.max_lines;
    if unit.kind.as_deref() == Some("dialogue") && max > 0 {
        // «При збірці» і «у тексті»: рядки, які гра справді покаже; «вимкнено»: рядки як написано
        let n = lines_shown(plan, &m, target);
        if n as i64 > max {
            out.push(Issue::new("lines", Severity::Warn, IssueCat::Style, format!("У повідомленні {}, а вікно показує {max}: гра покаже його на кількох сторінках", plural(n as i64, ["рядок", "рядки", "рядків"]))));
        }
    }
    out
}

pub fn check(unit: &UnitLike, target: &str, opts: &QaOptions) -> Vec<Issue> {
    if crate::js::trim(target).is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let miss = missing_codes(&unit.source, target);
    if !miss.is_empty() {
        let joined = miss.join(" ");
        out.push(Issue {
            key: "codes".into(),
            severity: Severity::Bad,
            cat: IssueCat::Error,
            message: format!("Пропущено керівні коди: {joined}"),
            detail: Some("Керівні коди (кольори, імена, змінні) гра підставляє сама; без них текст у грі зламається.".into()),
            fix: Some(IssueFix { label: format!("Вставити {joined}"), text: with_codes(&unit.source, target, &miss) }),
            codes: Some(miss),
        });
    }
    let dev = length_deviation(&unit.source, target);
    // відсоток мало значить для кількох символів (ім'я з 8 літер у 13 — це +63%): порада потребує й різниці в кілька символів
    if dev.abs() as f64 > opts.tolerance_pct && display_length(target).abs_diff(display_length(&unit.source)) >= MIN_LENGTH_GAP {
        out.push(Issue::new("len", Severity::Warn, IssueCat::Style, format!("Довжина відрізняється від оригіналу на {}{dev}%. Рекомендація: якнайближче до оригіналу", if dev > 0 { "+" } else { "" })));
    }
    if let Some(plan) = &opts.wrap {
        out.extend(wrap_issues(unit, target, plan));
    } else if let Some(ll) = opts.line_limit.filter(|l| *l != 0.0) {
        if matches!(unit.kind.as_deref(), Some("dialogue") | Some("scroll")) {
            let limit = limit_for(ll, unit.face.as_deref());
            let w = max_line_width(target) as f64;
            if w > limit {
                let wrapped = wrap_lines(target, limit);
                let mut i = Issue::new("wrap", Severity::Warn, IssueCat::Style, format!("Рядок задовгий для вікна: {w} символів, зазвичай до {limit}. Натисніть «Перенести за шириною»"));
                if wrapped != target {
                    i.fix = Some(IssueFix { label: "Перенести за шириною".into(), text: wrapped });
                }
                out.push(i);
            }
        }
    }
    let source_text = prepare_text(&unit.source);
    for ti in candidate_terms(&source_text, &opts.terms) {
        let t = &opts.terms[ti];
        if t.qa == Some(false) {
            continue;
        }
        let alt = t.alt.as_deref().unwrap_or(&[]);
        if has_term_in(&source_text, &t.en) && !target_has_term(target, &t.uk, alt) {
            let all: Vec<&str> = std::iter::once(t.uk.as_str()).chain(alt.iter().map(|s| s.as_str())).collect();
            out.push(Issue::new("term", Severity::Warn, IssueCat::Term, format!("Термін «{}» має бути «{}» за глосарієм", t.en, all.join("» або «"))));
        }
    }
    if let Some(rules) = &opts.rules {
        out.extend(run_rules(&unit.source, target, rules, unit.kind.as_deref()));
    }
    out
}

/// Примітки, які перекладач не проігнорував.
pub fn active_issues(unit: &UnitLike, entry: Option<&Entry>, opts: &QaOptions) -> Vec<Issue> {
    let Some(e) = entry.filter(|e| !e.target.is_empty()) else { return Vec::new() };
    let all = check(unit, &e.target, opts);
    match e.ign.as_deref() {
        Some(ign) if !ign.is_empty() => all.into_iter().filter(|i| !ign.contains(&i.key)).collect(),
        _ => all,
    }
}
