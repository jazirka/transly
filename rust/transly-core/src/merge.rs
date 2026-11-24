//! `merge.ts`: злиття записів. Закони (комутативність, асоціативність, ідемпотентність) тримаються на тому, що
//! нічиї вирішуються детерміновано, однаково на обох пристроях.
//!
//! Відома відмінність: у TS нічия `pickComment` порівнює `JSON.stringify` коментарів, а порядок ключів залежить від того,
//! як об'єкт було створено; тут порядок полів фіксований (who, at, text, id, re, res, ed, del). Для даних, збережених
//! цим же кодом, це збігається.

use crate::js;
use crate::model::{Comment, Entry, HistoryItem, Translations};
use crate::variants::{by_drop, by_vote, later_drop, later_vote, vote_id};
use crate::workflow::{comment_id, HISTORY_LIMIT};
use std::cmp::Ordering;
use std::collections::HashMap;

pub struct MergeResult {
    pub merged: Translations,
    pub conflicts: Vec<String>,
}

pub const OTHER_DEVICE: &str = "інший пристрій";
pub const REPLACED_WHAT: &str = "версія з іншого пристрою, замінена пізнішою правкою";
pub const RESET_WHAT: &str = "переклад, який відкинуло скидання проєкту (годинник пристрою, що скидав, міг спішити)";

/// Що вирішила функція вибору з двох версій одного елемента.
enum Pick<T> {
    /// Лишити ту, що вже була (з `x`).
    Had,
    /// Взяти нову (з `y`).
    Other,
    /// Створено новий об'єкт.
    New(T),
}

/// `x`, а за ним те, чого в `y` немає. Друге значення — «це сам `x` або `y` без змін» (у TS: збіг за посиланням),
/// від чого залежить, чи треба потім пересортовувати.
type PickFn<'a, T> = &'a dyn Fn(&T, &T) -> Pick<T>;

fn union_by<T: Clone>(x: Option<&Vec<T>>, y: Option<&Vec<T>>, id: impl Fn(&T) -> String, pick: Option<PickFn<T>>) -> (Option<Vec<T>>, bool) {
    let Some(yv) = y.filter(|v| !v.is_empty()) else { return (x.cloned(), true) };
    let Some(xv) = x.filter(|v| !v.is_empty()) else { return (Some(yv.clone()), true) };
    let mut items: Vec<T> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for v in xv {
        match index.get(&id(v)) {
            Some(&i) => items[i] = v.clone(),
            None => {
                index.insert(id(v), items.len());
                items.push(v.clone());
            }
        }
    }
    let mut changed = false;
    for v in yv {
        let k = id(v);
        match index.get(&k) {
            None => {
                index.insert(k, items.len());
                items.push(v.clone());
                changed = true;
            }
            Some(&i) => {
                if let Some(p) = pick {
                    match p(&items[i], v) {
                        Pick::Had => {}
                        Pick::Other => {
                            items[i] = v.clone();
                            changed = true;
                        }
                        Pick::New(n) => {
                            items[i] = n;
                            changed = true;
                        }
                    }
                }
            }
        }
    }
    if changed { (Some(items), false) } else { (x.cloned(), true) }
}

/// Дві версії одного коментаря: текст пізнішої правки, стан розв'язання пізнішого рішення.
fn pick_comment(a: &Comment, b: &Comment) -> Pick<Comment> {
    let sa = a.ed.unwrap_or(a.at);
    let sb = b.ed.unwrap_or(b.at);
    // один штамп на різних текстах (два пристрої, одна мілісекунда): перемагає більша форма, на обох однаково
    let text_from_b = if sb != sa { sb > sa } else { js::cmp(&js::stringify(b), &js::stringify(a)) == Ordering::Greater };
    let res_from_b = b.res.as_ref().map_or(0, |r| r.at) > a.res.as_ref().map_or(0, |r| r.at);
    if text_from_b == res_from_b {
        return if text_from_b { Pick::Other } else { Pick::Had };
    }
    let (text_from, res_from) = if text_from_b { (b, a) } else { (a, b) };
    if text_from.res.is_none() && res_from.res.is_none() {
        return if text_from_b { Pick::Other } else { Pick::Had };
    }
    let mut out = text_from.clone();
    out.res = res_from.res.clone();
    Pick::New(out)
}

/// Запис історії, що зберігає переклад, який втратив інший пристрій: без часу (`at` = 0), ідентифікується текстом.
fn is_kept(h: &HistoryItem) -> bool {
    h.who == OTHER_DEVICE && (h.what == REPLACED_WHAT || h.what == RESET_WHAT)
}

fn same_history(h: &HistoryItem) -> String {
    if is_kept(h) {
        format!("kept\u{1}{}\u{1}{}", h.what, h.text)
    } else {
        format!("{}\u{1}{}\u{1}{}\u{1}{}", h.at, h.who, h.what, h.text)
    }
}

/// Найстаріші першими; записи одного часу — у сталому порядку.
fn by_time(x: &HistoryItem, y: &HistoryItem) -> Ordering {
    x.at.cmp(&y.at).then_with(|| js::cmp(&same_history(x), &same_history(y)))
}

/// З двох записів про один втрачений текст лишається раніший.
fn earlier(a: &HistoryItem, b: &HistoryItem) -> Pick<HistoryItem> {
    if is_kept(a) && b.at < a.at { Pick::Other } else { Pick::Had }
}

