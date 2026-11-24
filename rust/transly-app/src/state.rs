//! Стан застосунку без малювання: проєкт, рядки гри, вибір. Тестується без вікна.

use std::path::{Path, PathBuf};
use transly_core::model::{Entry, GameFile, Unit};
use transly_core::progress::{row_state, RowState};
use transly_core::project::{empty_project, serialize, FileView, SavedProject};
use transly_core::qa::default_qa;
use transly_core::readgame::read_game;
use transly_core::rpgmaker::ExtractOptions;
use transly_core::workflow::{edit, submit, Stage, SubmitOptions, SubmitResult};
use transly_platform::{list_json, read_text, register_picked, Picked, Roots};

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
        AppState { filter: Filter::All, search: String::new(), rev: 0, vis: Default::default(), prog: std::cell::RefCell::new((u64::MAX, vec![])), roots: Roots::default(), picked: Picked::open(file), project: None, views: vec![], dir: None, file: None, row: None }
    }
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
        let listed = list_json(&self.roots, &d, None)?;
        let mut files = Vec::new();
        for f in listed {
            let text = read_text(&self.roots, &f.path)?;
            let json = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
            files.push(GameFile { name: f.name, json, text: None });
        }
        let views = read_game(&files, &ExtractOptions::default());
        let name = dir.file_name().map_or("Новий проєкт".to_string(), |n| n.to_string_lossy().to_string());
        let project = empty_project(&name, "en", "uk");
        let n = views.len();
        self.views = views;
        self.project = Some(project);
        self.dir = Some(dir.to_path_buf());
        self.file = if n > 0 { Some(0) } else { None };
        self.row = None;
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
    pub fn save_project(&self) -> Result<String, String> {
        let (Some(p), Some(dir)) = (&self.project, &self.dir) else { return Err("Проєкт не відкрито".into()) };
        let path = dir.parent().unwrap_or(dir).join(format!("{}.transly.json", p.name));
        std::fs::write(&path, serialize(p)).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
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
