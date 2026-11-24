//! `workflow.ts`: правки, коментарі, ігнорування QA, повернення. `submit`/`approveEntry` залежать від QA й обгортання
//! (`qa.ts`, `wrap.ts`) і переносяться разом із ними.

use crate::js;
use crate::model::{next_mt, Comment, Entry, HistoryItem, Status, Translations, Unit};

pub const HISTORY_LIMIT: usize = 50;

/// Який прохід зараз: переклад чи вичитка.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Translate,
    Review,
}

fn keep_last<T>(v: &mut Vec<T>, n: usize) {
    if v.len() > n {
        v.drain(..v.len() - n);
    }
}

/// Додає запис в історію (не змінюючи вхід), лишаючи найновіші `HISTORY_LIMIT`.
pub fn note(e: &Entry, what: &str, text: &str, who: &str, now: i64) -> Entry {
    let mut history = e.history.clone().unwrap_or_default();
    history.push(HistoryItem { at: now, who: who.into(), what: what.into(), text: text.into(), batch: None, prev: None });
    keep_last(&mut history, HISTORY_LIMIT);
    Entry { history: Some(history), ..e.clone() }
}

/// Id коментаря: власний або виведений з автора, часу й тексту (у старих коментарів його немає).
pub fn comment_id(c: &Comment) -> String {
    match &c.id {
        Some(id) => id.clone(),
        None => format!("{}.{}", c.at, js::hash_text(&format!("{}\u{1}{}", c.who, c.text))),
    }
}

/// Додає коментар. Коментар — не зміна перекладу, тому `mt` лишається.
pub fn add_comment(e: Option<&Entry>, who: &str, text: &str, now: i64, reply_to: Option<&str>) -> Entry {
    let base = e.cloned().unwrap_or_else(Entry::blank);
    let c = Comment {
        who: who.into(),
        at: now,
        text: text.into(),
        id: Some(format!("{}.{}", now, js::hash_text(&format!("{}\u{1}{}", who, text)))),
        re: reply_to.filter(|r| !r.is_empty()).map(String::from),
        res: None,
        ed: None,
        del: None,
    };
    let mut comments = base.comments.clone().unwrap_or_default();
    comments.push(c);
    Entry { comments: Some(comments), ..base }
}

/// Ігнорувати (або перестати) одне попередження QA рядка. Має власний годинник і не чіпає `mt`.
pub fn set_ignored(e: &Entry, key: &str, on: bool, now: i64) -> Entry {
    let cur = e.ign.clone().unwrap_or_default();
    let ign: Vec<String> = if on {
        // `new Set([...cur, key])` лишає перше входження кожного значення
        let mut seen: Vec<String> = Vec::new();
        for k in cur.into_iter().chain(std::iter::once(key.to_string())) {
            if !seen.contains(&k) {
                seen.push(k);
            }
        }
        seen
    } else {
        cur.into_iter().filter(|k| k != key).collect()
    };
    Entry { ign: Some(ign), ign_at: Some(now), ..e.clone() }
}

/// Застосовує правку тексту й повертає новий запис.
pub fn edit(prev: Option<&Entry>, unit: &Unit, text: &str, stage: Stage, now: i64) -> Entry {
    let mut e = prev.cloned().unwrap_or_else(Entry::blank);
    e.target = text.into();
    e.src = Some(unit.source.clone());
    e.mt = next_mt(prev.map(|p| p.mt), now);
    if text.is_empty() {
        e.status = Status::New;
        e.returned = Some(false);
        return e;
    }
    // у проході перекладу будь-який завершений стан падає до чернетки; у вичитці лише новий рядок стає чернеткою
    let to_draft = match stage {
        Stage::Translate => matches!(e.status, Status::New | Status::Done | Status::Appr),
        Stage::Review => e.status == Status::New,
    };
    if to_draft {
        e.status = Status::Draft;
    }
    e
}

/// Вичитувач повертає рядок перекладачеві.
pub fn send_back(prev: &Entry, now: i64) -> Entry {
    Entry { status: Status::Draft, returned: Some(true), mt: next_mt(Some(prev.mt), now), ..prev.clone() }
}

/// Оригінал гри змінився після того, як переклад було написано.
pub fn source_changed(entry: Option<&Entry>, unit: &Unit) -> bool {
    match entry {
        Some(e) => !e.target.is_empty() && e.src.as_deref().is_some_and(|s| s != unit.source),
        None => false,
    }
}

/// Після повторного читання файлів гри: перекладені рядки зі зміненим оригіналом повертаються в чернетки.
/// Повертає ключі, які змінилися.
pub fn reconcile(units: &[Unit], entries: &mut Translations, now: i64) -> Vec<String> {
    let mut changed = Vec::new();
    for u in units {
        let Some(e) = entries.get(&u.key) else { continue };
        if !source_changed(Some(e), u) {
            continue;
        }
        changed.push(u.key.clone());
        if matches!(e.status, Status::Done | Status::Appr) {
            let next = Entry { status: Status::Draft, mt: next_mt(Some(e.mt), now), ..e.clone() };
            entries.insert(u.key.clone(), next);
        }
    }
    changed
}
