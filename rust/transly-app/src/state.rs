//! Стан застосунку без малювання: проєкт, рядки гри, вибір. Тестується без вікна.

use std::path::{Path, PathBuf};
use transly_core::model::{Entry, GameFile, Unit};
use transly_core::progress::{row_state, RowState};
use transly_core::build::{build, file_text, BuildOptions};
use transly_core::projname::name_from_folder;
use transly_core::project::{deserialize, empty_project, serialize, FileView, SavedProject};
use transly_core::glossary::{prepare_text, term_ranges_in, Term};
use transly_core::qa::{check, default_qa, Issue, UnitLike};
use transly_core::termedit::{save_term, SaveResult, TermForm};
use transly_core::readgame::read_game;
use transly_core::rpgmaker::ExtractOptions;
use transly_core::workflow::{edit, reconcile, submit, Stage, SubmitOptions, SubmitResult};
use transly_platform::{apply_data, list_json, read_text, register_picked, restore_data, OutFile, Picked, Roots};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowStatus {
    Untranslated,
    Draft,
    Sent,
    Approved,
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

pub struct AppState {
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
        AppState { game: vec![], dirty: false, filter: Filter::All, search: String::new(), rev: 0, vis: Default::default(), prog: std::cell::RefCell::new((u64::MAX, vec![])), roots: Roots::default(), picked: Picked::open(file), project: None, views: vec![], dir: None, file: None, row: None }
    }
}

/// Де лежить проєкт: поруч із текою гри (не всередині неї).
fn project_path(dir: &Path, name: &str) -> PathBuf {
    dir.parent().unwrap_or(dir).join(format!("{name}.transly.json"))
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
        let exts: Vec<String> = [".po", ".pot", ".csv", ".tsv", ".rpy"].iter().map(|e| e.to_string()).collect();
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
        let views = read_game(&files, &ExtractOptions::default());
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
        let next = edit(self.entry(f, r), &u, text, Stage::Translate, now_ms());
        self.put(f, name, u.key, next);
    }

    /// Надсилає рядок на вичитку (з перевіркою QA за правилами ядра).
    pub fn submit(&mut self, f: usize, r: usize, text: &str) -> Result<(), String> {
        self.edit(f, r, text);
        let Some(u) = self.unit(f, r).cloned() else { return Err("Немає рядка".into()) };
        let name = self.views[f].name.clone();
        let opts = SubmitOptions { qa: default_qa(), block_errors: true };
        match submit(self.entry(f, r), &u, Stage::Translate, now_ms(), &opts) {
            SubmitResult::Ok(e) => {
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
        let mut qa = default_qa();
        qa.terms = self.terms();
        check(&UnitLike::from(u), text, &qa)
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
        let mut qa = default_qa();
        qa.terms = self.terms();
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
