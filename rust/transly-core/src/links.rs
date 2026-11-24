//! `links.ts`: зв'язки між рядками. Рядки з точно однаковим оригіналом (без пробілів на краях) зв'язані самі: для пари нічого не
//! зберігається. У проєкт записуються лише винятки: рядок, що **роз'єднаний**, і рядок, який перекладач обрав **головним**
//! перекладом гнізда. Решта обчислюється з рядків.
//!
//! З чим порівнюється гніздо (*еталон*): головний переклад, коли обраний і має текст, інакше переклад рядка, надісланого чи
//! затвердженого останнім (чернетка не поширюється). Рядок тоді `empty`, `same`, `differs` (старіший текст за еталон),
//! `edited` (змінений після еталона: не чіпається без запиту) чи `unlinked`.
//!
//! Ключі рядків — позиції й можуть зсунутися при оновленні гри, тож кожен збережений елемент несе хеш оригіналу, для якого
//! зроблений; елемент, чий оригінал на тому місці вже інший, ігнорується, ніколи не застосовується.

use crate::groups::{hash_text, row_ref};
use crate::journal::RowChange;
use crate::js;
use crate::model::{Entry, Status};
use crate::project::{FileView, SavedProject};
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub use crate::groups::merge_mt_records;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkMode {
    Ask,
    Auto,
    Off,
}

/// Режим проєкту: `ask`, якщо не обрано інше; проєкт старішої збірки з вимкненим копіюванням — `off`.
pub fn link_mode_of(settings: Option<&Map<String, Value>>) -> LinkMode {
    match settings.and_then(|s| s.get("linkMode")).and_then(|m| m.as_str()) {
        Some("ask") => LinkMode::Ask,
        Some("auto") => LinkMode::Auto,
        Some("off") => LinkMode::Off,
        _ => {
            if settings.and_then(|s| s.get("propagate")).and_then(|p| p.as_bool()) == Some(false) { LinkMode::Off } else { LinkMode::Ask }
        }
    }
}

/// Дві копії зв'язків: по елементу перемагає новіший, а старше за останнє скидання відкидається.
pub fn merge_link_data(a: Option<&Map<String, Value>>, b: Option<&Map<String, Value>>, epoch: i64) -> Option<Map<String, Value>> {
    merge_mt_records(a, b, epoch)
}

