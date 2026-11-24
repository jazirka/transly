//! `journal.ts`: журнал масових дій. Кожен рядок, якого торкнулася дія, дістає запис в історії з id дії (`batch`) і тим,
//! чим рядок був до неї (`prev`). З цього всю дію можна показати, скасувати й повторити без окремого стеку скасування:
//! дані живуть у рядках і їдуть із проєктом.
//!
//! Відмінність від TS: випадкова частина id дії (`Math.random`) приходить ззовні (`Rand`), щоб тести були відтворювані;
//! `system_rand()` дає звичайне джерело.

use crate::js;
use crate::model::{Entry, HistoryItem, Prev, Status, Translations};
use crate::plural::rows;
use crate::workflow::HISTORY_LIMIT;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub use crate::project::FileView;
/// Переклади проєкту по файлах (`SavedProject.files`).
pub type SavedFiles = IndexMap<String, Translations>;

/// Джерело випадкових чисел 0..46656 для id дії.
pub type Rand<'a> = &'a mut dyn FnMut() -> u32;

/// Просте джерело (xorshift, зерно — час). Для тестів передається своє.
pub fn system_rand() -> impl FnMut() -> u32 {
    let mut x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(88172645463325252, |d| d.as_nanos() as u64) | 1;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        ((x >> 11) % 46656) as u32
    }
}

/// Що таке масова дія: слово до двокрапки в id; текст в історії й заголовок у стрічці.
pub const BATCH_KINDS: [&str; 22] = ["edit", "send", "approve", "scene", "words", "twin", "replace", "unify", "memory", "wrap", "clear", "copy", "back", "autofill", "link", "term", "fix", "reconcile", "rekey", "merge", "undo", "redo"];

/// (текст в історії, початок заголовка; заголовок — `{початок}: {n}`).
pub fn batch_info(kind: &str) -> Option<(&'static str, &'static str)> {
    Some(match kind {
        "edit" => ("змінено переклад", "Змінено переклад"),
        "send" => ("надіслано", "Надіслано"),
        "approve" => ("вичитано", "Вичитано"),
        "scene" => ("надіслано (вся сцена)", "Надіслано сцену"),
        "words" => ("автозаповнено за словами", "Автозаповнення за словами"),
        "twin" => ("підставлено з однакового рядка", "Підставлено з однакових рядків"),
        "replace" => ("знайти й замінити", "Знайдено й замінено"),
        "unify" => ("узгоджено з іншими", "Узгоджено переклади"),
        "memory" => ("підставлено з пам’яті перекладів", "Підставлено з пам’яті"),
        "wrap" => ("перенесено рядки", "Перенесено рядки"),
        "clear" => ("очищено переклад", "Очищено переклади"),
        "copy" => ("вставлено оригінал", "Вставлено оригінал"),
        "back" => ("повернуто на доопрацювання", "Повернуто на доопрацювання"),
        "autofill" => ("автозаповнено", "Автозаповнення"),
        "link" => ("автозаповнено з однакового рядка", "Автозаповнення з однакових рядків"),
        "term" => ("змінено термін", "Змінено переклад терміна"),
        "fix" => ("виправлено за правилом", "Виправлено за правилом"),
        "reconcile" => ("оригінал змінився: повернуто в чернетки", "Оригінал змінився, повернуто в чернетки"),
        "rekey" => ("зіставлено з новою версією гри", "Переклади зіставлено з новою версією гри"),
        "merge" => ("злито з іншої гілки", "Злито з іншої гілки"),
        "undo" => ("скасовано", "Скасовано дію"),
        "redo" => ("повторено", "Повторено дію"),
        _ => return None,
    })
}
/// Заголовок дії у стрічці для відомого виду.
pub fn batch_title_of(kind: &str, n: &str) -> Option<String> {
    batch_info(kind).map(|(_, t)| format!("{t}: {n}"))
}

pub fn prev_of(e: Option<&Entry>) -> Prev {
    Prev { target: e.map_or(String::new(), |e| e.target.clone()), status: e.map_or(Status::New, |e| e.status), returned: e.filter(|e| e.returned == Some(true)).map(|_| true) }
}

fn rand3(rand: Rand) -> String {
    format!("{:0>3}", js::base36(rand() as u64))
}

