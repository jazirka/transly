//! `inbox.ts`: що чекає перекладача, коротким списком: стани, що потребують уваги (помилки QA, ненадіслані чернетки, рядки
//! на вичитку, змінені оригінали) і що зробили інші, відколи перекладач востаннє дивився (їхні коментарі й робота).
//! Кожен пункт називає рядки, про які він, тож клік їх покаже.

use crate::groups::RowRef;
use crate::historyview::{activity_kind, ActivityKind};
use crate::merge::OTHER_DEVICE;
use crate::plural::plural;
use crate::progress::{row_state, RowState};
use crate::project::{FileView, SavedProject};
use crate::workflow::source_changed;
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InboxKind {
    Error,
    Draft,
    Unreviewed,
    Source,
    Replies,
    Others,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct InboxItem {
    pub id: String,
    pub kind: InboxKind,
    pub title: String,
    pub sub: String,
    pub rows: Vec<RowRef>,
    /// Пункти про те, що зробили інші, перестають бути новиною, коли їх позначено прочитаними.
    pub news: bool,
}

pub struct InboxInput<'a> {
    pub views: &'a [FileView],
    pub saved: &'a SavedProject,
    /// Хто перекладач: його власні коментарі й робота — не новини.
    pub who: &'a str,
    /// Коли перекладач востаннє позначав новини прочитаними.
    pub seen: i64,
    /// Рядки з помилкою QA в усьому проєкті (їх робить черга; це прохід QA по кожному рядку, тож викликач їх тримає).
    pub errors: Vec<RowRef>,
}

fn kind_word(k: ActivityKind) -> &'static str {
    match k {
        ActivityKind::Send => "надіслано",
        ActivityKind::Approve => "вичитано",
        ActivityKind::Restore => "відновлено",
        ActivityKind::Back => "повернуто",
        ActivityKind::Edit => "правок",
    }
}
const KIND_ORDER: [ActivityKind; 5] = [ActivityKind::Send, ActivityKind::Approve, ActivityKind::Restore, ActivityKind::Back, ActivityKind::Edit];

pub fn inbox_of(inp: &InboxInput) -> Vec<InboxItem> {
    let (mut draft, mut sent, mut source): (Vec<RowRef>, Vec<RowRef>, Vec<RowRef>) = (vec![], vec![], vec![]);
    let mut replies: IndexMap<String, Vec<RowRef>> = IndexMap::new();
    let mut others: IndexMap<String, (Vec<RowRef>, IndexMap<usize, usize>)> = IndexMap::new();
    for v in inp.views {
        let Some(ents) = inp.saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key) else { continue };
            let r = RowRef { file: v.name.clone(), key: u.key.clone() };
            match row_state(Some(e)) {
                RowState::Draft => draft.push(r.clone()),
                RowState::Sent => sent.push(r.clone()),
                _ => {}
            }
            if source_changed(Some(e), u) {
                source.push(r.clone());
            }
            let mut wrote: HashSet<&str> = HashSet::new();
            for c in e.comments.iter().flatten() {
                if c.del == Some(true) || c.who.is_empty() || c.who == inp.who || c.at <= inp.seen {
                    continue;
                }
                let list = replies.entry(c.who.clone()).or_default();
                if wrote.insert(c.who.as_str()) {
                    list.push(r.clone());
                }
            }
            let mut did: HashSet<&str> = HashSet::new();
            for h in e.history.iter().flatten() {
                if h.at == 0 || h.at <= inp.seen || h.who.is_empty() || h.who == inp.who || h.who == OTHER_DEVICE {
                    continue;
                }
                let o = others.entry(h.who.clone()).or_default();
                *o.1.entry(activity_kind(&h.what) as usize).or_insert(0) += 1;
                if did.insert(h.who.as_str()) {
                    o.0.push(r.clone());
                }
            }
        }
    }
    let mut out = Vec::new();
    if let Some(first) = inp.errors.first() {
        out.push(InboxItem {
            id: "error".into(),
            kind: InboxKind::Error,
            news: false,
            rows: inp.errors.clone(),
            title: plural(inp.errors.len() as i64, ["помилка QA", "помилки QA", "помилок QA"]),
            sub: format!("Перейти до першої · {} · {}", first.file, first.key),
        });
    }
    for (who, refs) in replies {
        out.push(InboxItem {
            id: format!("replies:{who}"),
            kind: InboxKind::Replies,
            news: true,
            title: format!("{who}: {}", plural(refs.len() as i64, ["новий коментар", "нові коментарі", "нових коментарів"])),
            sub: format!("у {}", plural(refs.len() as i64, ["рядку", "рядках", "рядках"])),
            rows: refs,
        });
    }
    for (who, (refs, kinds)) in others {
        let parts: Vec<String> = KIND_ORDER.iter().filter_map(|k| kinds.get(&(*k as usize)).filter(|n| **n > 0).map(|n| format!("{} {n}", kind_word(*k)))).collect();
        out.push(InboxItem { id: format!("others:{who}"), kind: InboxKind::Others, news: true, rows: refs, title: format!("Зміни від {who}"), sub: parts.join(" · ") });
    }
    if !sent.is_empty() {
        out.push(InboxItem {
            id: "unreviewed".into(),
            kind: InboxKind::Unreviewed,
            news: false,
            title: format!("{} вичитки", plural(sent.len() as i64, ["рядок чекає", "рядки чекають", "рядків чекають"])),
            sub: "надіслано, ще не вичитано".into(),
            rows: sent,
        });
    }
    if !draft.is_empty() {
        out.push(InboxItem { id: "draft".into(), kind: InboxKind::Draft, news: false, title: format!("{} не надіслано", plural(draft.len() as i64, ["чернетка", "чернетки", "чернеток"])), sub: "показати всі".into(), rows: draft });
    }
    if !source.is_empty() {
        out.push(InboxItem { id: "source".into(), kind: InboxKind::Source, news: false, title: format!("{}: оригінал змінився", plural(source.len() as i64, ["рядок", "рядки", "рядків"])), sub: "після оновлення гри".into(), rows: source });
    }
    out
}
