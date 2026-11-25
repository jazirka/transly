//! Стан застосунку без малювання: проєкт, рядки гри, вибір. Тестується без вікна.

use std::path::{Path, PathBuf};
use transly_core::model::{Entry, GameFile, Unit};
use transly_core::progress::{row_state, RowState};
use transly_core::build::{build, file_text, BuildOptions};
use transly_core::projname::name_from_folder;
use transly_core::project::{deserialize, empty_project, serialize, FileView, SavedProject};
use transly_core::ingest::{ingest_note, ingest_quiet, plan_ingest};
use transly_core::journal::{commit_rows, record_change};
use transly_core::historyview::{history_rows, HistoryRow};
use transly_core::tm::{FindOpts, TmEntry, TmIndex, TmMatch};
use transly_core::comments::{threads_of, Thread};
use transly_core::workflow::add_comment;
use transly_core::glossary::{prepare_text, term_ranges_in, Term};
use transly_core::qa::{check, default_qa, Issue, UnitLike};
use transly_core::termedit::{save_term, SaveResult, TermForm};
use transly_core::readgame::read_game;
use transly_core::rpgmaker::ExtractOptions;
use transly_core::workflow::{edit, reconcile, submit, Stage, SubmitOptions, SubmitResult};
use crate::plugins::PluginHost;
use transly_core::filesync::{FilesReport, FilesState};
use transly_platform::github::{github_sync, GithubSettings, HttpApi};
use transly_platform::{apply_data, apply_jump, launch, register_picked_exe, restore_jump, list_json, read_text, register_picked, restore_data, OutFile, Picked, Roots};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowStatus {
    Untranslated,
    Draft,
    Sent,
    Approved,
}

/// Що перекладач обрав у вікні збірки.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuildChoice {
    pub only_approved: bool,
    pub include_drafts: bool,
    pub block_errors: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SettingsView {
    pub name: String,
    pub source_lang: String,
    pub target_lang: String,
    pub who: String,
    pub tolerance_pct: f64,
    pub block_errors: bool,
    pub propagate: bool,
    pub line_limit: f64,
}

#[derive(Default, Debug, PartialEq, Eq)]
pub struct Counts {
    pub total: usize,
    pub draft: usize,
    pub sent: usize,
    pub approved: usize,
}

/// Один рядок сцени для вкладки «Сцена».
#[derive(Clone, Debug)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub color: String,
    pub rows: usize,
    pub translated: usize,
}

#[derive(Clone, Debug)]
pub struct SceneLine {
    pub row: usize,
    pub speaker: String,
    pub source: String,
    pub target: String,
    pub status: RowStatus,
    pub current: bool,
}

#[derive(Clone, Debug)]
pub struct SceneView {
    pub title: String,
    pub lines: Vec<SceneLine>,
    pub prev: Option<usize>,
    pub next: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    Untranslated,
    Draft,
    Sent,
    Approved,
}

impl Filter {
    pub const ALL: [Filter; 5] = [Filter::All, Filter::Untranslated, Filter::Draft, Filter::Sent, Filter::Approved];
    pub fn label(self) -> &'static str {
        match self {
            Filter::All => "Усі",
            Filter::Untranslated => "Без перекладу",
            Filter::Draft => "Чернетки",
            Filter::Sent => "Надіслано",
            Filter::Approved => "Вичитано",
        }
    }
    fn takes(self, s: RowStatus) -> bool {
        matches!((self, s), (Filter::All, _) | (Filter::Untranslated, RowStatus::Untranslated) | (Filter::Draft, RowStatus::Draft) | (Filter::Sent, RowStatus::Sent) | (Filter::Approved, RowStatus::Approved))
    }
}

/// Рядки поточного файлу після фільтра й пошуку (кеш: перераховується, лише коли щось змінилось).
#[derive(Default)]
struct Visible {
    key: (usize, u8, String, u64),
    rows: Vec<usize>,
    counts: [usize; 5],
}

/// Кеш приміток QA файлу: (файл, rev) і примітки (рядок, текст, помилка?).
type QaCache = ((usize, u64), Vec<(usize, String, bool)>);

pub struct AppState {
    auto_limit: std::cell::RefCell<Option<usize>>,
    /// Показувати лише рядки цієї групи.
    pub group_filter: Option<String>,
    scene_cache: std::cell::RefCell<(usize, Option<transly_core::scene::SceneIndex>)>,
    undo: transly_core::undostack::UndoStack,
    pub host: PluginHost,
    pub sync_state: FilesState,
    sync_rx: Option<std::sync::mpsc::Receiver<Result<FilesReport, String>>>,
    /// Підсумок перенесення перекладів після оновлення гри (порожній, коли гра не змінилась).
    pub last_note: String,
    qa_cache: std::cell::RefCell<QaCache>,
    pub game: Vec<GameFile>,
    pub dirty: bool,
    pub filter: Filter,
    pub search: String,
    /// Збільшується при кожній правці: за ним скидаються кеші.
    pub rev: u64,
    vis: std::cell::RefCell<Visible>,
    prog: std::cell::RefCell<(u64, Vec<(usize, usize)>)>,
    roots: Roots,
    picked: Picked,
    pub project: Option<SavedProject>,
    pub views: Vec<FileView>,
    pub dir: Option<PathBuf>,
    pub file: Option<usize>,
    pub row: Option<usize>,
}

impl Default for AppState {
    fn default() -> Self {
        let file = std::env::temp_dir().join("transly-picked-folders.json");
        AppState { auto_limit: std::cell::RefCell::new(None), group_filter: None, scene_cache: std::cell::RefCell::new((usize::MAX, None)), undo: Default::default(), host: PluginHost::open(plugins_dir()), sync_state: FilesState::default(), sync_rx: None, last_note: String::new(), qa_cache: std::cell::RefCell::new(((usize::MAX, 0), vec![])), game: vec![], dirty: false, filter: Filter::All, search: String::new(), rev: 0, vis: Default::default(), prog: std::cell::RefCell::new((u64::MAX, vec![])), roots: Roots::default(), picked: Picked::open(file), project: None, views: vec![], dir: None, file: None, row: None }
    }
}

/// Де лежить проєкт: поруч із текою гри (не всередині неї).
fn project_path(dir: &Path, name: &str) -> PathBuf {
    dir.parent().unwrap_or(dir).join(format!("{name}.transly.json"))
}