const MIN_LENGTH: usize = 2;
/// Що робить два оригінали однаковими: текст без пробілів на краях.
pub fn link_key(source: &str) -> String {
    js::trim(source).to_string()
}
fn unlink_id(r: &str) -> String {
    format!("u:{r}")
}
fn main_id(text: &str) -> String {
    format!("m:{text}")
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LinkRow {
    pub file: String,
    pub key: String,
    #[serde(rename = "ref")]
    pub r#ref: String,
    /// Оригінал, як він у грі (з нього зроблені хеш-захист і `src`).
    pub source: String,
}

/// Рядки зі спільним оригіналом по всіх файлах. Існують лише гнізда з двох і більше.
pub struct LinkIndex {
    by_text: IndexMap<String, Vec<LinkRow>>,
    text_of: HashMap<String, String>,
}

impl LinkIndex {
    pub fn new(views: &[FileView]) -> LinkIndex {
        let mut all: IndexMap<String, Vec<LinkRow>> = IndexMap::new();
        for v in views {
            for u in &v.units {
                let text = link_key(&u.source);
                if js::len16(&text) < MIN_LENGTH {
                    continue;
                }
                all.entry(text).or_default().push(LinkRow { file: v.name.clone(), key: u.key.clone(), r#ref: row_ref(&v.name, &u.key), source: u.source.clone() });
            }
        }
        let (mut by_text, mut text_of) = (IndexMap::new(), HashMap::new());
        for (text, rows) in all {
            if rows.len() > 1 {
                for r in &rows {
                    text_of.insert(r.r#ref.clone(), text.clone());
                }
                by_text.insert(text, rows);
            }
        }
        LinkIndex { by_text, text_of }
    }

    /// Гніздо, в якому рядок, або None, коли його оригінал унікальний.
    pub fn cluster_of(&self, file: &str, key: &str) -> Option<(&str, &[LinkRow])> {
        let text = self.text_of.get(&row_ref(file, key))?;
        Some((text.as_str(), self.by_text.get(text)?.as_slice()))
    }
    /// Скільки інших рядків мають оригінал цього.
    pub fn others(&self, file: &str, key: &str) -> usize {
        self.cluster_of(file, key).map_or(0, |(_, r)| r.len().saturating_sub(1))
    }
    pub fn clusters(&self) -> impl Iterator<Item = (&String, &Vec<LinkRow>)> {
        self.by_text.iter()
    }
    pub fn size(&self) -> usize {
        self.by_text.len()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    Main,
    Same,
    Empty,
    Differs,
    Edited,
    Unlinked,
    Draft,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LinkRowView {
    pub file: String,
    pub key: String,
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<Entry>,
    pub target: String,
    pub status: Status,
    pub state: LinkState,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LinkView {
    pub text: String,
    pub rows: Vec<LinkRowView>,
    /// Індекс рядка, для якого зроблено вигляд.
    #[serde(rename = "self")]
    pub self_i: usize,
    /// Індекс рядка, що тримає текст, з яким порівнюються інші (обраний головний чи надісланий останнім).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<usize>,
    /// Індекс головного рядка, який обрав перекладач, коли вибір ще чинний.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main: Option<usize>,
}

fn item<'a>(links: Option<&'a Map<String, Value>>, id: &str) -> Option<&'a Map<String, Value>> {
    links?.get(id)?.as_object()
}
fn live(it: Option<&Map<String, Value>>, h: &str) -> bool {
    it.is_some_and(|it| it.get("del").and_then(|d| d.as_bool()) != Some(true) && it.get("h").and_then(|x| x.as_str()) == Some(h))
}
fn sent(r: &LinkRowView) -> bool {
    !js::trim(&r.target).is_empty() && matches!(r.status, Status::Done | Status::Appr)
}
fn entry_mt(r: &LinkRowView) -> i64 {
    r.entry.as_ref().map_or(0, |e| e.mt)
}

/// Гніздо рядка зі станом кожного його рядка, або None, коли в рядка нема двійника.
pub fn link_view(saved: &SavedProject, idx: &LinkIndex, file: &str, key: &str) -> Option<LinkView> {
    let (text, crows) = idx.cluster_of(file, key)?;
    let links = saved.links.as_ref();
    let mut rows: Vec<LinkRowView> = crows
        .iter()
        .map(|r| {
            let entry = saved.files.get(&r.file).and_then(|f| f.get(&r.key)).cloned();
            let unlinked = live(item(links, &unlink_id(&r.r#ref)), &hash_text(&r.source));
            LinkRowView { file: r.file.clone(), key: r.key.clone(), r#ref: r.r#ref.clone(), source: r.source.clone(), target: entry.as_ref().map_or(String::new(), |e| e.target.clone()), status: entry.as_ref().map_or(Status::New, |e| e.status), entry, state: if unlinked { LinkState::Unlinked } else { LinkState::Draft } }
        })
        .collect();
    let linked: Vec<usize> = (0..rows.len()).filter(|&i| rows[i].state != LinkState::Unlinked).collect();
    let mi = item(links, &main_id(text)).filter(|m| m.get("del").and_then(|d| d.as_bool()) != Some(true));
    let main = mi.and_then(|mi| linked.iter().copied().find(|&i| Some(rows[i].r#ref.as_str()) == mi.get("ref").and_then(|x| x.as_str()) && mi.get("h").and_then(|x| x.as_str()) == Some(hash_text(&rows[i].source).as_str())));
    let reference = match main.filter(|&i| !js::trim(&rows[i].target).is_empty()) {
        Some(i) => Some(i),
        None => {
            let mut cands: Vec<usize> = linked.iter().copied().filter(|&i| sent(&rows[i])).collect();
            cands.sort_by(|&a, &b| entry_mt(&rows[b]).cmp(&entry_mt(&rows[a])).then_with(|| js::cmp(&rows[a].r#ref, &rows[b].r#ref)));
            cands.first().copied()
        }
    };
    for &i in &linked {
        let state = match reference {
            None => if js::trim(&rows[i].target).is_empty() { LinkState::Empty } else { LinkState::Draft },
            Some(rf) => {
                if i == rf {
                    LinkState::Main
                } else if js::trim(&rows[i].target).is_empty() {
                    LinkState::Empty
                } else if rows[i].target == rows[rf].target {
                    LinkState::Same
                } else if entry_mt(&rows[i]) > entry_mt(&rows[rf]) {
                    LinkState::Edited
                } else {
                    LinkState::Differs
                }
            }
        };
        rows[i].state = state;
    }
    let self_i = rows.iter().position(|r| r.file == file && r.key == key)?;
    Some(LinkView { text: text.to_string(), rows, self_i, reference, main })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LinkPlan {
    pub view: LinkView,
    /// Рядки без перекладу: вони дістають еталон як є.
    pub fills: Vec<usize>,
    /// Рядки зі старішим, іншим текстом.
    pub updates: Vec<usize>,
    /// Рядки, змінені після еталона: лише на запит.
    pub edited: Vec<usize>,
}

/// Що зміниться в гнізді рядка, щоб воно пішло за еталоном. Сам рядок у плані ніколи не буває.
pub fn plan_link_sync(saved: &SavedProject, idx: &LinkIndex, file: &str, key: &str) -> Option<LinkPlan> {
    let view = link_view(saved, idx, file, key)?;
    view.reference?;
    let others: Vec<usize> = (0..view.rows.len()).filter(|&i| i != view.self_i).collect();
    let pick = |s: LinkState| others.iter().copied().filter(|&i| view.rows[i].state == s).collect::<Vec<_>>();
    let (fills, updates, edited) = (pick(LinkState::Empty), pick(LinkState::Differs), pick(LinkState::Edited));
    Some(LinkPlan { view, fills, updates, edited })
}

/// Рядки після того, як вони взяли текст еталона. Це ЧЕРНЕТКИ (позначені як заповнені застосунком, див. `is_auto_filled`), не надіслані:
/// перекладач не дивився на них на їхніх місцях, а заповнений рядок не повинен рахуватися зробленою роботою. Затвердження ніколи не копіюється.
pub fn link_changes(reference: &str, rows: &[&LinkRowView], now: i64) -> Vec<RowChange> {
    rows.iter()
        .map(|r| {
            let mut next = Entry { target: reference.to_string(), status: Status::Draft, mt: now, src: Some(r.source.clone()), returned: Some(false), ..r.entry.clone().unwrap_or_else(Entry::blank) };
            next.orig = None;
            RowChange { file: r.file.clone(), key: r.key.clone(), text: reference.to_string(), next, what: None }
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SendSync {
    /// Записи, які робляться зараз (одна дія журналу).
    pub changes: Vec<RowChange>,
    pub filled: usize,
    pub updated: usize,
    /// Рядки, що відрізняються й лишаються перекладачеві.
    pub pending: usize,
}

/// Після надсилання рядка: що режим проєкту робить з рештою його гнізда.
pub fn after_send(saved: &SavedProject, idx: &LinkIndex, mode: LinkMode, file: &str, key: &str, now: i64) -> SendSync {
    let none = SendSync { changes: vec![], filled: 0, updated: 0, pending: 0 };
    if mode == LinkMode::Off {
        return none;
    }
    let Some(plan) = plan_link_sync(saved, idx, file, key) else { return none };
    let Some(rf) = plan.view.reference else { return none };
    let take: Vec<&LinkRowView> = if mode == LinkMode::Auto { plan.fills.iter().chain(&plan.updates).map(|&i| &plan.view.rows[i]).collect() } else { plan.fills.iter().map(|&i| &plan.view.rows[i]).collect() };
    SendSync {
        changes: link_changes(&plan.view.rows[rf].target, &take, now),
        filled: plan.fills.len(),
        updated: if mode == LinkMode::Auto { plan.updates.len() } else { 0 },
        pending: (if mode == LinkMode::Auto { 0 } else { plan.updates.len() }) + plan.edited.len(),
    }
}

/// Скільки рядків поруч із даними (в їхніх гніздах) мають на що глянути: порожні, різні чи змінені пізніше. Кожен рахується раз.
pub fn pending_links(saved: &SavedProject, idx: &LinkIndex, rows: &[(String, String)]) -> usize {
    let mut seen: std::collections::HashSet<String> = Default::default();
    let mut done: std::collections::HashSet<String> = Default::default();
    for (file, key) in rows {
        let Some((text, _)) = idx.cluster_of(file, key) else { continue };
        if !done.insert(text.to_string()) {
            continue;
        }
        if let Some(plan) = plan_link_sync(saved, idx, file, key) {
            for &i in plan.fills.iter().chain(&plan.updates).chain(&plan.edited) {
                seen.insert(plan.view.rows[i].r#ref.clone());
            }
        }
    }
    seen.len()
}

/* ---------- що вирішує перекладач ---------- */

fn put(saved: &mut SavedProject, id: String, item: Value) {
    saved.links.get_or_insert_with(Map::new).insert(id, item);
}
fn with_deleted(cur: &Map<String, Value>, now: i64) -> Value {
    let mut o = cur.clone();
    o.insert("mt".into(), json!(now));
    o.insert("del".into(), json!(true));
    Value::Object(o)
}

/// Робить рядок головним перекладом його гнізда (решта йде за ним).
pub fn set_main(saved: &mut SavedProject, file: &str, key: &str, source: &str, now: i64) {
    put(saved, main_id(&link_key(source)), json!({ "k": "m", "ref": row_ref(file, key), "h": hash_text(source), "mt": now }));
}
/// Назад до «еталон — той, що надіслано останнім».
pub fn clear_main(saved: &mut SavedProject, source: &str, now: i64) {
    let id = main_id(&link_key(source));
    let cur = item(saved.links.as_ref(), &id).filter(|c| c.get("del").and_then(|d| d.as_bool()) != Some(true)).cloned();
    if let Some(cur) = cur {
        put(saved, id, with_deleted(&cur, now));
    }
}
/// Рядок перестає йти за двійниками й не чіпається ними.
pub fn unlink_row(saved: &mut SavedProject, file: &str, key: &str, source: &str, now: i64) {
    let r = row_ref(file, key);
    put(saved, unlink_id(&r), json!({ "k": "u", "ref": r, "h": hash_text(source), "mt": now }));
}
/// Рядок знову йде за двійниками.
pub fn relink_row(saved: &mut SavedProject, file: &str, key: &str, now: i64) {
    let id = unlink_id(&row_ref(file, key));
    let cur = item(saved.links.as_ref(), &id).filter(|c| c.get("del").and_then(|d| d.as_bool()) != Some(true)).cloned();
    if let Some(cur) = cur {
        put(saved, id, with_deleted(&cur, now));
    }
}

/* ---------- увесь проєкт ---------- */

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Variant {
    pub target: String,
    pub rows: Vec<usize>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LinkCluster {
    pub text: String,
    pub view: LinkView,
    pub counts: IndexMap<&'static str, usize>,
    /// Різні переклади гнізда з рядками, що їх мають, найуживаніші першими.
    pub variants: Vec<Variant>,
}

/// Гнізда, на які є що глянути: рядки, що відрізняються від еталона чи між собою, змінені після нього, чи порожні поруч із перекладом.
/// Найбільші першими; `total` — кількість до `limit`.
pub fn review_clusters(saved: &SavedProject, idx: &LinkIndex, limit: usize) -> (Vec<LinkCluster>, usize) {
    let mut out: Vec<LinkCluster> = Vec::new();
    for (_, rows) in idx.clusters() {
        let first = &rows[0];
        let Some(view) = link_view(saved, idx, &first.file, &first.key) else { continue };
        let mut counts: IndexMap<&'static str, usize> = ["main", "same", "empty", "differs", "edited", "unlinked", "draft"].into_iter().map(|k| (k, 0)).collect();
        for r in &view.rows {
            *counts.get_mut(state_name(r.state)).unwrap() += 1;
        }
        let mut targets: IndexMap<String, Vec<usize>> = IndexMap::new();
        for (i, r) in view.rows.iter().enumerate() {
            if r.state != LinkState::Unlinked && !js::trim(&r.target).is_empty() {
                targets.entry(r.target.clone()).or_default().push(i);
            }
        }
        let needs = counts["differs"] > 0 || counts["edited"] > 0 || (counts["empty"] > 0 && view.reference.is_some()) || targets.len() > 1;
        if !needs {
            continue;
        }
        let mut variants: Vec<Variant> = targets.into_iter().map(|(target, rows)| Variant { target, rows }).collect();
        variants.sort_by_key(|v| std::cmp::Reverse(v.rows.len()));
        out.push(LinkCluster { text: view.text.clone(), view, counts, variants });
    }
    out.sort_by(|a, b| b.view.rows.len().cmp(&a.view.rows.len()).then_with(|| if js::cmp(&a.text, &b.text) == std::cmp::Ordering::Less { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }));
    let total = out.len();
    out.truncate(limit);
    (out, total)
}

fn state_name(s: LinkState) -> &'static str {
    match s {
        LinkState::Main => "main",
        LinkState::Same => "same",
        LinkState::Empty => "empty",
        LinkState::Differs => "differs",
        LinkState::Edited => "edited",
        LinkState::Unlinked => "unlinked",
        LinkState::Draft => "draft",
    }
}
