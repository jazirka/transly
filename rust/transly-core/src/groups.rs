//! `groups.ts`: групи рядків перекладача. Група — іменований набір рядків; належність записується «членами» на рівні файлу,
//! сцени чи рядка (найближчий член перемагає), тож група з цілих сцен лишається кількома рядками даних.
//!
//! Групи й члени — `serde_json::Map` зі значеннями-`Value`, як у файлі проєкту: порядок ключів і невідомі поля зберігаються,
//! а зміни роблять те саме, що TS (`{...g, name, mt}` — той самий ключ на місці).
//!
//! Відмінність від TS: випадкову частину id нової групи дає виклик (`rand_suffix`, чотири символи base36).

use crate::collate::locale_compare_uk;
use crate::journal::SavedFiles;
use crate::js;
use crate::model::Unit;
use crate::progress::{count_row, Progress};
use crate::project::{FileView, SavedProject};
use crate::scene::{build_scene_index, scene_key};
use crate::speakers::{speaker_of, SpeakerMap, SpeakerRow};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// Група перекладача.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    /// Один із `GROUP_COLORS` (чи будь-який колір CSS).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Коли створена (тримає список у порядку створення).
    pub at: i64,
    /// Остання зміна назви чи кольору; новіша сторона перемагає при злитті.
    pub mt: i64,
    /// Видалена: лишається слідом, щоб злиття з пристроєм, що ще має групу, не повернуло її.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub del: Option<bool>,
}

/// Групи й члени проєкту.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GroupData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Map<String, Value>>,
}
impl GroupData {
    pub fn of(p: &SavedProject) -> GroupData {
        GroupData { groups: p.groups.clone(), members: p.members.clone() }
    }
    pub fn apply(self, p: &mut SavedProject) {
        p.groups = self.groups;
        p.members = self.members;
    }
}

pub const GROUP_COLORS: [&str; 8] = ["#8b72e8", "#4aa3df", "#4cc38a", "#e0a046", "#f06a78", "#c678dd", "#56b6c2", "#9aa0a6"];

/// Колір, яким малюється група. Малюються лише звичайні шістнадцяткові кольори: файл проєкту чи синхронізований проєкт не
/// викликає довіри, а колір в атрибуті style — спосіб вставити CSS.
pub fn group_color(color: Option<&str>) -> String {
    match color {
        Some(c) if is_hex_color(c) => c.to_string(),
        _ => GROUP_COLORS[0].to_string(),
    }
}
fn is_hex_color(c: &str) -> bool {
    c.strip_prefix('#').is_some_and(|h| (3..=8).contains(&h.len()) && h.chars().all(|x| x.is_ascii_hexdigit()))
}

const S: char = '\u{1}';
pub fn file_ref(file: &str) -> String {
    format!("f{S}{file}")
}
pub fn scene_ref(file: &str, scene: &str) -> String {
    format!("s{S}{file}{S}{scene}")
}
pub fn row_ref(file: &str, key: &str) -> String {
    format!("r{S}{file}{S}{key}")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    File,
    Scene,
    Row,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedRef {
    pub kind: RefKind,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}
pub fn parse_ref(r: &str) -> Option<ParsedRef> {
    let p: Vec<&str> = r.split(S).collect();
    if p[0] == "f" && p.len() == 2 {
        return Some(ParsedRef { kind: RefKind::File, file: p[1].into(), key: None });
    }
    if (p[0] == "s" || p[0] == "r") && p.len() == 3 {
        return Some(ParsedRef { kind: if p[0] == "s" { RefKind::Scene } else { RefKind::Row }, file: p[1].into(), key: Some(p[2].into()) });
    }
    None
}

/// Короткий стабільний хеш тексту (32-бітний FNV-1a у base36): досить, щоб помітити, що оригінал рядка змінився.
pub fn hash_text(text: &str) -> String {
    js::hash_text(text)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RowRef {
    pub file: String,
    pub key: String,
}

fn parse_groups(p: &GroupData) -> Vec<Group> {
    p.groups.iter().flat_map(|m| m.values()).filter_map(|v| serde_json::from_value::<Group>(v.clone()).ok()).collect()
}

/// Групи, що існують, у порядку створення.
pub fn live_groups(p: &GroupData) -> Vec<Group> {
    let mut v: Vec<Group> = parse_groups(p).into_iter().filter(|g| g.del != Some(true)).collect();
    v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| locale_compare_uk(&a.name, &b.name)));
    v
}

