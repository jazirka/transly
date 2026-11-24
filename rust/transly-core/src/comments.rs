//! `comments.ts`: обговорення рядка гілками: коментар, що відкриває розмову (корінь), і відповіді на нього в порядку написання.
//! Гілку можна закрити й відкрити знову; коментар може змінити автор і видалити. Ніщо з цього не змінює переклад,
//! тож годинник рядка (`mt`) не рухається.

use crate::model::{Comment, CommentRes, Entry};
use crate::workflow::{add_comment, comment_id};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Closed {
    pub who: String,
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Thread {
    /// Id кореневого коментаря: відповіді вказують на нього.
    pub id: String,
    pub root: Comment,
    pub replies: Vec<Comment>,
    pub resolved: bool,
    /// Хто закрив гілку й коли, поки вона закрита.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<Closed>,
    /// Час найновішого коментаря гілки (правка рахується).
    pub last: i64,
}

pub fn is_deleted(c: &Comment) -> bool {
    c.del == Some(true)
}

/// Коментар закритий, коли його найновіша позначка не «відкрито знову».
pub fn is_resolved(c: &Comment) -> bool {
    c.res.as_ref().is_some_and(|r| r.open != Some(true))
}

/// Коментарі, що ще є (не видалені).
pub fn live_comments(comments: Option<&[Comment]>) -> Vec<Comment> {
    comments.unwrap_or(&[]).iter().filter(|c| !is_deleted(c)).cloned().collect()
}

/// Гілки рядка, найстаріші першими. Відповідь на відповідь належить гілці першого коментаря; відповідь, чийого коментаря нема
/// (видалено чи не дійшов на цей пристрій), показується власною гілкою, а не ховається.
pub fn threads_of(comments: Option<&[Comment]>) -> Vec<Thread> {
    let live = live_comments(comments);
    let by_id: HashMap<String, &Comment> = live.iter().map(|c| (comment_id(c), c)).collect();
    let root_of = |c: &Comment| -> String {
        let (mut cur, mut id) = (c, comment_id(c));
        let mut seen: HashSet<String> = HashSet::new();
        while let Some(re) = cur.re.as_deref().filter(|r| !r.is_empty()) {
            if seen.contains(&id) {
                break;
            }
            seen.insert(id.clone());
            let Some(parent) = by_id.get(re) else { break };
            cur = parent;
            id = comment_id(parent);
        }
        id
    };
    // спершу корені, потім відповіді: відповідь з пристрою, чий годинник відстає, може бути старшою за коментар, на який відповідає
    let mut sorted: Vec<&Comment> = live.iter().collect();
    sorted.sort_by_key(|c| c.at);
    let mut threads: indexmap::IndexMap<String, Thread> = indexmap::IndexMap::new();
    let root_ids: Vec<String> = sorted.iter().map(|c| root_of(c)).collect();
    for (c, id) in sorted.iter().zip(&root_ids) {
        if *id == comment_id(c) {
            let by = if is_resolved(c) { c.res.as_ref().map(|r| Closed { who: r.who.clone(), at: r.at }) } else { None };
            threads.insert(id.clone(), Thread { id: id.clone(), root: (*c).clone(), replies: vec![], resolved: is_resolved(c), by, last: c.ed.unwrap_or(c.at) });
        }
    }
    for (c, id) in sorted.iter().zip(&root_ids) {
        if *id == comment_id(c) {
            continue;
        }
        if let Some(t) = threads.get_mut(id) {
            t.replies.push((*c).clone());
            t.last = t.last.max(c.ed.unwrap_or(c.at));
        }
    }
    threads.into_values().collect()
}

/// Скільки гілок чекає відповіді чи рішення.
pub fn open_threads(e: Option<&Entry>) -> usize {
    threads_of(e.and_then(|e| e.comments.as_deref())).iter().filter(|t| !t.resolved).count()
}

fn map_comment(e: &Entry, id: &str, f: impl Fn(Comment) -> Comment) -> Entry {
    let Some(list) = e.comments.as_ref().filter(|l| l.iter().any(|c| comment_id(c) == id)) else { return e.clone() };
    // id записується першим: для старих коментарів його виведено з тексту, і правка не повинна його змінити
    let comments = list
        .iter()
        .map(|c| {
            if comment_id(c) == id {
                let mut c = c.clone();
                c.id = Some(comment_id(&c));
                f(c)
            } else {
                c.clone()
            }
        })
        .collect();
    Entry { comments: Some(comments), ..e.clone() }
}

/// Відповісти на коментар: відповідь долучається до гілки, якій належить коментар.
pub fn reply_to(e: Option<&Entry>, parent_id: &str, who: &str, text: &str, now: i64) -> Entry {
    let root = e.and_then(|e| e.comments.as_deref()).and_then(|cs| threads_of(Some(cs)).into_iter().find(|t| t.id == parent_id || t.replies.iter().any(|r| comment_id(r) == parent_id)).map(|t| t.id));
    add_comment(e, who, text, now, Some(root.as_deref().unwrap_or(parent_id)))
}

/// Закрити гілку (`on`) або відкрити знову.
pub fn resolve_thread(e: &Entry, root_id: &str, on: bool, who: &str, now: i64) -> Entry {
    map_comment(e, root_id, |mut c| {
        c.res = Some(CommentRes { who: who.to_string(), at: now, open: if on { None } else { Some(true) } });
        c
    })
}

/// Змінити текст коментаря; час правки вирішує при злитті.
pub fn edit_comment(e: &Entry, id: &str, text: &str, now: i64) -> Entry {
    map_comment(e, id, |mut c| {
        c.text = text.to_string();
        c.ed = Some(now);
        c
    })
}

/// Видалити коментар: текст зникає, слід лишається, щоб злиття його не повернуло.
pub fn delete_comment(e: &Entry, id: &str, now: i64) -> Entry {
    map_comment(e, id, |mut c| {
        c.text = String::new();
        c.ed = Some(now);
        c.del = Some(true);
        c
    })
}