/// Тека установлених плагінів у теці даних користувача.
fn plugins_dir() -> Option<PathBuf> {
    if cfg!(test) {
        return None;
    }
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("XDG_DATA_HOME")).map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))?;
    Some(base.join("Transly").join("plugins"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

impl AppState {
    pub fn is_open(&self) -> bool {
        self.project.is_some()
    }

    /// Відкриває папку гри: читає її файли й будує рядки. Повертає число файлів із текстом.
    /// Читає теку гри: файли й рядки (вбудовані формати — ядро, решта — обробники плагінів).
    fn load_dir(&self, dir: &Path) -> Result<(Vec<GameFile>, Vec<FileView>), String> {
        register_picked(&self.roots, &self.picked, dir);
        let d = dir.to_string_lossy().to_string();
        let exts: Vec<String> = self.host.reg.extensions();
        let listed = list_json(&self.roots, &d, Some(exts))?;
        let mut files = Vec::new();
        for f in listed {
            let text = read_text(&self.roots, &f.path)?;
            if f.name.to_lowercase().ends_with(".json") {
                files.push(GameFile { name: f.name, json: serde_json::from_str(&text).unwrap_or(serde_json::Value::Null), text: None });
            } else {
                files.push(GameFile { name: f.name, json: serde_json::Value::Null, text: Some(text) });
            }
        }
        // вбудовані формати читає ядро; файли, які бере лише формат плагіна, — його обробник
        let builtin: Vec<GameFile> = files.iter().filter(|f| transly_core::engine::format_of(&f.name).is_some()).cloned().collect();
        let mut views = read_game(&builtin, &ExtractOptions::default());
        for f in files.iter().filter(|f| transly_core::engine::format_of(&f.name).is_none()) {
            if let Some(h) = self.host.reg.handler_of(&f.name) {
                let units = h.extract(f, &ExtractOptions::default());
                if !units.is_empty() {
                    views.push(FileView { name: f.name.clone(), units, label: None });
                }
            }
        }
        Ok((files, views))
    }

    pub fn open_game(&mut self, dir: &Path) -> Result<usize, String> {
        let d = dir.to_string_lossy().to_string();
        let (files, views) = self.load_dir(dir)?;
        let name = name_from_folder(&d);
        let name = if name.is_empty() { "Новий проєкт".to_string() } else { name };
        // проєкт, збережений раніше, підхоплюється; рядки, чий оригінал змінився, повертаються в чернетки
        let path = project_path(dir, &name);
        let mut unreadable = String::new();
        let mut project = match std::fs::read_to_string(&path) {
            Ok(t) => match deserialize(&t, Some(now_ms())) {
                Ok(p) => p,
                Err(e) => {
                    // нечитний файл ніколи не перезаписується мовчки: копія лишається поруч, а проєкт починається порожнім
                    let keep = path.with_extension(format!("unreadable-{}.json", now_ms()));
                    unreadable = match std::fs::copy(&path, &keep) {
                        Ok(_) => format!("Збережений проєкт не вдалося прочитати ({e}). Його копію збережено: {}", keep.display()),
                        Err(c) => return Err(format!("Збережений проєкт не вдалося прочитати ({e}), а копію зробити не вдалося ({c}). Нічого не змінено")),
                    };
                    empty_project(&name, "en", "uk")
                }
            },
            Err(_) => empty_project(&name, "en", "uk"),
        };
        for v in &views {
            if let Some(entries) = project.files.get_mut(&v.name) {
                reconcile(&v.units, entries, now_ms());
            }
        }
        // гра могла оновитися: переклади зіставляються з новими рядками за текстом оригіналу (ключі зсуваються)
        self.last_note = unreadable;
        *self.scene_cache.borrow_mut() = (usize::MAX, None);
        *self.auto_limit.borrow_mut() = None;
        let old_snap: Option<indexmap::IndexMap<String, Vec<Unit>>> = project.snapshot.as_ref().and_then(|v| serde_json::from_value(v.clone()).ok());
        if old_snap.is_some() {
            let plan = plan_ingest(old_snap.as_ref(), &views, &project.files, now_ms());
            if !plan.changes.is_empty() {
                let mut seed = 1u32;
                let mut rand = move || {
                    seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                    seed >> 8
                };
                commit_rows(&mut project.files, &plan.changes, "rekey", "Ви", now_ms(), None, &mut rand);
            }
            if !ingest_quiet(&plan.report) {
                self.last_note = ingest_note(&plan.report);
            }
        }
        let snap: indexmap::IndexMap<String, Vec<Unit>> = views.iter().map(|v| (v.name.clone(), v.units.clone())).collect();
        project.snapshot = serde_json::to_value(&snap).ok();
        let n = views.len();
        self.game = files;
        self.views = views;
        self.project = Some(project);
        self.dir = Some(dir.to_path_buf());
        self.file = if n > 0 { Some(0) } else { None };
        self.row = None;
        self.dirty = false;
        self.rev += 1;
        Ok(n)
    }

    pub fn file_names(&self) -> Vec<String> {
        self.views.iter().map(|v| v.name.clone()).collect()
    }

    pub fn row_count(&self, f: usize) -> usize {
        self.views.get(f).map_or(0, |v| v.units.len())
    }

    fn entry(&self, f: usize, r: usize) -> Option<&Entry> {
        let v = self.views.get(f)?;
        self.project.as_ref()?.files.get(&v.name)?.get(&v.units.get(r)?.key)
    }

    pub fn source_of(&self, f: usize, r: usize) -> String {
        self.views.get(f).and_then(|v| v.units.get(r)).map_or(String::new(), |u| u.source.clone())
    }

    pub fn target_of(&self, f: usize, r: usize) -> String {
        self.entry(f, r).map_or(String::new(), |e| e.target.clone())
    }

    pub fn row_view(&self, f: usize, r: usize) -> (String, String, RowStatus) {
        let st = match row_state(self.entry(f, r)) {
            RowState::Untranslated => RowStatus::Untranslated,
            RowState::Draft => RowStatus::Draft,
            RowState::Sent => RowStatus::Sent,
            RowState::Approved => RowStatus::Approved,
        };
        (self.source_of(f, r), self.target_of(f, r), st)
    }

    fn unit(&self, f: usize, r: usize) -> Option<&Unit> {
        self.views.get(f)?.units.get(r)
    }

    fn put(&mut self, f: usize, key_file: String, key: String, e: Entry) {
        let _ = f;
        if let Some(p) = self.project.as_mut() {
            p.files.entry(key_file).or_default().insert(key, e);
        }
        self.rev += 1;
        self.dirty = true;
        self.dirty = true;
    }

    /// Правка перекладу рядка (чернетка).
    pub fn edit(&mut self, f: usize, r: usize, text: &str) {
        let Some(u) = self.unit(f, r).cloned() else { return };
        let name = self.views[f].name.clone();
        if self.entry(f, r).map_or(text.is_empty(), |e| e.target == text) {
            return;
        }
        let now = now_ms();
        let next = edit(self.entry(f, r), &u, text, Stage::Translate, now);
        let next = record_change(self.entry(f, r), &next, "правка", text, &self.who(), now, None);
        self.put(f, name, u.key, next);
    }

    /// Надсилає рядок на вичитку (з перевіркою QA за правилами ядра).
    pub fn submit(&mut self, f: usize, r: usize, text: &str) -> Result<(), String> {
        self.edit(f, r, text);
        let Some(u) = self.unit(f, r).cloned() else { return Err("Немає рядка".into()) };
        let name = self.views[f].name.clone();
        let block = self.settings_view().is_none_or(|v| v.block_errors);
        let opts = SubmitOptions { qa: self.qa_options(), block_errors: block };
        match submit(self.entry(f, r), &u, Stage::Translate, now_ms(), &opts) {
            SubmitResult::Ok(e) => {
                let e = record_change(self.entry(f, r), &e, "надіслано", &e.target.clone(), &self.who(), now_ms(), None);
                self.put(f, name, u.key, e);
                Ok(())
            }
            SubmitResult::Err(m) => Err(m),
        }
    }

    fn status_of(&self, f: usize, r: usize) -> RowStatus {
        self.row_view(f, r).2
    }

    fn refresh_visible(&self, f: usize) {
        let key = (f, Filter::ALL.iter().position(|x| *x == self.filter).unwrap_or(0) as u8, format!("{}\u{1}{}", self.search, self.group_filter.clone().unwrap_or_default()), self.rev);
        if self.vis.borrow().key == key {
            return;
        }
        let q = self.search.to_lowercase();
        let mut v = Visible { key, ..Default::default() };
        let in_group: Option<std::collections::HashSet<String>> = self.group_filter.as_ref().and_then(|id| {
            let p = self.project.as_ref()?;
            let data = transly_core::groups::GroupData::of(p);
            let name = &self.views.get(f)?.name;
            Some(transly_core::groups::rows_of_group(&data, &self.views, id).into_iter().filter(|r| &r.file == name).map(|r| r.key).collect())
        });
        for r in 0..self.row_count(f) {
            let st = self.status_of(f, r);
            if let Some(set) = &in_group {
                if !self.unit(f, r).is_some_and(|u| set.contains(&u.key)) {
                    continue;
                }
            }
            if !q.is_empty() {
                let (src, tgt, _) = self.row_view(f, r);
                let k = self.unit(f, r).map_or("", |u| u.key.as_str());
                if !(src.to_lowercase().contains(&q) || tgt.to_lowercase().contains(&q) || k.to_lowercase().contains(&q)) {
                    continue;
                }
            }
            v.counts[0] += 1;
            v.counts[match st {
                RowStatus::Untranslated => 1,
                RowStatus::Draft => 2,
                RowStatus::Sent => 3,
                RowStatus::Approved => 4,
            }] += 1;
            if self.filter.takes(st) {
                v.rows.push(r);
            }
        }
        *self.vis.borrow_mut() = v;
    }

    pub fn visible_len(&self, f: usize) -> usize {
        self.refresh_visible(f);
        self.vis.borrow().rows.len()
    }

    pub fn visible_at(&self, f: usize, i: usize) -> Option<usize> {
        self.refresh_visible(f);
        self.vis.borrow().rows.get(i).copied()
    }

    /// Скільки рядків файлу в кожному фільтрі (за порядком `Filter::ALL`; пошук враховується).
    pub fn filter_counts(&self, f: usize) -> [usize; 5] {
        self.refresh_visible(f);
        self.vis.borrow().counts
    }

    /// (усього, перекладено) для кожного файлу; кеш за `rev`.
    pub fn file_progress(&self) -> Vec<(usize, usize)> {
        if self.prog.borrow().0 != self.rev {
            let v = (0..self.views.len()).map(|f| (self.row_count(f), (0..self.row_count(f)).filter(|r| self.status_of(f, *r) != RowStatus::Untranslated).count())).collect();
            *self.prog.borrow_mut() = (self.rev, v);
        }
        self.prog.borrow().1.clone()
    }

    /// Терміни глосарія проєкту.
    pub fn terms(&self) -> Vec<Term> {
        self.project.as_ref().map(|p| p.terms.iter().filter_map(|t| serde_json::from_value(t.clone()).ok()).collect()).unwrap_or_default()
    }

    /// Додає чи змінює термін. Повертає повідомлення для рядка стану.
    pub fn add_term(&mut self, en: &str, uk: &str) -> String {
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        let form = TermForm { en: en.into(), uk: uk.into(), ..Default::default() };
        let res = save_term(p, &form, now_ms(), None);
        self.rev += 1;
        self.dirty = true;
        match res {
            Some(SaveResult::Added) => "Термін додано".into(),
            Some(SaveResult::Changed) => "Термін змінено".into(),
            Some(SaveResult::Exists) => "Такий термін уже є".into(),
            None => "Потрібні обидва слова".into(),
        }
    }

    /// Терміни глосарія в оригіналі рядка: (початок, кінець у UTF-16, номер терміна).
    pub fn source_marks(&self, f: usize, r: usize) -> Vec<(usize, usize, usize)> {
        let p = prepare_text(&self.source_of(f, r));
        let mut out = Vec::new();
        for (i, t) in self.terms().iter().enumerate() {
            for (a, b) in term_ranges_in(&p, &t.en) {
                out.push((a, b, i));
            }
        }
        out.sort();
        out
    }

    /// Примітки QA до тексту рядка за правилами ядра.
    pub fn issues(&self, f: usize, r: usize, text: &str) -> Vec<Issue> {
        let Some(u) = self.unit(f, r) else { return vec![] };
        let mut v = check(&UnitLike::from(u), text, &self.qa_options());
        if !text.is_empty() {
            v.extend(self.host.qa_issues(UnitLike::from(u).kind.as_deref(), &u.source, text));
        }
        v
    }

    /// Збіги з пам'яті перекладів для оригіналу рядка (пари береться з уже перекладених рядків проєкту).
    pub fn tm_matches(&self, f: usize, r: usize) -> Vec<TmMatch> {
        let mut idx = TmIndex::new(false);
        let me = self.unit(f, r).map(|u| u.key.clone());
        for (fi, v) in self.views.iter().enumerate() {
            let Some(ents) = self.project.as_ref().and_then(|p| p.files.get(&v.name)) else { continue };
            for u in &v.units {
                if fi == f && Some(&u.key) == me.as_ref() {
                    continue;
                }
                if let Some(e) = ents.get(&u.key).filter(|e| !e.target.is_empty()) {
                    idx.add(TmEntry { s: u.source.clone(), t: e.target.clone(), src: v.name.clone() });
                }
            }
        }
        for m in self.project.as_ref().map(|p| p.memory.as_slice()).unwrap_or_default() {
            if let (Some(sv), Some(tv)) = (m.get("s").and_then(|v| v.as_str()), m.get("t").and_then(|v| v.as_str())) {
                idx.add(TmEntry { s: sv.into(), t: tv.into(), src: "Імпорт".into() });
            }
        }
        idx.find(&self.source_of(f, r), &FindOpts { min: Some(60.0), limit: Some(6), exclude: None })
    }

    /// Історія правок рядка, нові першими.
    pub fn history(&self, f: usize, r: usize) -> Vec<HistoryRow> {
        let e = self.entry(f, r);
        history_rows(e.and_then(|e| e.history.as_deref()).unwrap_or(&[]), e.map_or("", |e| e.target.as_str()))
    }

    pub fn threads(&self, f: usize, r: usize) -> Vec<Thread> {
        threads_of(self.entry(f, r).and_then(|e| e.comments.as_deref()))
    }

    pub fn comment(&mut self, f: usize, r: usize, text: &str) {
        let Some(u) = self.unit(f, r).cloned() else { return };
        let name = self.views[f].name.clone();
        let next = add_comment(self.entry(f, r), &self.who(), text, now_ms(), None);
        self.put(f, name, u.key, next);
    }

    /// Примітки QA по всіх перекладених рядках файлу: (рядок, текст, помилка?). Кеш за `rev`.
    pub fn file_issues(&self, f: usize) -> Vec<(usize, String, bool)> {
        let key = (f, self.rev);
        if self.qa_cache.borrow().0 != key {
            let mut out = Vec::new();
            let qa = self.qa_options();
            for r in 0..self.row_count(f) {
                let Some(e) = self.entry(f, r).filter(|e| !e.target.is_empty()) else { continue };
                let Some(u) = self.unit(f, r) else { continue };
                let mut all = check(&UnitLike::from(u), &e.target, &qa);
                all.extend(self.host.qa_issues(UnitLike::from(u).kind.as_deref(), &u.source, &e.target));
                for i in all {
                    out.push((r, i.message, i.severity == transly_core::qa::Severity::Bad));
                }
            }
            *self.qa_cache.borrow_mut() = (key, out);
        }
        self.qa_cache.borrow().1.clone()
    }

    /// Скільки рядків файлу мають термін в оригіналі: для таблиці глосарія.
    pub fn term_uses(&self, f: usize) -> Vec<usize> {
        let terms = self.terms();
        let mut n = vec![0usize; terms.len()];
        for r in 0..self.row_count(f) {
            let p = prepare_text(&self.source_of(f, r));
            for (i, t) in terms.iter().enumerate() {
                if !term_ranges_in(&p, &t.en).is_empty() {
                    n[i] += 1;
                }
            }
        }
        n
    }

    /// Налаштування QA проєкту: допуск довжини й межа рядка.
    pub fn qa_options(&self) -> transly_core::qa::QaOptions {
        let mut qa = default_qa();
        qa.terms = self.terms();
        if let Some(p) = &self.project {
            if let Some(t) = p.settings.get("tolerancePct").and_then(|v| v.as_f64()) {
                qa.tolerance_pct = t;
            }
            let raw = p.settings.get("lineLimit").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let limit = if raw < 0.0 {
                0.0
            } else if raw > 0.0 {
                raw
            } else {
                let mut c = self.auto_limit.borrow_mut();
                *c.get_or_insert_with(|| transly_core::wrap::auto_line_limit(&self.views)) as f64
            };
            qa.line_limit = Some(limit).filter(|l| *l > 0.0);
            qa.wrap = Some(transly_core::wrap::WrapPlan { settings: transly_core::wrapconfig::wrap_of(p.settings.get("wrap")), limit, disabled: raw < 0.0, measure: None });
            qa.rules = Some(transly_core::qaconfig::qa_of(p.settings.get("qa")));
        }
        qa
    }

    /// Ім'я перекладача для записів історії.
    pub fn who(&self) -> String {
        self.project.as_ref().and_then(|p| p.settings.get("who")).and_then(|v| v.as_str()).filter(|w| !w.is_empty()).unwrap_or("Ви").to_string()
    }

    /// Налаштування, які показує вікно.
    pub fn settings_view(&self) -> Option<SettingsView> {
        let p = self.project.as_ref()?;
        let get = |k: &str| p.settings.get(k);
        Some(SettingsView {
            name: p.name.clone(),
            source_lang: p.source_lang.clone(),
            target_lang: p.target_lang.clone(),
            who: self.who(),
            tolerance_pct: get("tolerancePct").and_then(|v| v.as_f64()).unwrap_or(25.0),
            block_errors: get("blockErrors").and_then(|v| v.as_bool()).unwrap_or(true),
            propagate: get("propagate").and_then(|v| v.as_bool()).unwrap_or(true),
            line_limit: get("lineLimit").and_then(|v| v.as_f64()).unwrap_or(0.0),
        })
    }

    pub fn apply_settings(&mut self, v: &SettingsView) {
        let Some(p) = self.project.as_mut() else { return };
        p.name = v.name.clone();
        p.source_lang = v.source_lang.clone();
        p.target_lang = v.target_lang.clone();
        p.settings.insert("who".into(), serde_json::json!(v.who));
        p.settings.insert("tolerancePct".into(), serde_json::json!(v.tolerance_pct));
        p.settings.insert("blockErrors".into(), serde_json::json!(v.block_errors));
        p.settings.insert("propagate".into(), serde_json::json!(v.propagate));
        p.settings.insert("lineLimit".into(), serde_json::json!(v.line_limit));
        p.settings_at = Some(now_ms());
        self.rev += 1;
        self.dirty = true;
    }

    /// Зливає проєкт із файлу в поточний (новіша правка кожного рядка виграє). Повертає підсумок.
    pub fn merge_file(&mut self, path: &Path) -> Result<String, String> {
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let other = deserialize(&text, Some(now_ms()))?;
        let cur = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let m = transly_core::project::merge_projects(cur, &other, 0);
        let msg = format!("Злито: конфліктів {}{}", m.conflicts.len(), if m.dropped_by_reset > 0 { format!(", відкинуто скиданням {}", m.dropped_by_reset) } else { String::new() });
        self.project = Some(m.project);
        self.rev += 1;
        self.dirty = true;
        Ok(msg)
    }

    /// Налаштування синхронізації з GitHub, збережені в проєкті (токен не зберігається ніде).
    pub fn github_settings(&self) -> GithubSettings {
        let get = |k: &str| self.project.as_ref().and_then(|p| p.settings.get(k)).and_then(|v| v.as_str()).unwrap_or("").to_string();
        GithubSettings { repo: get("githubRepo"), branch: get("githubBranch"), dir: get("githubDir"), originals: self.project.as_ref().and_then(|p| p.settings.get("githubOriginals")).and_then(|v| v.as_bool()).unwrap_or(false) }
    }

    pub fn set_github_settings(&mut self, g: &GithubSettings) {
        if let Some(p) = self.project.as_mut() {
            p.settings.insert("githubRepo".into(), serde_json::json!(g.repo));
            p.settings.insert("githubBranch".into(), serde_json::json!(g.branch));
            p.settings.insert("githubDir".into(), serde_json::json!(g.dir));
            p.settings.insert("githubOriginals".into(), serde_json::json!(g.originals));
            self.dirty = true;
        }
    }

    /// Починає синхронізацію в окремому потоці (мережа не блокує вікно). Результат забирає `finish_sync`.
    pub fn start_sync(&mut self, token: String) -> Result<(), String> {
        if self.sync_rx.is_some() {
            return Err("Синхронізація вже триває".into());
        }
        let project = self.project.clone().ok_or("Проєкт не відкрито")?;
        let cfg = self.github_settings();
        if cfg.repo.trim().is_empty() {
            return Err("Вкажіть репозиторій у налаштуваннях синхронізації".into());
        }
        if token.trim().is_empty() {
            return Err("Вкажіть токен GitHub".into());
        }
        let state = self.sync_state.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut api = HttpApi::new(token.trim());
            let _ = tx.send(github_sync(&mut api, &cfg, &state, &project, 0, now_ms()));
        });
        self.sync_rx = Some(rx);
        Ok(())
    }

    pub fn syncing(&self) -> bool {
        self.sync_rx.is_some()
    }

    /// Забирає результат синхронізації, коли він готовий: зливає з проєктом, яким він став за час запиту.
    pub fn finish_sync(&mut self) -> Option<String> {
        let res = self.sync_rx.as_ref()?.try_recv().ok()?;
        self.sync_rx = None;
        Some(match res {
            Err(e) => e,
            Ok(rep) => self.adopt(rep),
        })
    }

    fn adopt(&mut self, rep: FilesReport) -> String {
        let msg = format!("Синхронізовано: отримано файлів {}, надіслано {}, конфліктів {}", rep.pulled, rep.pushed, rep.conflicts);
        if let Some(live) = &self.project {
            // за час запиту перекладач міг друкувати: результат зливається з поточним проєктом, а не замінює його
            self.project = Some(transly_core::session::adopt_synced(live, &rep.project, false));
        }
        self.sync_state = rep.state;
        self.rev += 1;
        self.dirty = true;
        msg
    }

    /// Застосовує команду плагіна «замінити»: показує, скільки рядків зміниться, і записує однією дією журналу.
    pub fn run_replace(&mut self, steps: &[transly_core::commands::ReplaceStep], apply: bool) -> Result<usize, String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let found = transly_core::commands::plan_steps(&self.views, p, steps, 100_000);
        if !apply || found.is_empty() {
            return Ok(found.len());
        }
        let changes: Vec<transly_core::journal::RowChange> = found
            .iter()
            .filter_map(|m| {
                let cur = p.files.get(&m.file)?.get(&m.key)?;
                Some(transly_core::journal::RowChange { file: m.file.clone(), key: m.key.clone(), next: Entry { target: m.after.clone(), mt: now_ms(), ..cur.clone() }, text: m.after.clone(), what: None })
            })
            .collect();
        let who = self.who();
        let mut seed = 7u32;
        let mut rand = move || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            seed >> 8
        };
        let n = changes.len();
        let p = self.project.as_mut().ok_or("Проєкт не відкрито")?;
        let id = commit_rows(&mut p.files, &changes, "replace", &who, now_ms(), None, &mut rand);
        self.undo.record(&id);
        self.rev += 1;
        self.dirty = true;
        Ok(n)
    }

    /// Додає терміни глосарія плагіна до проєкту.
    pub fn import_plugin_glossary(&mut self, plugin: &str, gid: &str) -> String {
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        match self.host.import_glossary(p, plugin, gid, now_ms()) {
            Ok((added, differ)) => {
                self.rev += 1;
                self.dirty = true;
                format!("Додано термінів: {added}{}", if differ > 0 { format!(" (ще {differ} відрізняються від ваших і лишені як є)") } else { String::new() })
            }
            Err(e) => e,
        }
    }

    fn seeded_rand() -> impl FnMut() -> u32 {
        let mut seed = (now_ms() as u32) | 1;
        move || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            seed >> 8
        }
    }

    /// Надсилає всі чернетки (файлу `only` чи всього проєкту) однією дією журналу; рядки з помилкою QA лишаються.
    pub fn bulk_send(&mut self, only: Option<usize>) -> String {
        self.bulk(only, false)
    }

    /// Затверджує всі надіслані рядки (вичитка) однією дією журналу.
    pub fn bulk_approve(&mut self, only: Option<usize>) -> String {
        self.bulk(only, true)
    }

    fn bulk(&mut self, only: Option<usize>, approve: bool) -> String {
        let Some(p) = self.project.as_ref() else { return "Проєкт не відкрито".into() };
        let opts = SubmitOptions { qa: self.qa_options(), block_errors: self.settings_view().is_none_or(|v| v.block_errors) };
        let now = now_ms();
        let (mut changes, mut blocked) = (Vec::new(), 0usize);
        for (fi, v) in self.views.iter().enumerate() {
            if only.is_some_and(|o| o != fi) {
                continue;
            }
            let Some(ents) = p.files.get(&v.name) else { continue };
            for u in &v.units {
                let Some(e) = ents.get(&u.key) else { continue };
                let st = row_state(Some(e));
                if (approve && st != RowState::Sent) || (!approve && st != RowState::Draft) {
                    continue;
                }
                let res = if approve { transly_core::workflow::approve_entry(Some(e), u, now, &opts) } else { submit(Some(e), u, Stage::Translate, now, &opts) };
                match res {
                    SubmitResult::Ok(next) => changes.push(transly_core::journal::RowChange { file: v.name.clone(), key: u.key.clone(), text: next.target.clone(), next, what: None }),
                    SubmitResult::Err(_) => blocked += 1,
                }
            }
        }
        if changes.is_empty() {
            return if blocked > 0 { format!("Нічого не {}: {blocked} з помилками QA", if approve { "вичитано" } else { "надіслано" }) } else { "Немає рядків для цієї дії".into() };
        }
        let n = changes.len();
        let who = self.who();
        let p = self.project.as_mut().expect("проєкт відкрито");
        let id = commit_rows(&mut p.files, &changes, if approve { "approve" } else { "send" }, &who, now, None, &mut Self::seeded_rand());
        self.undo.record(&id);
        self.rev += 1;
        self.dirty = true;
        format!("{}: {n}{}", if approve { "Вичитано" } else { "Надіслано" }, if blocked > 0 { format!(", з помилками QA лишилось {blocked}") } else { String::new() })
    }

    /// Скасовує найновішу масову дію цього сеансу (далі — попередні; після перезапуску лінія береться з журналу).
    pub fn undo_last(&mut self) -> String {
        let who = self.who();
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        if !self.undo.used {
            let ids: Vec<String> = transly_core::journal::journal_batches(&self.views, &p.files, 50).into_iter().map(|b| b.id).collect();
            self.undo.seed(&ids);
        }
        let Some(id) = self.undo.take_undo() else { return "Немає дій для скасування".into() };
        let r = transly_core::journal::undo_journal(&mut p.files, &id, &who, now_ms(), &mut Self::seeded_rand());
        self.undo.undone(&id, &r.batch);
        self.rev += 1;
        self.dirty = true;
        transly_core::journal::undo_report(&r)
    }

    /// Повторює скасоване.
    pub fn redo_last(&mut self) -> String {
        let who = self.who();
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        let Some(id) = self.undo.take_redo() else { return "Немає що повторювати".into() };
        let r = transly_core::journal::undo_journal(&mut p.files, &id, &who, now_ms(), &mut Self::seeded_rand());
        self.undo.redone(&id, &r.batch);
        self.rev += 1;
        self.dirty = true;
        transly_core::journal::undo_report(&r)
    }

    /// Пропозиції автозаповнення: неперекладені короткі рядки, чиї слова вже відомі з перекладених (і з глосарія).
    pub fn autofill_proposals(&self, limit: usize) -> Vec<transly_core::autofill::Proposal> {
        let Some(p) = self.project.as_ref() else { return vec![] };
        // вчаться й на чернетках: пропозиції все одно переглядає сам перекладач
        let opts = transly_core::autofill::FillOpts { drafts: true };
        let dict = transly_core::autofill::learn_words(&self.views, p, opts);
        transly_core::autofill::proposals(&self.views, p, Some(&dict), limit, opts)
    }

    /// Записує обрані пропозиції чернетками однією дією журналу.
    pub fn apply_autofill(&mut self, picked: &[transly_core::autofill::Proposal]) -> String {
        let now = now_ms();
        let mut changes = Vec::new();
        {
            let Some(p) = self.project.as_ref() else { return "Проєкт не відкрито".into() };
            for pr in picked {
                let Some(v) = self.views.iter().find(|v| v.name == pr.file) else { continue };
                let Some(u) = v.units.iter().find(|u| u.key == pr.key) else { continue };
                let prev = p.files.get(&pr.file).and_then(|m| m.get(&pr.key));
                // чужого перекладу не перезаписуємо
                if prev.is_some_and(|e| !e.target.trim().is_empty()) {
                    continue;
                }
                let next = edit(prev, u, &pr.target, Stage::Translate, now);
                changes.push(transly_core::journal::RowChange { file: pr.file.clone(), key: pr.key.clone(), text: pr.target.clone(), next, what: None });
            }
        }
        if changes.is_empty() {
            return "Нічого не записано".into();
        }
        let n = changes.len();
        let who = self.who();
        let p = self.project.as_mut().expect("проєкт відкрито");
        let id = commit_rows(&mut p.files, &changes, "autofill", &who, now, None, &mut Self::seeded_rand());
        self.undo.record(&id);
        self.rev += 1;
        self.dirty = true;
        format!("Автозаповнено рядків: {n} (чернетки)")
    }

    /// Переходить на `delta` рядків у списку, що проходить фільтр і пошук (межі не перескакує). Повертає, чи рядок змінився.
    pub fn step_row(&mut self, delta: isize) -> bool {
        let Some(f) = self.file else { return false };
        let n = self.visible_len(f);
        if n == 0 {
            return false;
        }
        let cur = self.row.and_then(|r| (0..n).find(|i| self.visible_at(f, *i) == Some(r)));
        let next = match cur {
            Some(i) => (i as isize + delta).clamp(0, n as isize - 1) as usize,
            None => if delta >= 0 { 0 } else { n - 1 },
        };
        let target = self.visible_at(f, next);
        let changed = target != self.row;
        self.row = target;
        changed
    }

    /// Імпорт пам'яті перекладів: рядки «оригінал, табуляція, переклад».
    pub fn import_memory(&mut self, text: &str) -> String {
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        let (mut added, mut rejected) = (0usize, 0usize);
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut it = line.split('\t');
            let (sv, tv) = (it.next().unwrap_or("").trim(), it.next().unwrap_or("").trim());
            if sv.is_empty() || tv.is_empty() {
                rejected += 1;
                continue;
            }
            let have = p.memory.iter().any(|m| m.get("s").and_then(|v| v.as_str()) == Some(sv) && m.get("t").and_then(|v| v.as_str()) == Some(tv));
            if !have {
                p.memory.push(serde_json::json!({ "s": sv, "t": tv, "mt": now_ms() }));
                added += 1;
            }
        }
        self.rev += 1;
        self.dirty = true;
        format!("Імпортовано пар: {added}{}", if rejected > 0 { format!(", пропущено рядків без табуляції: {rejected}") } else { String::new() })
    }

    /// Імпорт глосарія з таблиці (CSV/TSV чи HTML): нові терміни додаються, наявні з іншим перекладом не змінюються.
    pub fn import_terms_table(&mut self, text: &str) -> String {
        let rows = if text.trim_start().starts_with('<') { transly_core::termtable::parse_html_table(text) } else { transly_core::termtable::parse_delimited(text) };
        let table = transly_core::termtable::terms_from_table(&rows, now_ms(), false);
        if table.terms.is_empty() {
            return "У таблиці не знайдено термінів: потрібна колонка «Оригінал» і хоча б одна «Переклад»".into();
        }
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        let brought: Vec<transly_core::glossaries::BroughtTerm> = table.terms.iter().map(|t| transly_core::glossaries::BroughtTerm { en: t.en.clone(), uk: t.uk.clone(), alt: t.alt.clone(), note: t.note.clone() }).collect();
        let plan = transly_core::glossaries::plan_glossary_import(&p.terms, &brought);
        let added = transly_core::glossaries::apply_glossary_import(p, &plan, now_ms());
        self.rev += 1;
        self.dirty = true;
        format!("Додано термінів: {added}, уже є: {}, з іншим перекладом (не змінено): {}, пропущено рядків: {}", plan.same.len(), plan.differ.len(), table.skipped)
    }

    /// Сцена вибраного рядка: назва, рядки в порядку гри (з перекладами) і перші рядки сусідніх сцен.
    pub fn scene_view(&self, f: usize, r: usize) -> Option<SceneView> {
        let v = self.views.get(f)?;
        let key = self.unit(f, r)?.key.clone();
        if self.scene_cache.borrow().0 != f {
            *self.scene_cache.borrow_mut() = (f, transly_core::scene::build_scene_index(&v.units));
        }
        let cache = self.scene_cache.borrow();
        let idx = cache.1.as_ref()?;
        let sc = transly_core::scene::scene_at(Some(idx), &key)?;
        let at_key = |u: &Unit| v.units.iter().position(|x| x.key == u.key);
        let lines = sc
            .units
            .iter()
            .filter_map(|u| {
                let ri = at_key(u)?;
                Some(SceneLine { row: ri, speaker: self.speaker_of_row(f, ri), source: u.source.clone(), target: self.target_of(f, ri), status: self.status_of(f, ri), current: ri == r })
            })
            .collect();
        let first_row = |s: Option<&transly_core::scene::SceneInfo>| s.and_then(|s| s.units.first()).and_then(at_key);
        Some(SceneView {
            title: transly_core::scene::scene_title(sc),
            lines,
            prev: first_row(transly_core::scene::step_scene(Some(idx), &key, -1)),
            next: first_row(transly_core::scene::step_scene(Some(idx), &key, 1)),
        })
    }

    /// Програма гри, обрана перекладачем (зберігається в проєкті).
    pub fn game_exe(&self) -> Option<String> {
        self.project.as_ref()?.settings.get("gameExe")?.as_str().filter(|e| !e.is_empty()).map(String::from)
    }

    /// Запам'ятовує програму гри (після вибору в діалозі): дозволяє її теку платформі.
    pub fn set_game_exe(&mut self, exe: &Path) {
        register_picked_exe(&self.roots, &self.picked, exe);
        if let Some(p) = self.project.as_mut() {
            p.settings.insert("gameExe".into(), serde_json::json!(exe.to_string_lossy()));
            self.dirty = true;
        }
    }

    /// Запускає гру з обраного місця: збирає переклад (з чернетками), кладе в гру тестовий плагін старту зі сцени й запускає програму.
    pub fn play_from(&mut self, f: usize, r: usize, from_line: bool) -> Result<String, String> {
        let exe = self.game_exe().ok_or("Спершу оберіть програму гри")?;
        let dir = self.dir.clone().ok_or("Проєкт не відкрито")?;
        let key = self.unit(f, r).map(|u| u.key.clone()).ok_or("Немає рядка")?;
        let file = self.views[f].name.clone();
        let target = transly_core::jump::jump_target(&file, &key, &self.game, from_line, 0).ok_or("З цього рядка гру запустити не можна: він не в сцені")?;
        let built = self.build_with(&self.build_defaults())?;
        apply_jump(&self.roots, &dir.to_string_lossy(), &transly_core::jump::jump_plugin(&target))?;
        launch(&self.roots, &exe)?;
        Ok(format!("Гру запущено зі сцени. {built}"))
    }

    /// Прибирає тестовий плагін зі старту з гри.
    pub fn remove_jump_plugin(&mut self) -> Result<String, String> {
        let dir = self.dir.as_ref().ok_or("Проєкт не відкрито")?;
        let changed = restore_jump(&self.roots, &dir.to_string_lossy())?;
        Ok(if changed { "Тестовий плагін прибрано з гри".into() } else { "Тестового плагіна в грі не було".into() })
    }

    /// Хто говорить у рядку: власне ім'я з гри, потім відображення перекладача (надруковане ім'я, обличчя, позначка, подія).
    pub fn speaker_of_row(&self, f: usize, r: usize) -> String {
        let Some(u) = self.unit(f, r) else { return String::new() };
        let row = transly_core::speakers::SpeakerRow { speaker: &u.speaker, face: u.face.as_deref(), event: u.event.as_deref(), note: u.note.as_deref(), source: Some(&u.source) };
        transly_core::speakers::speaker_of(&row, self.project.as_ref().and_then(|p| p.speakers.as_ref()))
    }

    /// Кандидати в мовці з рядків гри (імена в тексті, обличчя, позначки, події) і вже задане ім'я кожного.
    pub fn speaker_candidates(&self) -> Vec<(transly_core::speakers::SpeakerCandidate, String)> {
        let map = self.project.as_ref().and_then(|p| p.speakers.as_ref());
        transly_core::speakers::speaker_candidates(&self.views, 3)
            .into_iter()
            .map(|c| {
                let name = map.and_then(|m| m.get(&c.key)).and_then(|v| v.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                (c, name)
            })
            .collect()
    }

    /// Записує імена мовців: порожнє ім'я прибирає відображення.
    pub fn set_speakers(&mut self, names: &[(String, String)]) -> String {
        let Some(p) = self.project.as_mut() else { return "Проєкт не відкрито".into() };
        let now = now_ms();
        let map = p.speakers.get_or_insert_with(Default::default);
        let mut changed = 0;
        for (key, name) in names {
            let name = transly_core::js::trim(name);
            let cur = map.get(key).and_then(|v| v.get("name")).and_then(|n| n.as_str()).unwrap_or("");
            if cur == name {
                continue;
            }
            changed += 1;
            if name.is_empty() {
                map.shift_remove(key);
            } else {
                map.insert(key.clone(), serde_json::json!({ "name": name, "mt": now }));
            }
        }
        if changed > 0 {
            self.rev += 1;
            self.dirty = true;
        }
        format!("Імен мовців змінено: {changed}")
    }

    /// Додає довідкову мову: тека тієї самої гри іншою мовою; кожен рядок зіставляється з її рядком за ключем чи вирівнюванням.
    pub fn import_reference(&mut self, dir: &Path, lang: &str) -> Result<String, String> {
        let lang = transly_core::js::trim(lang).to_lowercase();
        if lang.is_empty() {
            return Err("Вкажіть код мови, наприклад ru або pl".into());
        }
        let (_, ref_views) = self.load_dir(dir)?;
        let mut texts: indexmap::IndexMap<String, transly_core::reference::Reference> = indexmap::IndexMap::new();
        let mut n = 0;
        for v in &self.views {
            let Some(rv) = ref_views.iter().find(|r| r.name == v.name) else { continue };
            let r = transly_core::reference::align_reference(&v.units, &rv.units);
            n += r.len();
            texts.insert(v.name.clone(), r);
        }
        if n == 0 {
            return Err("У цій теці не знайдено рядків, що відповідають вашій грі".into());
        }
        let p = self.project.as_mut().ok_or("Проєкт не відкрито")?;
        let cur: Option<transly_core::reference::ReferenceBundle> = p.reference.as_ref().and_then(|v| serde_json::from_value(v.clone()).ok());
        let bundle = transly_core::reference::with_reference(cur.as_ref(), transly_core::reference::ReferenceSet { lang: lang.clone(), texts });
        p.reference = serde_json::to_value(&bundle).ok();
        self.rev += 1;
        self.dirty = true;
        Ok(format!("Довідкова мова «{lang}»: зіставлено рядків {n}"))
    }

    /// Довідкові переклади рядка: (код мови, текст).
    pub fn references_of(&self, f: usize, r: usize) -> Vec<(String, String)> {
        let Some(v) = self.views.get(f) else { return vec![] };
        let Some(u) = v.units.get(r) else { return vec![] };
        let bundle: Option<transly_core::reference::ReferenceBundle> = self.project.as_ref().and_then(|p| p.reference.as_ref()).and_then(|x| serde_json::from_value(x.clone()).ok());
        transly_core::reference::reference_sets(bundle.as_ref()).into_iter().filter_map(|set| set.texts.get(&v.name).and_then(|m| m.get(&u.key)).map(|t| (set.lang.clone(), t.clone()))).collect()
    }

    /// Групи проєкту: (id, назва, колір, рядків, перекладено).
    pub fn groups_view(&self) -> Vec<GroupInfo> {
        let Some(p) = self.project.as_ref() else { return vec![] };
        let data = transly_core::groups::GroupData::of(p);
        let rows = transly_core::groups::group_rows(&data, &self.views);
        transly_core::groups::live_groups(&data)
            .into_iter()
            .map(|g| {
                let rs = rows.get(&g.id).cloned().unwrap_or_default();
                let pr = transly_core::groups::rows_progress(&rs, &p.files);
                GroupInfo { id: g.id, name: g.name, color: g.color.unwrap_or_default(), rows: pr.total, translated: pr.translated }
            })
            .collect()
    }

    fn with_groups<R>(&mut self, f: impl FnOnce(&mut transly_core::groups::GroupData, &[FileView]) -> R) -> Option<R> {
        let p = self.project.as_mut()?;
        let mut data = transly_core::groups::GroupData::of(p);
        let r = f(&mut data, &self.views);
        data.apply(p);
        self.rev += 1;
        self.dirty = true;
        Some(r)
    }

    fn rand_suffix() -> String {
        let mut r = Self::seeded_rand();
        (0..4).map(|_| char::from_digit(r() % 36, 36).unwrap_or('0')).collect()
    }

    pub fn create_group(&mut self, name: &str) -> String {
        let suffix = Self::rand_suffix();
        let now = now_ms();
        match self.with_groups(|d, _| transly_core::groups::create_group(d, name, now, None, &suffix)).flatten() {
            Some(g) => format!("Група «{}»", g.name),
            None => "Назва групи порожня".into(),
        }
    }

    pub fn delete_group(&mut self, id: &str) {
        let now = now_ms();
        if self.group_filter.as_deref() == Some(id) {
            self.group_filter = None;
        }
        self.with_groups(|d, _| transly_core::groups::delete_group(d, id, now));
    }

    /// Кладе рядок (`scope` 0), його сцену (1) чи його файл (2) у групу (None — поза групами). Повертає, скільки рядків змінилося.
    pub fn place_in_group(&mut self, f: usize, r: usize, scope: u8, id: Option<&str>) -> usize {
        let (Some(file), Some(key)) = (self.views.get(f).map(|v| v.name.clone()), self.unit(f, r).map(|u| u.key.clone())) else { return 0 };
        let now = now_ms();
        let rows: Vec<transly_core::groups::RowRef> = match scope {
            0 => vec![transly_core::groups::RowRef { file: file.clone(), key }],
            1 => self.scene_view(f, r).map(|sv| sv.lines.iter().filter_map(|l| self.unit(f, l.row).map(|u| transly_core::groups::RowRef { file: file.clone(), key: u.key.clone() })).collect()).unwrap_or_default(),
            _ => vec![],
        };
        let before = self.groups_view().iter().map(|g| g.rows).sum::<usize>();
        let n = self.with_groups(|d, views| {
            if scope == 2 {
                transly_core::groups::place_file(d, &file, id, now);
                0
            } else {
                transly_core::groups::place_rows(d, views, &rows, id, now)
            }
        });
        let after = self.groups_view().iter().map(|g| g.rows).sum::<usize>();
        let _ = before;
        n.filter(|n| *n > 0).unwrap_or_else(|| after.abs_diff(before))
    }

    /// Автоматичні групи: за мовцями (`by_speaker`) чи за сценами. Створює групи з рядками й повертає їх кількість.
    pub fn auto_groups(&mut self, by_speaker: bool) -> usize {
        let now = now_ms();
        let speakers = self.project.as_ref().and_then(|p| p.speakers.clone());
        let auto = if by_speaker { transly_core::groups::group_by_speaker(&self.views, speakers.as_ref()) } else { transly_core::groups::group_by_scene(&self.views) };
        let suffixes: Vec<String> = (0..auto.len()).map(|_| Self::rand_suffix()).collect();
        let n = auto.len().min(200);
        self.with_groups(|d, views| {
            for (a, sfx) in auto.iter().zip(&suffixes).take(200) {
                let name = match &a.sub {
                    Some(sub) => format!("{sub}: {}", a.name),
                    None => a.name.clone(),
                };
                if let Some(g) = transly_core::groups::create_group(d, &name, now, None, sfx) {
                    transly_core::groups::place_rows(d, views, &a.rows, Some(&g.id), now);
                }
            }
        });
        n
    }

    /// Гілки перекладу: (назва, рядків, поточна).
    pub fn branches_view(&self) -> Vec<(String, usize, bool)> {
        let Some(p) = self.project.as_ref() else { return vec![] };
        let cur = transly_core::branches::branch_of(p);
        transly_core::branches::branch_names(p).into_iter().map(|n| (transly_core::branches::rows_in(p, &n), n)).map(|(c, n)| { let is = n == cur; (n, c, is) }).collect()
    }

    pub fn current_branch(&self) -> String {
        self.project.as_ref().map(transly_core::branches::branch_of).unwrap_or_default()
    }

    fn set_project_branch(&mut self, r: Result<SavedProject, String>) -> Result<(), String> {
        let np = r?;
        self.project = Some(np);
        self.rev += 1;
        self.dirty = true;
        Ok(())
    }

    pub fn create_branch(&mut self, name: &str) -> Result<(), String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let r = transly_core::branches::create_branch(p, name, now_ms());
        self.set_project_branch(r)
    }

    pub fn switch_branch(&mut self, name: &str) -> Result<(), String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let r = transly_core::branches::switch_branch(p, name);
        self.set_project_branch(r)
    }

    pub fn delete_branch(&mut self, name: &str) -> Result<(), String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let r = transly_core::branches::delete_branch(p, name, now_ms());
        self.set_project_branch(r)
    }

    /// Зливає гілку в поточну: нові й змінені рядки беруться, конфлікти й вичитані лишаються. Одна дія журналу з «Скасувати».
    pub fn merge_branch(&mut self, source: &str) -> Result<String, String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let rows = transly_core::branches::diff_branches(p, source)?;
        let conflicts = rows.iter().filter(|r| r.kind == transly_core::branches::DiffKind::Conflict).count();
        let plan = transly_core::branches::plan_merge(p, &rows, &transly_core::branches::default_decision, now_ms());
        let n = plan.changes.len();
        let who = self.who();
        let mut rand = Self::seeded_rand();
        let p = self.project.as_mut().ok_or("Проєкт не відкрито")?;
        if n > 0 {
            let id = commit_rows(&mut p.files, &plan.changes, &plan.kind, &who, now_ms(), None, &mut rand);
            self.undo.record(&id);
            self.rev += 1;
            self.dirty = true;
        }
        Ok(format!("Злито рядків: {n}; конфліктів лишилось (поточна гілка збережена): {conflicts}"))
    }

    /// Рядки з таким самим оригіналом: (усього інших, порожніх, старіших, змінених після еталона). None, коли двійників нема чи еталона ще нема.
    pub fn link_info(&self, f: usize, r: usize) -> Option<(usize, usize, usize, usize)> {
        let p = self.project.as_ref()?;
        let key = self.unit(f, r)?.key.clone();
        let idx = transly_core::links::LinkIndex::new(&self.views);
        let others = idx.others(&self.views[f].name, &key);
        if others == 0 {
            return None;
        }
        match transly_core::links::plan_link_sync(p, &idx, &self.views[f].name, &key) {
            Some(plan) => Some((others, plan.fills.len(), plan.updates.len(), plan.edited.len())),
            None => Some((others, 0, 0, 0)),
        }
    }

    /// Копіює переклад рядка в його двійників (порожні й старіші; змінені — лише з `with_edited`). Чернетки, одна дія журналу зі «Скасувати».
    pub fn apply_links(&mut self, f: usize, r: usize, with_edited: bool) -> usize {
        let Some(p) = self.project.as_ref() else { return 0 };
        let Some(key) = self.unit(f, r).map(|u| u.key.clone()) else { return 0 };
        let idx = transly_core::links::LinkIndex::new(&self.views);
        let Some(plan) = transly_core::links::plan_link_sync(p, &idx, &self.views[f].name, &key) else { return 0 };
        let Some(rf) = plan.view.reference else { return 0 };
        let reference = plan.view.rows[rf].target.clone();
        let mut pick: Vec<usize> = plan.fills.iter().chain(plan.updates.iter()).copied().collect();
        if with_edited {
            pick.extend(plan.edited.iter().copied());
        }
        let rows: Vec<&transly_core::links::LinkRowView> = pick.iter().map(|&i| &plan.view.rows[i]).collect();
        let changes = transly_core::links::link_changes(&reference, &rows, now_ms());
        let n = changes.len();
        if n == 0 {
            return 0;
        }
        let who = self.who();
        let mut rand = Self::seeded_rand();
        let Some(p) = self.project.as_mut() else { return 0 };
        let id = commit_rows(&mut p.files, &changes, "links", &who, now_ms(), None, &mut rand);
        self.undo.record(&id);
        self.rev += 1;
        self.dirty = true;
        n
    }

    /// Правила форми: (id, назва, пояснення, рівень, рядків із приміткою у файлі, виправних).
    pub fn qa_rules_view(&self, f: usize) -> Vec<(String, String, String, String, usize, usize)> {
        let Some(p) = self.project.as_ref() else { return vec![] };
        let opts = self.qa_options();
        let rules = transly_core::qaconfig::qa_of(p.settings.get("qa"));
        let stats = self.views.get(f).map(|v| transly_core::qaadvice::rule_stats(v, &p.files, &opts)).unwrap_or_default();
        transly_core::qarules::QA_RULES
            .iter()
            .map(|r| {
                let st = stats.iter().find(|s| s.id == r.id);
                (r.id.to_string(), r.title.to_string(), r.explain.to_string(), rules.sev[r.id].as_str().to_string(), st.map_or(0, |s| s.rows), st.map_or(0, |s| s.fixable))
            })
            .collect()
    }

    pub fn set_rule_level(&mut self, id: &str, level: &str) {
        let Some(l) = transly_core::qarules::RuleSeverity::parse(level) else { return };
        let Some(p) = self.project.as_mut() else { return };
        let q = transly_core::qaconfig::with_rule_level(p.settings.get("qa"), id, l);
        p.settings.insert("qa".into(), q);
        p.settings_at = Some(now_ms());
        self.rev += 1;
        self.dirty = true;
    }

    /// Виправляє правило в усіх файлах однією дією журналу.
    pub fn fix_qa_rule(&mut self, id: &str) -> usize {
        let Some(p) = self.project.as_ref() else { return 0 };
        let opts = self.qa_options();
        let changes = transly_core::qaadvice::fix_rule(&self.views, &p.files, id, &opts, now_ms());
        let n = changes.len();
        if n == 0 {
            return 0;
        }
        let who = self.who();
        let mut rand = Self::seeded_rand();
        let Some(p) = self.project.as_mut() else { return 0 };
        let cid = commit_rows(&mut p.files, &changes, "qafix", &who, now_ms(), None, &mut rand);
        self.undo.record(&cid);
        self.rev += 1;
        self.dirty = true;
        n
    }

    /// Налаштування перенесення рядків проєкту.
    pub fn wrap_settings(&self) -> transly_core::wrapconfig::WrapSettings {
        transly_core::wrapconfig::wrap_of(self.project.as_ref().and_then(|p| p.settings.get("wrap")))
    }

    pub fn set_wrap_settings(&mut self, w: &transly_core::wrapconfig::WrapSettings) {
        let Some(p) = self.project.as_mut() else { return };
        p.settings.insert("wrap".into(), serde_json::to_value(w).unwrap_or_default());
        p.settings_at = Some(now_ms());
        self.rev += 1;
        self.dirty = true;
    }

    /// Показує, що з текстом зробить перенос за поточними налаштуваннями (для прикладу в діалозі).
    pub fn wrap_preview(&self, text: &str, face: bool) -> (String, usize) {
        let opts = self.qa_options();
        let Some(plan) = opts.wrap else { return (text.to_string(), 0) };
        let m = transly_core::wrap::MessageLike { kind: Some("dialogue".into()), key: None, face: face.then(|| "Face".to_string()) };
        let r = transly_core::wrap::wrap_message(&plan, &m, text);
        let n = r.text.split('\n').count();
        (r.text, n)
    }

    /// Що гілка `source` внесла б у поточну.
    pub fn branch_diff(&self, source: &str) -> Result<Vec<transly_core::branches::DiffRow>, String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        transly_core::branches::diff_branches(p, source)
    }

    /// Злиття з вибором по рядках: `pick(id)` дає рішення (None — типове: нові й змінені беруться, конфлікти лишаються).
    pub fn merge_branch_with(&mut self, source: &str, pick: &dyn Fn(&str) -> Option<transly_core::branches::Decision>) -> Result<String, String> {
        use transly_core::branches::{default_decision, row_id};
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let rows = transly_core::branches::diff_branches(p, source)?;
        let decide = |r: &transly_core::branches::DiffRow| pick(&row_id(&r.file, &r.key)).or_else(|| default_decision(r));
        let plan = transly_core::branches::plan_merge(p, &rows, &decide, now_ms());
        let n = plan.changes.len();
        if n > 0 {
            let who = self.who();
            let mut rand = Self::seeded_rand();
            let p = self.project.as_mut().ok_or("Проєкт не відкрито")?;
            let id = commit_rows(&mut p.files, &plan.changes, &plan.kind, &who, now_ms(), None, &mut rand);
            self.undo.record(&id);
            self.rev += 1;
            self.dirty = true;
        }
        Ok(format!("Злито рядків: {n}"))
    }

    pub fn rename_branch(&mut self, from: &str, to: &str) -> Result<(), String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let r = transly_core::branches::rename_branch(p, from, to);
        self.set_project_branch(r)
    }

    pub fn key_of(&self, f: usize, r: usize) -> String {
        self.unit(f, r).map_or(String::new(), |u| u.key.clone())
    }

    pub fn progress(&self) -> Counts {
        let mut c = Counts::default();
        for (fi, v) in self.views.iter().enumerate() {
            for ri in 0..v.units.len() {
                c.total += 1;
                match row_state(self.entry(fi, ri)) {
                    RowState::Draft => c.draft += 1,
                    RowState::Sent => c.sent += 1,
                    RowState::Approved => c.approved += 1,
                    RowState::Untranslated => {}
                }
            }
        }
        c
    }

    /// Записує `transly-project.json` поруч із текою гри (не всередині неї).
    pub fn save_project(&mut self) -> Result<String, String> {
        let (Some(p), Some(dir)) = (&self.project, &self.dir) else { return Err("Проєкт не відкрито".into()) };
        let path = project_path(dir, &p.name);
        // спершу тимчасовий файл, потім заміна: збій посеред запису не псує проєкт
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serialize(p)).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        self.dirty = false;
        Ok(path.to_string_lossy().to_string())
    }

    /// Параметри збірки за замовчуванням (з налаштувань проєкту).
    pub fn build_defaults(&self) -> BuildChoice {
        BuildChoice { only_approved: false, include_drafts: true, block_errors: self.settings_view().is_none_or(|v| v.block_errors) }
    }

    fn build_result(&self, c: &BuildChoice) -> Result<transly_core::build::BuildResult, String> {
        let p = self.project.as_ref().ok_or("Проєкт не відкрито")?;
        let opts = BuildOptions { only_approved: c.only_approved, include_drafts: c.include_drafts && !c.only_approved, block_errors: c.block_errors, qa: self.qa_options() };
        Ok(build(&self.game, &self.views, p, &opts))
    }

    /// Скільки рядків потрапить у збірку з такими параметрами: (у грі, поза збіркою, заблоковано помилками QA). Нічого не пишеться.
    pub fn build_preview(&self, c: &BuildChoice) -> Result<(usize, usize, usize), String> {
        let r = self.build_result(c)?;
        Ok((r.included, r.skipped, r.blocked.len()))
    }

    /// Збирає переклад і кладе файли в теку гри (копії оригіналів лишаються поруч). Повертає підсумок.
    pub fn build_with(&mut self, c: &BuildChoice) -> Result<String, String> {
        let res = self.build_result(c)?;
        let dir = self.dir.as_ref().ok_or("Проєкт не відкрито")?;
        let out: Vec<OutFile> = res.files.iter().map(|f| OutFile { name: f.name.rsplit('/').next().unwrap_or(&f.name).to_string(), content: file_text(f) }).collect();
        let n = apply_data(&self.roots, &dir.to_string_lossy(), &out)?;
        let unsupported = if res.unsupported.is_empty() { String::new() } else { format!(", без запису (немає плагіна формату): {}", res.unsupported.len()) };
        Ok(format!("Збірка: записано {n} файлів, рядків у грі {}, поза збіркою {}{unsupported}", res.included, res.skipped))
    }

    /// Повертає оригінальні файли гри з резервної копії.
    pub fn restore_originals(&mut self) -> Result<String, String> {
        let dir = self.dir.as_ref().ok_or("Проєкт не відкрито")?;
        let n = restore_data(&self.roots, &dir.to_string_lossy())?;
        Ok(format!("Повернуто оригіналів: {n}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(base: &Path) -> PathBuf {
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"Hero","nickname":"","profile":"Brave","note":""}]"#).unwrap();
        data
    }

    #[test]
    fn build_writes_into_the_game_and_restore_brings_originals_back_and_project_reloads() {
        let base = std::env::temp_dir().join(format!("transly-app-build-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.submit(0, 0, "Герой").unwrap();
        let before = std::fs::read_to_string(data.join("Actors.json")).unwrap();
        let msg = s.build_with(&s.build_defaults()).unwrap();
        assert!(msg.contains("записано"), "{msg}");
        let built = std::fs::read_to_string(data.join("Actors.json")).unwrap();
        assert!(built.contains("Герой") && !before.contains("Герой"));
        s.save_project().unwrap();
        assert!(!s.dirty);
        // новий сеанс підхоплює збережений проєкт
        let mut s2 = AppState::default();
        s2.open_game(&data).unwrap();
        assert_eq!(s2.target_of(0, 0), "Герой");
        s2.restore_originals().unwrap();
        assert_eq!(std::fs::read_to_string(data.join("Actors.json")).unwrap(), before);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn memory_history_and_comments_work() {
        let base = std::env::temp_dir().join(format!("transly-app-tabs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"Brave Hero","nickname":"","profile":"","note":""},{"id":2,"name":"Brave Hero","nickname":"","profile":"","note":""}]"#).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        assert!(s.row_count(0) >= 2);
        s.submit(0, 0, "Хоробрий герой").unwrap();
        let m = s.tm_matches(0, 1);
        assert!(m.iter().any(|x| x.t == "Хоробрий герой" && x.score >= 90), "{m:?}");
        s.edit(0, 0, "Хоробра героїня");
        assert!(!s.history(0, 0).is_empty());
        s.comment(0, 0, "Перевірити рід");
        assert_eq!(s.threads(0, 0).len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn settings_change_who_and_qa_and_survive_a_reload() {
        let base = std::env::temp_dir().join(format!("transly-app-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let mut v = s.settings_view().unwrap();
        assert_eq!(v.who, "Ви");
        v.who = "Анна".into();
        v.tolerance_pct = 10.0;
        v.line_limit = 5.0;
        s.apply_settings(&v);
        assert!(s.dirty);
        assert_eq!(s.who(), "Анна");
        assert_eq!(s.qa_options().tolerance_pct, 10.0);
        assert_eq!(s.qa_options().line_limit, Some(5.0));
        s.edit(0, 0, "Герой");
        assert_eq!(s.history(0, 0)[0].rec.who, "Анна");
        s.save_project().unwrap();
        let mut s2 = AppState::default();
        s2.open_game(&data).unwrap();
        assert_eq!(s2.settings_view().unwrap().who, "Анна");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn merging_another_project_keeps_the_newer_row() {
        let base = std::env::temp_dir().join(format!("transly-app-merge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut a = AppState::default();
        a.open_game(&data).unwrap();
        a.edit(0, 0, "Старе");
        let other_path = base.join("other.transly.json");
        let mut b = AppState::default();
        b.open_game(&data).unwrap();
        b.edit(0, 0, "Нове");
        std::fs::write(&other_path, serialize(b.project.as_ref().unwrap())).unwrap();
        // у b правка пізніша: після злиття в a має лишитись «Нове»
        std::thread::sleep(std::time::Duration::from_millis(5));
        b.edit(0, 0, "Найновіше");
        std::fs::write(&other_path, serialize(b.project.as_ref().unwrap())).unwrap();
        let msg = a.merge_file(&other_path).unwrap();
        assert!(msg.starts_with("Злито"), "{msg}");
        assert_eq!(a.target_of(0, 0), "Найновіше");
        assert!(a.dirty);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn an_updated_game_moves_translations_to_the_shifted_rows() {
        let base = std::env::temp_dir().join(format!("transly-app-ingest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let actors = |names: &[&str]| format!("[null,{}]", names.iter().enumerate().map(|(i, n)| format!(r#"{{"id":{},"name":"{n}","nickname":"","profile":"","note":""}}"#, i + 1)).collect::<Vec<_>>().join(","));
        std::fs::write(data.join("Actors.json"), actors(&["Alpha", "Beta"])).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let ri = (0..s.row_count(0)).find(|r| s.source_of(0, *r) == "Beta").unwrap();
        s.edit(0, ri, "Бета");
        s.save_project().unwrap();
        // нова версія гри: перед Beta вставлено нового героя, ключі зсунулись
        std::fs::write(data.join("Actors.json"), actors(&["Alpha", "Newcomer", "Beta"])).unwrap();
        let mut s2 = AppState::default();
        s2.open_game(&data).unwrap();
        let rj = (0..s2.row_count(0)).find(|r| s2.source_of(0, *r) == "Beta").unwrap();
        assert_eq!(s2.target_of(0, rj), "Бета");
        let rn = (0..s2.row_count(0)).find(|r| s2.source_of(0, *r) == "Newcomer").unwrap();
        assert_eq!(s2.target_of(0, rn), "");
        assert!(!s2.last_note.is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_plugin_format_is_read_and_a_replace_command_runs() {
        let base = std::env::temp_dir().join(format!("transly-app-plugfmt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let plug = base.join("plug");
        std::fs::create_dir_all(&plug).unwrap();
        let manifest = r#"{"manifestVersion":1,"id":"acme.lang","name":"Lang","version":"1.0.0","contributes":{"formats":[{"id":"lang","label":"Lang","extensions":[".lang"],"text":true,"spec":{"type":"keyvalue"}}]}}"#;
        std::fs::write(plug.join("transly-plugin.json"), manifest).unwrap();
        let data = game(&base);
        std::fs::write(data.join("ui.lang"), "menu.start=Start game
menu.quit=Quit game
").unwrap();
        let mut s = AppState { host: PluginHost::open(Some(base.join("store"))), ..Default::default() };
        s.host.install(&plug).unwrap();
        s.open_game(&data).unwrap();
        let fi = s.file_names().iter().position(|n| n == "ui.lang").expect("файл плагіна прочитано");
        assert_eq!(s.row_count(fi), 2);
        s.edit(fi, 0, "Почати гру");
        s.edit(fi, 1, "Вийти з гри");
        let step = transly_core::commands::ReplaceStep { find: "гру".into(), replace: "партію".into(), whole_word: false, case_sensitive: false };
        assert_eq!(s.run_replace(std::slice::from_ref(&step), false).unwrap(), 1, "перегляд нічого не пише");
        assert_eq!(s.target_of(fi, 0), "Почати гру");
        assert_eq!(s.run_replace(&[step], true).unwrap(), 1);
        assert_eq!(s.target_of(fi, 0), "Почати партію");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn plugin_qa_rules_and_glossaries_work() {
        let base = std::env::temp_dir().join(format!("transly-app-plugqa-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let plug = base.join("plug");
        std::fs::create_dir_all(&plug).unwrap();
        let terms = "Hero	Герой
";
        std::fs::write(plug.join("terms.tsv"), terms).unwrap();
        let sum = format!("sha256-{}", transly_core::package::sha256_hex(terms.as_bytes()));
        let manifest = format!(r#"{{"manifestVersion":1,"id":"acme.qa","name":"QA","version":"1.0.0","files":{{"terms.tsv":"{sum}"}},"contributes":{{"glossaries":[{{"id":"g","title":"Терміни","file":"terms.tsv"}}],"qaRules":[{{"id":"noword","title":"Без слова","severity":"bad","check":{{"type":"forbid","items":[{{"find":"заборонено"}}],"message":"Слово заборонене"}}}}]}}}}"#);
        std::fs::write(plug.join("transly-plugin.json"), manifest).unwrap();
        let data = game(&base);
        let mut s = AppState { host: PluginHost::open(Some(base.join("store"))), ..Default::default() };
        s.host.install(&plug).unwrap();
        s.open_game(&data).unwrap();
        let issues = s.issues(0, 0, "Це заборонено тут");
        assert!(issues.iter().any(|i| i.key == "acme.qa:noword" && i.message.contains("заборонене")), "{issues:?}");
        assert!(s.issues(0, 0, "Це добре").iter().all(|i| i.key != "acme.qa:noword"));
        s.host.set_enabled("acme.qa", false);
        assert!(s.issues(0, 0, "Це заборонено тут").iter().all(|i| i.key != "acme.qa:noword"), "вимкнений плагін не перевіряє");
        s.host.set_enabled("acme.qa", true);
        s.edit(0, 0, "Це заборонено тут");
        assert!(s.file_issues(0).iter().any(|i| i.2), "помилка плагіна в списку файлу");
        assert!(s.import_plugin_glossary("acme.qa", "g").contains("Додано термінів: 1"));
        assert_eq!(s.terms().len(), 1);
        assert!(s.import_plugin_glossary("acme.qa", "g").contains("Додано термінів: 0"), "вдруге нічого нового");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn bulk_send_approve_and_undo() {
        let base = std::env::temp_dir().join(format!("transly-app-bulk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"One","nickname":"","profile":"","note":""},{"id":2,"name":"Two","nickname":"","profile":"","note":""}]"#).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.edit(0, 0, "Один");
        s.edit(0, 1, "Два");
        assert_eq!(s.progress().draft, 2);
        let m = s.bulk_send(None);
        assert!(m.starts_with("Надіслано: 2"), "{m}");
        assert_eq!(s.progress().sent, 2);
        assert_eq!(s.bulk_send(None), "Немає рядків для цієї дії");
        let m = s.bulk_approve(Some(0));
        assert!(m.starts_with("Вичитано: 2"), "{m}");
        assert_eq!(s.progress().approved, 2);
        // скасування вичитки, потім надсилання
        assert!(s.undo_last().starts_with("Скасовано"), "перше скасування");
        assert_eq!(s.progress().sent, 2);
        assert!(s.redo_last().starts_with("Повторено"));
        assert_eq!(s.progress().approved, 2);
        assert_eq!(s.redo_last(), "Немає що повторювати");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn autofill_fills_short_lines_from_known_words() {
        let base = std::env::temp_dir().join(format!("transly-app-fill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let row = |i: usize, n: &str| format!(r#"{{"id":{i},"name":"{n}","nickname":"","profile":"","note":""}}"#);
        std::fs::write(data.join("Actors.json"), format!("[null,{},{},{},{}]", row(1, "Red"), row(2, "Blue"), row(3, "Red Blue"), row(4, "Blue Red"))).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let at = |s: &AppState, name: &str| (0..s.row_count(0)).find(|r| s.source_of(0, *r) == name).unwrap();
        let (red, blue) = (at(&s, "Red"), at(&s, "Blue"));
        s.edit(0, red, "Червоний");
        s.edit(0, blue, "Синій");
        let props = s.autofill_proposals(100);
        assert!(props.iter().any(|p| p.source == "Red Blue" && p.target.to_lowercase().contains("червон") && p.target.to_lowercase().contains("син")), "{props:?}");
        let n = s.apply_autofill(&props);
        assert!(n.starts_with("Автозаповнено"), "{n}");
        let rb = at(&s, "Red Blue");
        assert!(!s.target_of(0, rb).is_empty());
        assert!(s.undo_last().starts_with("Скасовано"));
        assert!(s.target_of(0, rb).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn stepping_follows_the_filter() {
        let base = std::env::temp_dir().join(format!("transly-app-step-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        assert!(s.step_row(1));
        assert_eq!(s.row, Some(0));
        assert!(s.step_row(1));
        assert_eq!(s.row, Some(1));
        s.edit(0, 1, "x");
        s.filter = Filter::Untranslated;
        s.row = Some(0);
        assert!(!s.step_row(1), "у фільтрі лише один рядок: далі нема куди");
        assert_eq!(s.row, Some(0), "рядок з перекладом не входить у фільтр");
        s.row = Some(0);
        assert!(!s.step_row(-1), "на початку списку далі нема куди");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn build_choices_change_what_goes_into_the_game() {
        let base = std::env::temp_dir().join(format!("transly-app-buildopts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.edit(0, 0, "Герой");
        let drafts = BuildChoice { only_approved: false, include_drafts: true, block_errors: true };
        let no_drafts = BuildChoice { include_drafts: false, ..drafts };
        let only_appr = BuildChoice { only_approved: true, ..drafts };
        assert_eq!(s.build_preview(&drafts).unwrap().0, 1);
        assert_eq!(s.build_preview(&no_drafts).unwrap().0, 0, "чернетки не беруться");
        s.submit(0, 0, "Герой").unwrap();
        assert_eq!(s.build_preview(&no_drafts).unwrap().0, 1);
        assert_eq!(s.build_preview(&only_appr).unwrap().0, 0, "лише вичитані");
        s.bulk_approve(None);
        assert_eq!(s.build_preview(&only_appr).unwrap().0, 1);
        assert!(s.build_with(&only_appr).unwrap().contains("рядків у грі 1"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn memory_and_term_tables_import() {
        let base = std::env::temp_dir().join(format!("transly-app-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let src = s.source_of(0, 0);
        let m = s.import_memory(&format!("{src}\tЗбережений переклад\nбез табуляції\n\n{src}\tЗбережений переклад"));
        assert!(m.starts_with("Імпортовано пар: 1"), "{m}");
        assert!(m.contains("пропущено рядків без табуляції: 1"), "{m}");
        assert!(s.tm_matches(0, 0).iter().any(|x| x.t == "Збережений переклад"), "пам'ять працює в підказках");
        let t = s.import_terms_table("Оригінал;Переклад;Опис\nsword;меч;зброя\nshield;щит;\n");
        assert!(t.starts_with("Додано термінів: 2"), "{t}");
        assert_eq!(s.terms().len(), 2);
        let again = s.import_terms_table("Оригінал;Переклад\nsword;клинок\n");
        assert!(again.contains("з іншим перекладом (не змінено): 1"), "{again}");
        assert!(s.import_terms_table("Оригінал;Опис\nx;y\n").starts_with("У таблиці не знайдено"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_scene_tab_lists_the_event_lines_and_neighbours() {
        let base = std::env::temp_dir().join(format!("transly-app-scene-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |texts: &[&str]| {
            let mut l: Vec<String> = Vec::new();
            for t in texts {
                l.push(cmd(101, r#""",0,0,2,"Анна""#));
                l.push(cmd(401, &format!("\"{t}\"")));
            }
            l.push(cmd(0, ""));
            format!(r#"{{"conditions":{{}},"list":[{}],"trigger":0}}"#, l.join(","))
        };
        let ev = |id: i64, texts: &[&str]| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page(texts));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"Town","events":[null,{},{}]}}"#, ev(1, &["Hello there", "Come in"]), ev(2, &["Second scene"]))).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let f = s.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let r = (0..s.row_count(f)).find(|r| s.source_of(f, *r) == "Hello there").unwrap();
        let v = s.scene_view(f, r).expect("сцена є");
        assert_eq!(v.lines.len(), 2);
        assert!(v.lines[0].current && !v.lines[1].current);
        assert!(v.prev.is_none());
        let next = v.next.expect("є наступна сцена");
        assert_eq!(s.source_of(f, next), "Second scene");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn play_from_a_scene_builds_installs_the_plugin_and_launches() {
        let base = std::env::temp_dir().join(format!("transly-app-play-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let game_dir = base.join("MyGame");
        let data = game_dir.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(game_dir.join("js").join("plugins")).unwrap();
        std::fs::write(game_dir.join("js").join("plugins.js"), "var $plugins =\n[\n];\n").unwrap();
        std::fs::write(data.join("System.json"), r#"{"gameTitle":"G"}"#).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let list = [cmd(101, r#""",0,0,2,"Анна""#), cmd(401, r#""Hello""#), cmd(0, "")].join(",");
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{{"id":1,"name":"EV1","x":3,"y":4,"pages":[{{"conditions":{{}},"list":[{list}],"trigger":0}}]}}]}}"#)).unwrap();
        let marker = base.join("started.txt");
        let exe = game_dir.join("Game.cmd");
        std::fs::write(&exe, format!("@echo ok> \"{}\"\r\n", marker.display())).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let f = s.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let r = (0..s.row_count(f)).find(|r| s.source_of(f, *r) == "Hello").unwrap();
        assert!(s.play_from(f, r, true).unwrap_err().contains("програму гри"));
        s.set_game_exe(&exe);
        s.edit(f, r, "Привіт");
        let msg = s.play_from(f, r, true).unwrap();
        assert!(msg.contains("запущено"), "{msg}");
        let plugin = std::fs::read_to_string(game_dir.join("js").join("plugins").join("TranslyJump.js")).unwrap();
        assert!(plugin.contains("\"mapId\":1") && plugin.contains("\"eventIndex\":1"));
        assert!(std::fs::read_to_string(game_dir.join("js").join("plugins.js")).unwrap().contains("TranslyJump"));
        assert!(std::fs::read_to_string(data.join("Map001.json")).unwrap().contains("Привіт"), "переклад зібрано в гру");
        for _ in 0..50 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(marker.exists(), "програму гри запущено");
        assert!(s.remove_jump_plugin().unwrap().contains("прибрано"));
        assert!(!game_dir.join("js").join("plugins").join("TranslyJump.js").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn speakers_are_named_and_shown() {
        let base = std::env::temp_dir().join(format!("transly-app-spk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let mut l: Vec<String> = Vec::new();
        for t in ["One", "Two", "Three"] {
            l.push(cmd(101, r#""Face1",2,0,2"#));
            l.push(cmd(401, &format!("\"{t}\"")));
        }
        l.push(cmd(0, ""));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{{"id":1,"name":"EV1","x":1,"y":1,"pages":[{{"conditions":{{}},"list":[{}],"trigger":0}}]}}]}}"#, l.join(","))).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let f = s.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let one = (0..s.row_count(f)).find(|r| s.source_of(f, *r) == "One").unwrap();
        assert_eq!(s.speaker_of_row(f, one), "");
        let cands = s.speaker_candidates();
        let face = cands.iter().find(|c| c.0.key.starts_with("face:")).unwrap_or_else(|| panic!("обличчя в кандидатах: {:?}", cands.iter().map(|c| c.0.key.clone()).collect::<Vec<_>>()));
        assert_eq!(face.0.count, 3);
        let key = face.0.key.clone();
        assert!(s.set_speakers(&[(key.clone(), "Анна".into())]).ends_with(": 1"));
        assert_eq!(s.speaker_of_row(f, one), "Анна");
        assert!(s.set_speakers(&[(key.clone(), "Анна".into())]).ends_with(": 0"), "без змін");
        s.set_speakers(&[(key.clone(), String::new())]);
        assert_eq!(s.speaker_of_row(f, one), "");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_reference_language_is_aligned_and_shown() {
        let base = std::env::temp_dir().join(format!("transly-app-ref-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let en = game(&base);
        let ru = base.join("Ru").join("data");
        std::fs::create_dir_all(&ru).unwrap();
        std::fs::write(ru.join("Actors.json"), r#"[null,{"id":1,"name":"Герой","nickname":"","profile":"Храбрый","note":""}]"#).unwrap();
        let mut s = AppState::default();
        s.open_game(&en).unwrap();
        assert!(s.import_reference(&ru, "").is_err());
        let msg = s.import_reference(&ru, "RU").unwrap();
        assert!(msg.contains("«ru»"), "{msg}");
        let hero = (0..s.row_count(0)).find(|r| s.source_of(0, *r) == "Hero").unwrap();
        assert_eq!(s.references_of(0, hero), vec![("ru".to_string(), "Герой".to_string())]);
        s.save_project().unwrap();
        let mut s2 = AppState::default();
        s2.open_game(&en).unwrap();
        assert_eq!(s2.references_of(0, hero).len(), 1, "довідка переживає перезапуск");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn groups_collect_rows_and_filter_the_list() {
        let base = std::env::temp_dir().join(format!("transly-app-groups-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        assert_eq!(s.create_group("Головні"), "Група «Головні»");
        assert_eq!(s.create_group("  "), "Назва групи порожня");
        let id = s.groups_view()[0].id.clone();
        assert_eq!(s.place_in_group(0, 0, 0, Some(&id)), 1);
        let g = &s.groups_view()[0];
        assert_eq!((g.rows, g.translated), (1, 0));
        s.group_filter = Some(id.clone());
        assert_eq!(s.visible_len(0), 1, "у списку лише рядки групи");
        s.group_filter = None;
        assert_eq!(s.visible_len(0), s.row_count(0));
        assert_eq!(s.place_in_group(0, 0, 0, None), 1, "рядок виходить із групи");
        assert_eq!(s.groups_view()[0].rows, 0);
        assert!(s.auto_groups(false) == 0, "без сцен автогруп за сценами нема");
        s.delete_group(&id);
        assert!(s.groups_view().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn branches_switch_and_merge() {
        let base = std::env::temp_dir().join(format!("transly-app-branch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.edit(0, 0, "Основа");
        assert_eq!(s.current_branch(), "main");
        s.create_branch("варіант").unwrap();
        assert_eq!(s.current_branch(), "варіант");
        s.edit(0, 1, "Тільки тут");
        assert!(s.create_branch("варіант").is_err());
        s.switch_branch("main").unwrap();
        assert_eq!(s.target_of(0, 1), "");
        s.rename_branch("варіант", "стиль").unwrap();
        s.rename_branch("стиль", "варіант").unwrap();
        let msg = s.merge_branch("варіант").unwrap();
        assert!(msg.starts_with("Злито рядків: 1"), "{msg}");
        assert_eq!(s.target_of(0, 1), "Тільки тут");
        assert!(!s.undo_last().is_empty());
        assert_eq!(s.target_of(0, 1), "");
        assert!(s.delete_branch("main").is_err());
        s.delete_branch("варіант").unwrap();
        assert_eq!(s.branches_view().len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn identical_sources_are_filled_from_the_reference() {
        let base = std::env::temp_dir().join(format!("transly-app-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |t: &str| format!(r#"{{"conditions":{{}},"list":[{},{},{}],"trigger":0}}"#, cmd(101, r#""",0,0,2"#), cmd(401, &format!("\"{t}\"")), cmd(0, ""));
        let ev = |id: i64| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page("Welcome to the village, traveler"));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{},{},{}]}}"#, ev(1), ev(2), ev(3))).unwrap();
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let f = s.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let rows: Vec<usize> = (0..s.row_count(f)).filter(|r| s.source_of(f, *r) == "Welcome to the village, traveler").collect();
        assert_eq!(rows.len(), 3);
        assert_eq!(s.link_info(f, rows[0]), Some((2, 0, 0, 0)), "еталона ще нема");
        s.edit(f, rows[0], "Ласкаво просимо, мандрівнику");
        s.submit(f, rows[0], "Ласкаво просимо, мандрівнику").unwrap();
        assert_eq!(s.link_info(f, rows[0]), Some((2, 2, 0, 0)));
        assert_eq!(s.apply_links(f, rows[0], false), 2);
        assert_eq!(s.target_of(f, rows[2]), "Ласкаво просимо, мандрівнику");
        assert_eq!(s.apply_links(f, rows[0], false), 0, "повторно нічого");
        assert!(!s.undo_last().is_empty());
        assert_eq!(s.target_of(f, rows[2]), "");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn qa_rules_levels_and_fix() {
        let base = std::env::temp_dir().join(format!("transly-app-qarules-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let v = s.qa_rules_view(0);
        assert_eq!(v.len(), transly_core::qarules::QA_RULES.len());
        let (id, def) = (v[0].0.clone(), v[0].3.clone());
        s.set_rule_level(&id, "off");
        assert_eq!(s.qa_rules_view(0)[0].3, "off");
        s.set_rule_level(&id, &def);
        assert_eq!(s.qa_rules_view(0)[0].3, def);
        assert_eq!(s.fix_qa_rule(&id), 0, "нічого виправляти");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn wrap_settings_roundtrip_and_preview() {
        let base = std::env::temp_dir().join(format!("transly-app-wrap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let mut w = s.wrap_settings();
        assert_eq!(w.mode, transly_core::wrapconfig::WrapMode::Build);
        w.max_lines = 3;
        s.set_wrap_settings(&w);
        assert_eq!(s.wrap_settings().max_lines, 3);
        let (t, n) = s.wrap_preview("слово слово слово слово слово слово слово слово слово слово слово слово слово слово слово", false);
        assert!(n >= 2, "довгий текст переноситься: {t}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn branch_conflicts_follow_the_pick() {
        let base = std::env::temp_dir().join(format!("transly-app-conflict-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.edit(0, 0, "Старий");
        s.create_branch("b").unwrap();
        s.edit(0, 0, "Їхній");
        s.switch_branch("main").unwrap();
        s.edit(0, 0, "Мій");
        let rows = s.branch_diff("b").unwrap();
        assert!(rows.iter().any(|r| r.kind == transly_core::branches::DiffKind::Conflict), "{rows:?}");
        s.merge_branch_with("b", &|_| None).unwrap();
        assert_eq!(s.target_of(0, 0), "Мій", "без вибору лишається мій");
        s.merge_branch_with("b", &|_| Some(transly_core::branches::Decision::Theirs)).unwrap();
        assert_eq!(s.target_of(0, 0), "Їхній");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn an_unreadable_project_is_kept_not_overwritten() {
        let base = std::env::temp_dir().join(format!("transly-app-unreadable-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        s.edit(0, 0, "Переклад");
        s.save_project().unwrap();
        let path = project_path(&data, &name_from_folder(&data.to_string_lossy()));
        std::fs::write(&path, "{ це не json").unwrap();
        let mut s2 = AppState::default();
        s2.open_game(&data).unwrap();
        assert!(s2.last_note.contains("не вдалося прочитати"), "{}", s2.last_note);
        let kept = std::fs::read_dir(path.parent().unwrap()).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().contains("unreadable-") && std::fs::read_to_string(e.path()).is_ok_and(|t| t == "{ це не json"));
        assert!(kept, "копію нечитного файлу збережено");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn terms_are_marked_in_the_source_and_qa_reads_them() {
        let base = std::env::temp_dir().join(format!("transly-app-terms-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        s.open_game(&data).unwrap();
        let src = s.source_of(0, 0);
        assert!(s.source_marks(0, 0).is_empty());
        assert_eq!(s.add_term(&src, "Герой"), "Термін додано");
        assert_eq!(s.add_term(&src, "Інший"), "Такий термін уже є");
        assert_eq!(s.terms().len(), 1);
        assert!(!s.source_marks(0, 0).is_empty());
        assert!(!s.issues(0, 0, "Зовсім інше слово").is_empty(), "переклад без терміна дає примітку");
        assert!(s.issues(0, 0, "Герой").iter().all(|i| i.key != "term"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn open_edit_submit_save() {
        let base = std::env::temp_dir().join(format!("transly-app-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = game(&base);
        let mut s = AppState::default();
        assert!(s.open_game(&data).unwrap() >= 1);
        assert!(s.row_count(0) >= 1);
        assert_eq!(s.progress().total, s.views.iter().map(|v| v.units.len()).sum::<usize>());
        s.edit(0, 0, "Герой");
        assert_eq!(s.target_of(0, 0), "Герой");
        assert_eq!(s.progress().draft, 1);
        s.submit(0, 0, "Герой").unwrap();
        assert_eq!(s.progress().sent, 1);
        let c = s.filter_counts(0);
        assert_eq!(c[0], s.row_count(0));
        assert_eq!(c[3], 1, "один надісланий");
        s.filter = Filter::Sent;
        assert_eq!(s.visible_len(0), 1);
        s.search = "нема-такого".into();
        assert_eq!(s.visible_len(0), 0);
        s.search.clear();
        s.filter = Filter::All;
        assert_eq!(s.file_progress()[0].1, 1);
        let saved = s.save_project().unwrap();
        assert!(std::fs::read_to_string(saved).unwrap().contains("Герой"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
