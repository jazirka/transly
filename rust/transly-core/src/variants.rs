//! `variants.ts`: внески до рядка (надіслані переклади), голоси й знімання внесків.

use crate::js;
use crate::model::{Drop, Entry, Status, Vote};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;

pub const VOTES_LIMIT: usize = 300;

/// Один внесок: переклад, що був надісланий, і хто надіслав першим.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Variant {
    pub id: String,
    pub who: String,
    pub at: i64,
    #[serde(rename = "sentAt")]
    pub sent_at: i64,
    pub text: String,
    pub current: bool,
    pub approved: bool,
}

/// Id внеску — хеш його тексту: той самий текст від іншого перекладача — той самий внесок, тож голоси лишаються з ним.
pub fn variant_id(text: &str) -> String {
    js::hash_text(text)
}

fn is_send(what: &str) -> bool {
    what.starts_with("надіслано") || what == "send"
}

/// Внески до рядка: по картці на кожен різний текст, найновіші першими.
pub fn sent_variants(e: Option<&Entry>) -> Vec<Variant> {
    let Some(e) = e else { return Vec::new() };
    let sent = matches!(e.status, Status::Done | Status::Appr);
    let mut out: Vec<Variant> = Vec::new();
    for h in e.history.as_deref().unwrap_or(&[]) {
        if !is_send(&h.what) || h.text.trim().is_empty() {
            continue;
        }
        if let Some(same) = out.iter_mut().find(|v| v.text == h.text) {
            same.sent_at = same.sent_at.max(h.at);
            continue;
        }
        out.push(Variant { id: variant_id(&h.text), who: h.who.clone(), at: h.at, sent_at: h.at, text: h.text.clone(), current: false, approved: false });
    }
    if sent && !e.target.trim().is_empty() {
        if let Some(own) = out.iter_mut().find(|v| v.text == e.target) {
            own.current = true;
            own.approved = e.status == Status::Appr;
        } else {
            let who = e.history.as_ref().and_then(|h| h.last()).map(|h| h.who.clone()).unwrap_or_default();
            out.push(Variant { id: variant_id(&e.target), who, at: e.mt, sent_at: e.mt, text: e.target.clone(), current: true, approved: e.status == Status::Appr });
        }
    }
    // внесок, знятий з картки, лишається знятим, доки його не надішлють знову (крім того, що рядок тримає зараз)
    let mut off: HashMap<&str, &Drop> = HashMap::new();
    for d in e.drops.as_deref().unwrap_or(&[]) {
        off.insert(d.on.as_str(), d);
    }
    let mut kept: Vec<Variant> = out
        .into_iter()
        .filter(|v| v.current || off.get(v.id.as_str()).is_none_or(|d| d.off.is_some() || v.sent_at > d.at))
        .collect();
    kept.reverse();
    kept
}

/// Ключ, під яким зберігається голос: один голос одного перекладача за один внесок.
pub fn vote_id(v: &Vote) -> String {
    format!("{}\u{1}{}", v.who, v.on)
}

/// З двох копій одного голосу — пізніша; за однакового часу — більша форма (щоб відповідь не залежала від порядку).
pub fn later_vote(a: &Vote, b: &Vote) -> bool {
    // true — береться b
    if a.at != b.at {
        b.at > a.at
    } else {
        js::cmp(&js::stringify(b), &js::stringify(a)) == Ordering::Greater
    }
}

pub fn by_vote(x: &Vote, y: &Vote) -> Ordering {
    x.at.cmp(&y.at).then_with(|| js::cmp(&vote_id(x), &vote_id(y)))
}

/// true — береться b.
pub fn later_drop(a: &Drop, b: &Drop) -> bool {
    if a.at != b.at {
        b.at > a.at
    } else {
        js::cmp(&js::stringify(b), &js::stringify(a)) == Ordering::Greater
    }
}

pub fn by_drop(x: &Drop, y: &Drop) -> Ordering {
    x.at.cmp(&y.at).then_with(|| js::cmp(&x.on, &y.on))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tally {
    pub up: u32,
    pub down: u32,
    /// Голос `who`: 1, -1 або 0.
    pub mine: i8,
}

pub fn tally_of(e: Option<&Entry>, id: &str, who: &str) -> Tally {
    let mut t = Tally { up: 0, down: 0, mine: 0 };
    for v in e.and_then(|e| e.votes.as_deref()).unwrap_or(&[]) {
        if v.on != id {
            continue;
        }
        if v.v == 1 {
            t.up += 1;
        } else if v.v == -1 {
            t.down += 1;
        }
        if v.who == who {
            t.mine = v.v;
        }
    }
    t
}

fn last_n<T>(mut v: Vec<T>, n: usize) -> Vec<T> {
    if v.len() > n {
        v.drain(..v.len() - n);
    }
    v
}

/// `who` голосує `v` за внесок `id`; той самий голос ще раз — знімає його. `mt` не змінюється.
pub fn cast_vote(e: &Entry, id: &str, who: &str, v: i8, now: i64) -> Entry {
    let votes = e.votes.clone().unwrap_or_default();
    let cur_idx = votes.iter().position(|x| x.who == who && x.on == id);
    let cur = cur_idx.map(|i| &votes[i]);
    let next = Vote {
        who: who.to_string(),
        on: id.to_string(),
        v: if cur.map(|c| c.v) == Some(v) { 0 } else { v },
        at: now.max(cur.map_or(0, |c| c.at) + 1),
    };
    let mut rest: Vec<Vote> = votes.iter().enumerate().filter(|(i, _)| Some(*i) != cur_idx).map(|(_, x)| x.clone()).collect();
    rest.push(next);
    rest.sort_by(by_vote);
    Entry { votes: Some(last_n(rest, VOTES_LIMIT)), ..e.clone() }
}

/// Зняти внесок з картки (`off` false) або повернути (`off` true). `mt` не змінюється.
pub fn set_dropped(e: &Entry, id: &str, who: &str, off: bool, now: i64) -> Entry {
    let drops = e.drops.clone().unwrap_or_default();
    let cur_idx = drops.iter().position(|d| d.on == id);
    let next = Drop { who: who.to_string(), on: id.to_string(), at: now.max(cur_idx.map_or(0, |i| drops[i].at) + 1), off: if off { Some(true) } else { None } };
    let mut rest: Vec<Drop> = drops.iter().enumerate().filter(|(i, _)| Some(*i) != cur_idx).map(|(_, x)| x.clone()).collect();
    rest.push(next);
    rest.sort_by(by_drop);
    Entry { drops: Some(last_n(rest, VOTES_LIMIT)), ..e.clone() }
}