/// Переможець з двох версій рядка: true — b. Пізніший `mt`; за рівного — далі статус, більший текст, інші поля перекладу.
fn newer_of_is_b(a: &Entry, b: &Entry) -> bool {
    if a.mt != b.mt {
        return b.mt > a.mt;
    }
    let (ra, rb) = (a.status.rank(), b.status.rank());
    if ra != rb {
        return rb > ra;
    }
    if a.target != b.target {
        return js::cmp(&b.target, &a.target) == Ordering::Greater;
    }
    // лише поля самого перекладу: коментарі, історія й ігноровані попередження зливаються окремо
    let key = |e: &Entry| js::stringify(&serde_json::json!([e.src.clone().unwrap_or_default(), e.orig.clone().unwrap_or_default(), if e.returned == Some(true) { 1 } else { 0 }]));
    js::cmp(&key(b), &key(a)) == Ordering::Greater
}

/// Злиття двох версій одного рядка: переклад (текст, статус, позначки вичитки) — від пізнішої; коментарі, історія й
/// ігноровані попередження поєднуються.
pub fn merge_entry(a: &Entry, b: &Entry) -> Entry {
    let mut out = if newer_of_is_b(a, b) { b.clone() } else { a.clone() };

    let pc = |x: &Comment, y: &Comment| pick_comment(x, y);
    let (comments, same) = union_by(a.comments.as_ref(), b.comments.as_ref(), comment_id, Some(&pc));
    out.comments = comments.map(|mut c| {
        if !same {
            c.sort_by_key(|x| x.at);
        }
        c
    });

    let lv = |x: &crate::model::Vote, y: &crate::model::Vote| if later_vote(x, y) { Pick::Other } else { Pick::Had };
    let (votes, same) = union_by(a.votes.as_ref(), b.votes.as_ref(), vote_id, Some(&lv));
    out.votes = votes.map(|mut v| {
        if !same {
            v.sort_by(by_vote);
        }
        v
    });

    let ld = |x: &crate::model::Drop, y: &crate::model::Drop| if later_drop(x, y) { Pick::Other } else { Pick::Had };
    let (drops, same) = union_by(a.drops.as_ref(), b.drops.as_ref(), |d| d.on.clone(), Some(&ld));
    out.drops = drops.map(|mut d| {
        if !same {
            d.sort_by(by_drop);
        }
        d
    });

    let eh = |x: &HistoryItem, y: &HistoryItem| earlier(x, y);
    let (history, same) = union_by(a.history.as_ref(), b.history.as_ref(), same_history, Some(&eh));
    out.history = history.map(|mut h| {
        if !same {
            h.sort_by(by_time);
            let n = h.len();
            if n > HISTORY_LIMIT {
                h.drain(..n - HISTORY_LIMIT);
            }
        }
        h
    });

    // Збережений переклад, який знову став текстом рядка, більше не «втрачена версія»; інакше запис залежав би
    // від порядку злиття трьох копій.
    if out.history.as_ref().is_some_and(|h| h.iter().any(|x| is_kept(x) && x.text == out.target)) {
        let rest: Vec<HistoryItem> = out.history.take().unwrap().into_iter().filter(|x| !(is_kept(x) && x.text == out.target)).collect();
        out.history = if rest.is_empty() { None } else { Some(rest) };
    }

    // Ігноровані попередження: перемагає сторона, чий список змінено пізніше; без годинників рахуються обидва списки.
    let (a_at, b_at) = (a.ign_at.unwrap_or(0), b.ign_at.unwrap_or(0));
    if a_at != b_at {
        let from = if b_at > a_at { b } else { a };
        out.ign = from.ign.clone();
        out.ign_at = Some(a_at.max(b_at));
    } else {
        let (u, _) = union_by(a.ign.as_ref(), b.ign.as_ref(), |k| k.clone(), None);
        out.ign = u;
        if a_at != 0 {
            out.ign_at = Some(a_at);
        }
    }
    out
}

/// Злиття двох наборів перекладів по рядках. Конфлікт — коли обидві сторони змінили рядок на різний текст після `since`;
/// лишається новіший, а програний текст іде в історію рядка.
pub fn merge(a: &Translations, b: &Translations, since: i64) -> MergeResult {
    let mut merged = a.clone();
    let mut conflicts = Vec::new();
    for (key, eb) in b {
        let Some(ea) = merged.get(key) else {
            merged.insert(key.clone(), eb.clone());
            continue;
        };
        let ea = ea.clone();
        let mut entry = merge_entry(&ea, eb);
        if ea.target != eb.target && ea.mt > since && eb.mt > since {
            conflicts.push(key.clone());
            let loser = if newer_of_is_b(&ea, eb) { &ea } else { eb };
            if !js::trim(&loser.target).is_empty() && loser.target != entry.target {
                let kept = HistoryItem { at: 0, who: OTHER_DEVICE.into(), what: REPLACED_WHAT.into(), text: loser.target.clone(), batch: None, prev: None };
                let ky = vec![kept.clone()];
                let eh = |x: &HistoryItem, y: &HistoryItem| earlier(x, y);
                let (h, same) = union_by(entry.history.as_ref(), Some(&ky), same_history, Some(&eh));
                let mut h = h.unwrap_or(ky);
                if !same {
                    h.sort_by(by_time);
                    let n = h.len();
                    if n > HISTORY_LIMIT {
                        h.drain(..n - HISTORY_LIMIT);
                    }
                }
                entry.history = Some(h);
            }
        }
        merged.insert(key.clone(), entry);
    }
    MergeResult { merged, conflicts }
}
