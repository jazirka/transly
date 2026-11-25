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
use transly_platform::{apply_data, list_json, read_text, register_picked, restore_data, OutFile, Picked, Roots};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowStatus {
    Untranslated,
    Draft,
    Sent,
    Approved,
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
        AppState { undo: Default::default(), host: PluginHost::open(plugins_dir()), sync_state: FilesState::default(), sync_rx: None, last_note: String::new(), qa_cache: std::cell::RefCell::new(((usize::MAX, 0), vec![])), game: vec![], dirty: false, filter: Filter::All, search: String::new(), rev: 0, vis: Default::default(), prog: std::cell::RefCell::new((u64::MAX, vec![])), roots: Roots::default(), picked: Picked::open(file), project: None, views: vec![], dir: None, file: None, row: None }
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
    pub fn open_game(&mut self, dir: &Path) -> Result<usize, String> {
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
        let name = name_from_folder(&d);
        let name = if name.is_empty() { "Новий проєкт".to_string() } else { name };
        // проєкт, збережений раніше, підхоплюється; рядки, чий оригінал змінився, повертаються в чернетки
        let path = project_path(dir, &name);
        let mut project = match std::fs::read_to_string(&path) {
            Ok(t) => deserialize(&t, Some(now_ms())).unwrap_or_else(|_| empty_project(&name, "en", "uk")),
            Err(_) => empty_project(&name, "en", "uk"),
        };
        for v in &views {
            if let Some(entries) = project.files.get_mut(&v.name) {
                reconcile(&v.units, entries, now_ms());
            }
        }
        // гра могла оновитися: переклади зіставляються з новими рядками за текстом оригіналу (ключі зсуваються)
        self.last_note = String::new();
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
        let key = (f, Filter::ALL.iter().position(|x| *x == self.filter).unwrap_or(0) as u8, self.search.clone(), self.rev);
        if self.vis.borrow().key == key {
            return;
        }
        let q = self.search.to_lowercase();
        let mut v = Visible { key, ..Default::default() };
        for r in 0..self.row_count(f) {
            let st = self.status_of(f, r);
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
            qa.line_limit = p.settings.get("lineLimit").and_then(|v| v.as_f64()).filter(|l| *l > 0.0);
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

    /// Збирає переклад і кладе файли в теку гри (копії оригіналів лишаються поруч). Повертає підсумок.
    pub fn build_into_game(&mut self, include_drafts: bool) -> Result<String, String> {
        let (Some(p), Some(dir)) = (&self.project, &self.dir) else { return Err("Проєкт не відкрито".into()) };
        let qa = self.qa_options();
        let opts = BuildOptions { only_approved: false, include_drafts, block_errors: true, qa };
        let res = build(&self.game, &self.views, p, &opts);
        let out: Vec<OutFile> = res.files.iter().map(|f| OutFile { name: f.name.rsplit('/').next().unwrap_or(&f.name).to_string(), content: file_text(f) }).collect();
        let n = apply_data(&self.roots, &dir.to_string_lossy(), &out)?;
        Ok(format!("Збірка: записано {n} файлів, рядків у грі {}, поза збіркою {}", res.included, res.skipped))
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
        let msg = s.build_into_game(true).unwrap();
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