/// Новий id масової дії: `send:lq3k2a9fx2a`.
pub fn new_batch(kind: &str, now: i64, rand: Rand) -> String {
    format!("{kind}:{}{}", js::base36(now as u64), rand3(rand))
}
pub fn kind_of_batch(id: &str) -> &str {
    match id.find(':') {
        Some(i) => &id[..i],
        None => "",
    }
}

/// Рядок після зміни з записом в історії: що зроблено, з яким текстом і чим був до цього. `after` — новий стан, `batch` в'яже запис із дією.
pub fn record_change(before: Option<&Entry>, after: &Entry, what: &str, text: &str, who: &str, now: i64, batch: Option<&str>) -> Entry {
    // пристрій із відстаючим годинником усе одно робить правку новішою (і запис датовано нею, тож рядок вважається недоторканим)
    let mt = match before {
        Some(b) if after.mt < b.mt => b.mt + 1,
        _ => after.mt,
    };
    let rec = HistoryItem { at: now.max(mt), who: who.into(), what: what.into(), text: text.into(), batch: batch.map(String::from), prev: Some(prev_of(before)), extra: Default::default() };
    let mut history: Vec<HistoryItem> = after.history.clone().or_else(|| before.and_then(|b| b.history.clone())).unwrap_or_default();
    history.push(rec);
    if history.len() > HISTORY_LIMIT {
        history.drain(..history.len() - HISTORY_LIMIT);
    }
    Entry { mt, history: Some(history), ..after.clone() }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JournalItem {
    pub file: String,
    pub key: String,
    pub source: String,
    pub target: String,
    pub at: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JournalBatch {
    pub id: String,
    pub kind: String,
    pub at: i64,
    /// Рядки, що досі такі, якими їх лишила дія: лише їх можна скасувати.
    pub items: Vec<JournalItem>,
    /// Усі рядки із записом про дію, також змінені потім (наскільки сягає їхня історія).
    pub total: usize,
    pub what: String,
}

/// Чи рядок досі такий, яким його лишив запис? Набір тексту запису в історію не робить, але зсуває `mt` за час останнього
/// запису, тож пізніше правлений рядок не скасовується (стерло б набране).
pub fn untouched(e: &Entry, rec: &HistoryItem) -> bool {
    e.mt <= rec.at
}

/// Скільки найновіших записів історії рядка перебирається в пошуку дії.
const DEPTH: usize = 8;

/// Масові дії, які ще можна скасувати, найновіші першими. Рядок належить дії, доки її запис — найновіший в його історії.
pub fn journal_batches(views: &[FileView], saved: &SavedFiles, limit: usize) -> Vec<JournalBatch> {
    let mut by: IndexMap<String, JournalBatch> = IndexMap::new();
    for v in views {
        let Some(ents) = saved.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            let Some(h) = e.history.as_ref().filter(|h| !h.is_empty()) else { continue };
            let last_i = h.len() - 1;
            let mut seen: Vec<&str> = Vec::new();
            let lo = h.len().saturating_sub(DEPTH);
            for i in (lo..h.len()).rev() {
                let rec = &h[i];
                let Some(batch) = rec.batch.as_deref().filter(|b| !b.is_empty()) else { continue };
                if seen.contains(&batch) {
                    continue;
                }
                seen.push(batch);
                let b = by.entry(batch.to_string()).or_insert_with(|| JournalBatch { id: batch.to_string(), kind: kind_of_batch(batch).to_string(), at: rec.at, items: Vec::new(), total: 0, what: rec.what.clone() });
                b.total += 1;
                b.at = b.at.max(rec.at);
                if i == last_i && rec.prev.is_some() && untouched(e, rec) {
                    b.items.push(JournalItem { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target: e.target.clone(), at: rec.at });
                }
            }
        }
    }
    let mut v: Vec<JournalBatch> = by.into_values().filter(|b| !b.items.is_empty()).collect();
    v.sort_by_key(|a| std::cmp::Reverse(a.at));
    v.truncate(limit);
    v
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UndoResult {
    pub done: usize,
    pub skipped: usize,
    pub kind: String,
    /// Id нової дії, що записує скасування (скасуйте її, щоб повторити).
    pub batch: String,
}

/// Скасувати дію (а для скасування — повторити): кожен рядок, що досі такий, яким його лишила дія, повертається до того, чим був,
/// а повернення саме стає дією в журналі. `skipped` — рядки, змінені потім, вони лишаються як є.
pub fn undo_journal(saved: &mut SavedFiles, id: &str, who: &str, now: i64, rand: Rand) -> UndoResult {
    let kind = if kind_of_batch(id) == "undo" { "redo" } else { "undo" };
    let batch = new_batch(kind, now, rand);
    let (mut done, mut total) = (0usize, 0usize);
    for ents in saved.values_mut() {
        let keys: Vec<String> = ents.keys().cloned().collect();
        for key in keys {
            let e = ents[&key].clone();
            let Some(h) = e.history.as_ref().filter(|h| !h.is_empty()) else { continue };
            let lo = h.len().saturating_sub(DEPTH);
            if !(lo..h.len()).any(|i| h[i].batch.as_deref() == Some(id)) {
                continue;
            }
            total += 1;
            let last = &h[h.len() - 1];
            let Some(prev) = last.prev.as_ref().filter(|_| last.batch.as_deref() == Some(id) && untouched(&e, last)) else { continue };
            let mut restored = Entry { target: prev.target.clone(), status: prev.status, returned: Some(prev.returned == Some(true)), mt: now, ..e.clone() };
            if restored.target.is_empty() {
                restored.orig = None;
            }
            let base = ["скасовано: ", "повторено: "].iter().find_map(|p| last.what.strip_prefix(p)).unwrap_or(&last.what);
            let what = format!("{}: {base}", batch_info(kind).unwrap().0);
            let target = restored.target.clone();
            ents.insert(key, record_change(Some(&e), &restored, &what, &target, who, now, Some(&batch)));
            done += 1;
        }
    }
    UndoResult { done, skipped: total - done, kind: kind_of_batch(id).to_string(), batch }
}

/// Зміна одного рядка в плані.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RowChange {
    pub file: String,
    pub key: String,
    /// Рядок таким, яким він має стати після дії (зроблений `edit`, `submit`…).
    pub next: Entry,
    /// Що показує історія для цього рядка (зазвичай новий переклад).
    pub text: String,
    /// Власне формулювання запису, коли воно відрізняється від дії (наприклад, оцінка збігу в пам'яті).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub what: Option<String>,
}

/// Записати багато рядків однією дією. Повертає id дії, який `undo_journal` скасовує.
pub fn commit_rows(entries: &mut SavedFiles, changes: &[RowChange], kind: &str, who: &str, now: i64, what: Option<&str>, rand: Rand) -> String {
    let batch = new_batch(kind, now, rand);
    let default = batch_info(kind).map_or("", |i| i.0);
    let what = what.unwrap_or(default);
    for c in changes {
        let ents = entries.entry(c.file.clone()).or_default();
        let next = record_change(ents.get(&c.key), &c.next, c.what.as_deref().unwrap_or(what), &c.text, who, now, Some(&batch));
        ents.insert(c.key.clone(), next);
    }
    batch
}

fn cap(t: &str) -> String {
    let mut it = t.chars();
    match it.next() {
        Some(c) => c.to_uppercase().collect::<String>() + it.as_str(),
        None => String::new(),
    }
}

/// Рядок стрічки: що зроблено й з якою кількістю рядків.
pub fn batch_title(b: &JournalBatch) -> String {
    let n = rows(b.items.len() as i64);
    if b.kind == "undo" || b.kind == "redo" {
        let mut parts = b.what.split(": ");
        let verb = parts.next().unwrap_or(&b.what);
        let rest: Vec<&str> = parts.collect();
        return format!("{} «{}»: {n}", cap(verb), rest.join(": "));
    }
    match batch_title_of(&b.kind, &n) {
        Some(t) => t,
        None => format!("{}: {n}", cap(&b.what)),
    }
}

/// Що написано на кнопці скасування: скасування повторюється, решта скасовується.
pub fn batch_undo_label(b: &JournalBatch) -> &'static str {
    if b.kind == "undo" { "Повторити" } else { "Скасувати" }
}

/// Речення після скасування: скільки рядків повернулося й скільки змінено потім і лишилося.
pub fn undo_report(r: &UndoResult) -> String {
    let n = rows(r.done as i64);
    let head = if r.kind == "undo" {
        format!("Повторено: {n}")
    } else {
        match batch_info(&r.kind) {
            Some((what, _)) => format!("Скасовано «{what}»: {n}"),
            None => format!("Скасовано: {n}"),
        }
    };
    if r.skipped > 0 { format!("{head}. Ще {} змінено після дії, їх не чіпав", rows(r.skipped as i64)) } else { head }
}