fn same_name(a: &str, b: &str) -> bool {
    js::trim(a).to_lowercase() == js::trim(b).to_lowercase()
}

/// `name.trim().replace(/\s+/g, ' ')`.
fn tidy(name: &str) -> String {
    let mut out = String::new();
    let mut in_space = false;
    for c in js::trim(name).chars() {
        if js::is_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// Створює групу (чи повертає ту, що вже має цю назву). None для порожньої назви.
pub fn create_group(p: &mut GroupData, name: &str, now: i64, color: Option<&str>, rand_suffix: &str) -> Option<Group> {
    let n = tidy(name);
    if n.is_empty() {
        return None;
    }
    let live = live_groups(p);
    if let Some(had) = live.iter().find(|g| same_name(&g.name, &n)) {
        return Some(had.clone());
    }
    let used: HashSet<Option<String>> = live.iter().map(|g| g.color.clone()).collect();
    let id = format!("g{}{rand_suffix}", js::base36(now as u64));
    let color = color.map(String::from).or_else(|| GROUP_COLORS.iter().find(|c| !used.contains(&Some((**c).to_string()))).map(|c| c.to_string())).unwrap_or_else(|| GROUP_COLORS[live.len() % GROUP_COLORS.len()].to_string());
    let g = Group { id: id.clone(), name: n, color: Some(color), at: now, mt: now, del: None };
    p.groups.get_or_insert_with(Map::new).insert(id, serde_json::to_value(&g).unwrap());
    Some(g)
}

fn group_obj<'a>(p: &'a mut GroupData, id: &str) -> Option<&'a mut Map<String, Value>> {
    let g = p.groups.as_mut()?.get_mut(id)?.as_object_mut()?;
    if g.get("del").and_then(|d| d.as_bool()) == Some(true) { None } else { Some(g) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RenameResult {
    Ok,
    Empty,
    Exists,
    Missing,
}

pub fn rename_group(p: &mut GroupData, id: &str, name: &str, now: i64) -> RenameResult {
    if p.groups.as_ref().and_then(|g| g.get(id)).and_then(|g| g.as_object()).is_none_or(|g| g.get("del").and_then(|d| d.as_bool()) == Some(true)) {
        return RenameResult::Missing;
    }
    let n = tidy(name);
    if n.is_empty() {
        return RenameResult::Empty;
    }
    if live_groups(p).iter().any(|x| x.id != id && same_name(&x.name, &n)) {
        return RenameResult::Exists;
    }
    let g = group_obj(p, id).unwrap();
    g.insert("name".into(), json!(n));
    g.insert("mt".into(), json!(now));
    RenameResult::Ok
}

pub fn recolor_group(p: &mut GroupData, id: &str, color: &str, now: i64) -> bool {
    let Some(g) = group_obj(p, id) else { return false };
    g.insert("color".into(), json!(color));
    g.insert("mt".into(), json!(now));
    true
}

/// Видалити групу. Її рядки лишаються де були (просто не належать жодній групі); її члени відкидаються.
pub fn delete_group(p: &mut GroupData, id: &str, now: i64) -> bool {
    let Some(g) = group_obj(p, id) else { return false };
    g.insert("del".into(), json!(true));
    g.insert("mt".into(), json!(now));
    if let Some(members) = p.members.as_mut() {
        for m in members.values_mut() {
            if let Some(m) = m.as_object_mut() {
                if m.get("g").and_then(|g| g.as_str()) == Some(id) && m.get("del").and_then(|d| d.as_bool()) != Some(true) {
                    m.insert("del".into(), json!(true));
                    m.insert("mt".into(), json!(now));
                }
            }
        }
    }
    true
}

/// Хто які рядки покриває: будується раз із членів, потім питається про будь-який рядок.
pub struct GroupIndex {
    rows: HashMap<String, String>,
    scenes: HashMap<String, String>,
    files: HashMap<String, String>,
    pub empty: bool,
}
impl GroupIndex {
    pub fn new(p: &GroupData) -> GroupIndex {
        let live: HashSet<String> = live_groups(p).into_iter().map(|g| g.id).collect();
        let (mut rows, mut scenes, mut files) = (HashMap::new(), HashMap::new(), HashMap::new());
        let mut any = false;
        for (r, m) in p.members.iter().flatten() {
            let Some(m) = m.as_object() else { continue };
            let g = m.get("g").and_then(|g| g.as_str()).unwrap_or("");
            // член видаленої групи чи взятий назад нічого не каже: рядок іде за тим, що поза ним
            if m.get("del").and_then(|d| d.as_bool()) == Some(true) || (!g.is_empty() && !live.contains(g)) {
                continue;
            }
            let Some(pr) = parse_ref(r) else { continue };
            any = true;
            match pr.kind {
                RefKind::Row => rows.insert(format!("{}{S}{}", pr.file, pr.key.unwrap()), g.to_string()),
                RefKind::Scene => scenes.insert(format!("{}{S}{}", pr.file, pr.key.unwrap()), g.to_string()),
                RefKind::File => files.insert(pr.file, g.to_string()),
            };
        }
        GroupIndex { rows, scenes, files, empty: !any }
    }

    /// Група, в якій рядок (найближчий член перемагає), або None. `skip_row` ігнорує власного члена рядка (за чим він ішов би без нього).
    pub fn group_of(&self, file: &str, key: &str, skip_row: bool) -> Option<String> {
        if self.empty {
            return None;
        }
        let own = if skip_row { None } else { self.rows.get(&format!("{file}{S}{key}")) };
        if let Some(o) = own {
            return Some(o.clone()).filter(|s| !s.is_empty());
        }
        let s = scene_key(key).and_then(|sc| self.scenes.get(&format!("{file}{S}{sc}")));
        if let Some(s) = s {
            return Some(s.clone()).filter(|s| !s.is_empty());
        }
        self.files.get(file).cloned().filter(|s| !s.is_empty())
    }
}

/// Рядки кожної групи в порядку файлів і рядків.
pub fn group_rows(p: &GroupData, views: &[FileView]) -> IndexMap<String, Vec<RowRef>> {
    let idx = GroupIndex::new(p);
    let mut out: IndexMap<String, Vec<RowRef>> = IndexMap::new();
    if idx.empty {
        return out;
    }
    for v in views {
        for u in &v.units {
            if let Some(g) = idx.group_of(&v.name, &u.key, false) {
                out.entry(g).or_default().push(RowRef { file: v.name.clone(), key: u.key.clone() });
            }
        }
    }
    out
}

pub fn rows_of_group(p: &GroupData, views: &[FileView], id: &str) -> Vec<RowRef> {
    group_rows(p, views).shift_remove(id).unwrap_or_default()
}

fn member_set(members: &mut Map<String, Value>, key: &str, value: Value) {
    members.insert(key.to_string(), value);
}
fn with_del(m: &Value, now: i64) -> Value {
    let mut o = m.as_object().cloned().unwrap_or_default();
    o.insert("del".into(), json!(true));
    o.insert("mt".into(), json!(now));
    Value::Object(o)
}
fn is_del(m: &Value) -> bool {
    m.get("del").and_then(|d| d.as_bool()) == Some(true)
}

/// Кладе рядки в групу (чи, з `id` None, поза будь-яку групу). Рядок дістає власного члена, лише коли не йде за правильним місцем
/// через сцену чи файл, тож група з цілих сцен лишається кількома рядками даних. Повертає, скільки рядків змінилося.
pub fn place_rows(p: &mut GroupData, views: &[FileView], rows: &[RowRef], id: Option<&str>, now: i64) -> usize {
    let idx = GroupIndex::new(p);
    let want = id.unwrap_or("");
    let members = p.members.get_or_insert_with(Map::new);
    let mut n = 0;
    for r in rows {
        if idx.group_of(&r.file, &r.key, false).unwrap_or_default() == want {
            continue;
        }
        let rf = row_ref(&r.file, &r.key);
        let had = members.get(&rf).cloned();
        if idx.group_of(&r.file, &r.key, true).unwrap_or_default() == want {
            if let Some(h) = had.filter(|h| !is_del(h)) {
                member_set(members, &rf, with_del(&h, now));
            }
        } else {
            let u: Option<&Unit> = views.iter().find(|v| v.name == r.file).and_then(|v| v.units.iter().find(|u| u.key == r.key));
            let mut m = Map::new();
            m.insert("g".into(), json!(want));
            m.insert("mt".into(), json!(now));
            if let Some(u) = u {
                m.insert("h".into(), json!(hash_text(&u.source)));
            }
            member_set(members, &rf, Value::Object(m));
        }
        n += 1;
    }
    n
}

/// Кладе цілу сцену в групу: сцена сама дістає члена, а рядки в ній, покладені поодинці, відпускаються.
pub fn place_scene(p: &mut GroupData, file: &str, scene: &str, id: Option<&str>, now: i64) {
    let members = p.members.get_or_insert_with(Map::new);
    member_set(members, &scene_ref(file, scene), json!({ "g": id.unwrap_or(""), "mt": now }));
    let prefix = format!("{scene}[");
    let snapshot: Vec<(String, Value)> = members.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (r, m) in snapshot {
        if let Some(pr) = parse_ref(&r) {
            if pr.kind == RefKind::Row && pr.file == file && pr.key.as_deref().is_some_and(|k| k.starts_with(&prefix)) && !is_del(&m) {
                member_set(members, &r, with_del(&m, now));
            }
        }
    }
}

/// Кладе цілий файл у групу: його сцени й рядки, покладені окремо, відпускаються.
pub fn place_file(p: &mut GroupData, file: &str, id: Option<&str>, now: i64) {
    let members = p.members.get_or_insert_with(Map::new);
    member_set(members, &file_ref(file), json!({ "g": id.unwrap_or(""), "mt": now }));
    let snapshot: Vec<(String, Value)> = members.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (r, m) in snapshot {
        if let Some(pr) = parse_ref(&r) {
            if pr.kind != RefKind::File && pr.file == file && !is_del(&m) {
                member_set(members, &r, with_del(&m, now));
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OrphanWhy {
    Gone,
    Changed,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Orphan {
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub kind: RefKind,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub group: String,
    pub why: OrphanWhy,
}

/// Члени, чиє місце гра вже не має (чи чий оригінал змінився): показуються перекладачеві, ніколи не відкидаються тихо.
pub fn find_orphans(p: &GroupData, views: &[FileView]) -> Vec<Orphan> {
    let mut out = Vec::new();
    let live: HashSet<String> = live_groups(p).into_iter().map(|g| g.id).collect();
    let by_name: HashMap<&str, &FileView> = views.iter().map(|v| (v.name.as_str(), v)).collect();
    let mut scenes_of: HashMap<String, HashSet<String>> = HashMap::new();
    for (r, m) in p.members.iter().flatten() {
        let Some(mo) = m.as_object() else { continue };
        let g = mo.get("g").and_then(|g| g.as_str()).unwrap_or("");
        if is_del(m) || g.is_empty() || !live.contains(g) {
            continue;
        }
        let Some(pr) = parse_ref(r) else { continue };
        let mut orphan = |why| out.push(Orphan { r#ref: r.clone(), kind: pr.kind, file: pr.file.clone(), key: pr.key.clone(), group: g.to_string(), why });
        let Some(v) = by_name.get(pr.file.as_str()) else {
            orphan(OrphanWhy::Gone);
            continue;
        };
        match pr.kind {
            RefKind::File => {}
            RefKind::Scene => {
                let s = scenes_of.entry(pr.file.clone()).or_insert_with(|| build_scene_index(&v.units).map(|i| i.scenes.into_iter().map(|x| x.id).collect()).unwrap_or_default());
                if !s.contains(pr.key.as_deref().unwrap_or("")) {
                    orphan(OrphanWhy::Gone);
                }
            }
            RefKind::Row => match v.units.iter().find(|u| Some(u.key.as_str()) == pr.key.as_deref()) {
                None => orphan(OrphanWhy::Gone),
                Some(u) => {
                    if mo.get("h").and_then(|h| h.as_str()).is_some_and(|h| !h.is_empty() && h != hash_text(&u.source)) {
                        orphan(OrphanWhy::Changed);
                    }
                }
            },
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RowsProgress {
    pub total: usize,
    pub translated: usize,
    pub done: usize,
    pub approved: usize,
}

/// Як далеко просунувся набір рядків (так, як `stats_of` для файлу).
pub fn rows_progress(rows: &[RowRef], files: &SavedFiles) -> RowsProgress {
    let mut p = Progress::default();
    for r in rows {
        count_row(&mut p, files.get(&r.file).and_then(|f| f.get(&r.key)));
    }
    RowsProgress { total: p.total, translated: p.translated, done: p.sent, approved: p.approved }
}

/// Набір рядків, зроблений застосунком з даних гри, ніколи не зберігається (показується поряд із групами перекладача).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AutoGroup {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<String>,
    pub rows: Vec<RowRef>,
}

/// Рядки, згруповані за мовцем (відомі мовці), найрозмовніший першим.
pub fn group_by_speaker(views: &[FileView], speakers: SpeakerMap) -> Vec<AutoGroup> {
    let mut by: IndexMap<String, Vec<RowRef>> = IndexMap::new();
    for v in views {
        for u in &v.units {
            if !matches!(u.kind, crate::model::UnitKind::Dialogue | crate::model::UnitKind::Choice | crate::model::UnitKind::Scroll) {
                continue;
            }
            let who = speaker_of(&SpeakerRow { speaker: &u.speaker, face: u.face.as_deref(), event: u.event.as_deref(), note: u.note.as_deref(), source: Some(&u.source) }, speakers);
            if who.is_empty() {
                continue;
            }
            by.entry(who).or_default().push(RowRef { file: v.name.clone(), key: u.key.clone() });
        }
    }
    let mut out: Vec<AutoGroup> = by.into_iter().map(|(name, rows)| AutoGroup { id: format!("a:speaker:{name}"), name, sub: None, rows }).collect();
    out.sort_by(|a, b| b.rows.len().cmp(&a.rows.len()).then_with(|| locale_compare_uk(&a.name, &b.name)));
    out
}

/// Сцени кожного файлу в порядку файлів (файли без сцен нічого не дають).
pub fn group_by_scene(views: &[FileView]) -> Vec<AutoGroup> {
    let mut out = Vec::new();
    for v in views {
        let Some(idx) = build_scene_index(&v.units) else { continue };
        for sc in &idx.scenes {
            let sub = v.label.clone().filter(|l| !l.is_empty()).unwrap_or_else(|| v.name.strip_suffix(".json").unwrap_or(&v.name).to_string());
            let name = match sc.page {
                Some(p) if sc.pages > 1 && p > 0 => format!("{} · сторінка {p}", sc.title),
                _ => sc.title.clone(),
            };
            out.push(AutoGroup { id: format!("a:scene:{}{S}{}", v.name, sc.id), name, sub: Some(sub), rows: sc.units.iter().map(|u| RowRef { file: v.name.clone(), key: u.key.clone() }).collect() });
        }
    }
    out
}

/// Два записи про групи й членів: по елементу перемагає новіший, а старше за останнє скидання відкидається.
pub fn merge_mt_records(x: Option<&Map<String, Value>>, y: Option<&Map<String, Value>>, epoch: i64) -> Option<Map<String, Value>> {
    if x.is_none() && y.is_none() {
        return None;
    }
    let mt = |v: &Value| v.get("mt").and_then(|m| m.as_f64());
    let mut out: Map<String, Value> = Map::new();
    for src in [x, y].into_iter().flatten() {
        for (k, v) in src {
            let newer = mt(v).is_some_and(|m| m > epoch as f64) && out.get(k).is_none_or(|o| mt(v).unwrap_or(f64::NAN) > mt(o).unwrap_or(f64::NAN));
            if newer {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

/// Групи й члени двох копій: `(groups, members)`.
#[allow(clippy::type_complexity)]
pub fn merge_group_data(a: (Option<&Map<String, Value>>, Option<&Map<String, Value>>), b: (Option<&Map<String, Value>>, Option<&Map<String, Value>>), epoch: i64) -> (Option<Map<String, Value>>, Option<Map<String, Value>>) {
    (merge_mt_records(a.0, b.0, epoch), merge_mt_records(a.1, b.1, epoch))
}
