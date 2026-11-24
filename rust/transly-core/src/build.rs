//! `build.ts`: збірка: з перекладів проєкту робить змінені файли гри. Файли гри не змінюються (збірка дає копії).

use crate::engine::{apply, format_of, is_text_format, Applied};
use crate::keys::with_edges;
use crate::model::{Entry, GameFile, Status, Translations, UnitKind};
use crate::project::{FileView, SavedProject};
use crate::qa::{active_issues, QaOptions, UnitLike};
use crate::wrap::{is_message_unit, wrap_message, MessageLike, WrapPlan};
use crate::wrapconfig::WrapMode;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone)]
pub struct BuildOptions {
    /// До збірки йдуть лише вичитані (appr); інакше — і ті, що чекають вичитки (done).
    pub only_approved: bool,
    /// Також чернетки: щоб перевірити переклад у грі, поки він ще пишеться.
    pub include_drafts: bool,
    /// Рядки з помилкою QA лишаються мовою оригіналу.
    pub block_errors: bool,
    pub qa: QaOptions,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BuiltFile {
    pub name: String,
    pub json: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct WrapStats {
    /// Повідомлення, чиї рядки переставлено.
    pub messages: usize,
    /// Дефісів, поставлених у слова.
    pub hyphens: usize,
    /// Повідомлення, що мають більше рядків, ніж показує вікно.
    #[serde(rename = "tooMany")]
    pub too_many: usize,
    /// Повідомлення зі словом, що досі не влазить у рядок.
    pub over: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct BuildResult {
    /// Змінені файли. `text` задано для текстових форматів; інакше серіалізується `json`.
    pub files: Vec<BuiltFile>,
    pub included: usize,
    /// Рядки з перекладом, що лишилися поза збіркою (статус чи помилка QA).
    pub skipped: usize,
    /// Ключі (`file::key`), що лишилися поза збіркою через помилки QA.
    pub blocked: Vec<String>,
    /// Файли з перекладами, які не вміє записати жоден увімкнений плагін: вони лишаються поза збіркою, і це про них сказано.
    pub unsupported: Vec<String>,
    /// Перенесення рядків, зроблене збіркою (режим «при збірці»; текст проєкту ніколи не змінюється).
    pub wrap: WrapStats,
}

/// Рядок, як його отримує гра: повідомлення, перенесене під вікно. Рядок проєкту не чіпається.
fn wrapped(plan: &WrapPlan, u: &MessageLike, e: &Entry, stats: &mut WrapStats) -> Entry {
    let r = wrap_message(plan, u, &e.target);
    if r.too_many {
        stats.too_many += 1;
    }
    if !r.over.is_empty() {
        stats.over += 1;
    }
    if !r.changed {
        return e.clone();
    }
    stats.messages += 1;
    stats.hyphens += r.hyphenated;
    Entry { target: r.text, ..e.clone() }
}

pub fn build(game: &[GameFile], views: &[FileView], saved: &SavedProject, opts: &BuildOptions) -> BuildResult {
    let mut out = BuildResult::default();
    let plan = opts.qa.wrap.as_ref();
    let wrapping = plan.is_some_and(|p| p.settings.mode == WrapMode::Build);
    for v in views {
        let Some(file) = game.iter().find(|f| f.name == v.name) else { continue };
        let Some(entries) = saved.files.get(&v.name) else { continue };
        let fmt = format_of(&file.name);
        if fmt.is_none() {
            if entries.values().any(|e| !crate::js::trim(&e.target).is_empty()) {
                out.unsupported.push(v.name.clone());
            }
            continue;
        }
        let mut used = Translations::new();
        for u in &v.units {
            let Some(e) = entries.get(&u.key) else { continue };
            if crate::js::trim(&e.target).is_empty() {
                continue;
            }
            let stage_ok = e.status == Status::Appr || (!opts.only_approved && e.status == Status::Done) || (opts.include_drafts && e.status == Status::Draft);
            if !stage_ok {
                out.skipped += 1;
                continue;
            }
            if opts.block_errors && active_issues(&UnitLike::from(u), Some(e), &opts.qa).iter().any(|i| i.severity == crate::qa::Severity::Bad) {
                out.skipped += 1;
                out.blocked.push(format!("{}::{}", v.name, u.key));
                continue;
            }
            // назва, термін, команда меню чи текст плагіна лишає поля оригіналу (гра ставить його за ними); повідомлення — справа перекладача
            let spoken = matches!(u.kind, UnitKind::Dialogue | UnitKind::Scroll);
            let fitted = if spoken { e.target.clone() } else { with_edges(&u.source, &e.target) };
            let padded = if fitted != e.target { Entry { target: fitted, ..e.clone() } } else { e.clone() };
            let m = MessageLike { kind: Some(kind_str(&u.kind).into()), key: Some(u.key.clone()), face: u.face.clone() };
            let put = match plan {
                Some(p) if wrapping && fmt == Some("rpgmaker") && is_message_unit(&m) => wrapped(p, &m, &padded, &mut out.wrap),
                _ => padded,
            };
            used.insert(u.key.clone(), put);
            out.included += 1;
        }
        if !used.is_empty() {
            match apply(file, &used) {
                Applied::Text(t) if is_text_format(fmt) => out.files.push(BuiltFile { name: v.name.clone(), json: Value::Null, text: Some(t) }),
                Applied::Text(t) => out.files.push(BuiltFile { name: v.name.clone(), json: Value::String(t), text: None }),
                Applied::Json(j) if is_text_format(fmt) => out.files.push(BuiltFile { name: v.name.clone(), json: Value::Null, text: Some(j.to_string()) }),
                Applied::Json(j) => out.files.push(BuiltFile { name: v.name.clone(), json: j, text: None }),
            }
        }
    }
    out
}

fn kind_str(k: &UnitKind) -> &'static str {
    match k {
        UnitKind::Dialogue => "dialogue",
        UnitKind::Choice => "choice",
        UnitKind::Scroll => "scroll",
        UnitKind::Name => "name",
        UnitKind::Description => "description",
        UnitKind::Message => "message",
        UnitKind::Term => "term",
    }
}

/// Текст зібраного файлу, готовий до запису.
pub fn file_text(f: &BuiltFile) -> String {
    f.text.clone().unwrap_or_else(|| f.json.to_string())
}
