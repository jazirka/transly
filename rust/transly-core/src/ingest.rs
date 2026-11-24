//! `ingest.ts`: ключ рядка — його місце у файлі гри, тож одне повідомлення, вставлене на початок події, зсуває кожен наступний
//! ключ на один: переклади лишилися б на місці й опинилися б біля чужих рядків. Коли читається нова версія гри, `plan_ingest`
//! вирівнює старі рядки кожного файлу з новими за текстом оригіналу (порядок файлу зберігається) і переносить переклади на ключі,
//! які мають їхні рядки тепер. Рядки, яких немає, не викидаються: переклад паркується під ключем, якого не має жоден рядок
//! (`GONE`), і повертається, коли той самий оригінал з'явиться знову.

use crate::journal::RowChange;
use crate::model::{next_mt, Entry, Status, Unit};
use crate::project::FileView;
use indexmap::{IndexMap, IndexSet};
use serde::Serialize;

/// Запарковані переклади живуть під `<старий ключ>` + цей маркер: такого ключа немає в жодній грі, тож вони ніколи не з'являються, не рахуються й не перезаписуються.
pub const GONE: &str = "\u{2}gone";
pub fn is_parked(key: &str) -> bool {
    key.contains(GONE)
}

/// Скількома правками (вставлені плюс вилучені рядки) файл може відрізнятися, поки вирівнювання не пробується (вартість росте з ними).
pub const MAX_EDITS: usize = 600;

/// Рядки, спільні для двох списків, парами індексів (старий, новий) за зростанням, або `None`, коли вони відрізняються більш ніж на
/// `max_edits` рядків. Спільні початок і кінець зіставляються першими, решта — найкоротшим скриптом правок (Майєрс).
pub fn align_sources(a: &[String], b: &[String], max_edits: usize) -> Option<Vec<(usize, usize)>> {
    let (n, m) = (a.len(), b.len());
    let mut head = 0;
    while head < n && head < m && a[head] == b[head] {
        head += 1;
    }
    let mut tail = 0;
    while tail < n - head && tail < m - head && a[n - 1 - tail] == b[m - 1 - tail] {
        tail += 1;
    }
    let mut out: Vec<(usize, usize)> = (0..head).map(|i| (i, i)).collect();
    let mid = myers(&a[head..n - tail], &b[head..m - tail], max_edits)?;
    out.extend(mid.into_iter().map(|(i, j)| (i + head, j + head)));
    for k in (1..=tail).rev() {
        out.push((n - k, m - k));
    }
    Some(out)
}

fn myers(a: &[String], b: &[String], max_edits: usize) -> Option<Vec<(usize, usize)>> {
    let (nn, mm) = (a.len() as i64, b.len() as i64);
    if nn == 0 || mm == 0 {
        return Some(Vec::new());
    }
    let max = (nn + mm).min(max_edits as i64);
    let off = max + 1;
    let mut v = vec![0i32; (2 * max + 3) as usize];
    let mut trace: Vec<Vec<i32>> = Vec::new();
    let idx = |k: i64| (k + off) as usize;
    for d in 0..=max {
        trace.push(v.clone());
        let mut k = -d;
        while k <= d {
            let mut x: i64 = if k == -d || (k != d && v[idx(k - 1)] < v[idx(k + 1)]) { v[idx(k + 1)] as i64 } else { v[idx(k - 1)] as i64 + 1 };
            let mut y = x - k;
            while x < nn && y < mm && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[idx(k)] = x as i32;
            if x >= nn && y >= mm {
                let mut out: Vec<(usize, usize)> = Vec::new();
                x = nn;
                y = mm;
                for dd in (0..=d).rev() {
                    let vd = &trace[dd as usize];
                    let kk = x - y;
                    let prev_k = if kk == -dd || (kk != dd && vd[idx(kk - 1)] < vd[idx(kk + 1)]) { kk + 1 } else { kk - 1 };
                    let px = vd[idx(prev_k)] as i64;
                    let py = px - prev_k;
                    while x > px && y > py {
                        x -= 1;
                        y -= 1;
                        out.push((x as usize, y as usize));
                    }
                    x = px;
                    y = py;
                }
                out.reverse();
                return Some(out);
            }
            k += 2;
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IngestRow {
    pub file: String,
    pub key: String,
    pub source: String,
    pub target: String,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct IngestReport {
    /// Переклади, що пішли на інший ключ, бо рядок пересунувся (той самий текст).
    pub moved: usize,
    /// Переклади, що пішли з рядком, текст якого змінено (далі звичайна обробка «оригінал змінився»).
    pub edited: usize,
    /// Переклади, повернуті рядку, чий оригінал з'явився знову (їх було запарковано).
    pub adopted: usize,
    /// Рядки, яких уже немає в грі: переклад збережено, запарковано.
    pub gone: Vec<IngestRow>,
    /// Рядки, нові в грі, без перекладу.
    pub added: Vec<IngestRow>,
    /// Файли, надто змінені, щоб їх вирівняти: лишаються як були.
    pub unaligned: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IngestPlan {
    pub changes: Vec<RowChange>,
    pub report: IngestReport,
}

fn has_content(e: Option<&Entry>) -> bool {
    e.is_some_and(|e| !crate::js::trim(&e.target).is_empty() || e.comments.as_ref().is_some_and(|c| !c.is_empty()))
}

pub fn ingest_count(r: &IngestReport) -> usize {
    r.moved + r.edited + r.adopted + r.gone.len()
}
/// Нічого казати перекладачеві.
pub fn ingest_quiet(r: &IngestReport) -> bool {
    ingest_count(r) == 0 && r.added.is_empty() && r.unaligned.is_empty()
}

/// Підсумок для перекладача.
pub fn ingest_note(r: &IngestReport) -> String {
    let mut parts: Vec<String> = Vec::new();
    let n = r.moved + r.edited + r.adopted;
    if n > 0 {
        parts.push(format!("перенесено за текстом оригіналу: {n}"));
    }
    if !r.added.is_empty() {
        parts.push(format!("нових рядків: {}", r.added.len()));
    }
    if !r.gone.is_empty() {
        parts.push(format!("зникло з гри (переклад збережено): {}", r.gone.len()));
    }
    if !r.unaligned.is_empty() {
        parts.push(format!("надто змінені, не зіставлено: {} {}", r.unaligned.len(), if r.unaligned.len() == 1 { "файл" } else { "файлів" }));
    }
    parts.join(" · ")
}

struct Move {
    from: String,
    to: String,
    entry: Entry,
    how: How,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum How {
    Moved,
    Edited,
    Gone,
}

type Files = IndexMap<String, crate::model::Translations>;

/// Визначає, як мають піти переклади, коли `views` (нова версія) замінюють `old_snap` (рядки, під які писалися переклади).
/// Тут нічого не записується: виклик записує `changes` однією дією журналу (вид `rekey`).
pub fn plan_ingest(old_snap: Option<&IndexMap<String, Vec<Unit>>>, views: &[FileView], files: &Files, now: i64) -> IngestPlan {
    let mut report = IngestReport::default();
    let mut changes: Vec<RowChange> = Vec::new();
    let Some(old_snap) = old_snap else { return IngestPlan { changes, report } };
    let empty = Default::default();
    for v in views {
        let Some(old) = old_snap.get(&v.name).filter(|o| !o.is_empty()) else { continue };
        let units = &v.units;
        if old.len() == units.len() && old.iter().zip(units).all(|(a, b)| a.key == b.key && a.source == b.source) {
            continue;
        }
        // мовець — частина того, чим є рядок: двоє людей з тими самими словами — це два рядки (інакше вставлений між ними рядок міняв би їхні переклади)
        let sig = |u: &Unit| format!("{}\u{241F}{}", u.speaker, u.source);
        let (a, b): (Vec<String>, Vec<String>) = (old.iter().map(sig).collect(), units.iter().map(sig).collect());
        let pairs = align_sources(&a, &b, MAX_EDITS);
        // майже нічого спільного (і не стільки ж рядків): це інший текст, не оновлення цього
        let Some(pairs) = pairs.filter(|p| !(old.len() != units.len() && (p.len() as f64) < 0.2 * old.len().min(units.len()) as f64)) else {
            report.unaligned.push(v.name.clone());
            continue;
        };
        let ents = files.get(&v.name).unwrap_or(&empty);
        // старий індекс → новий (рядок, що лишився, пересунувся чи відредагований на місці)
        let mut dest: IndexMap<usize, usize> = IndexMap::new();
        let mut edited: IndexSet<usize> = IndexSet::new();
        let mut matched_new: IndexSet<usize> = IndexSet::new();
        let (mut pi, mut pj): (i64, i64) = (-1, -1);
        let mut all = pairs.clone();
        all.push((old.len(), units.len()));
        for (i, j) in all {
            let olds: Vec<usize> = ((pi + 1) as usize..i).collect();
            let news: Vec<usize> = ((pj + 1) as usize..j).collect();
            // стільки ж рядків між двома спільними: їх відредаговано на місці
            if olds.len() == news.len() {
                for (k, &oi) in olds.iter().enumerate() {
                    dest.insert(oi, news[k]);
                    edited.insert(oi);
                    matched_new.insert(news[k]);
                }
            }
            if i < old.len() {
                dest.insert(i, j);
                matched_new.insert(j);
            }
            pi = i as i64;
            pj = j as i64;
        }
        // що куди йде: [з ключа, на ключ (чи ключ паркування), запис, як рахується]
        let mut moves: Vec<Move> = Vec::new();
        for (i, u) in old.iter().enumerate() {
            let e = ents.get(&u.key);
            if !has_content(e) {
                continue;
            }
            match dest.get(&i) {
                None => moves.push(Move { from: u.key.clone(), to: format!("{}{GONE}", u.key), entry: e.unwrap().clone(), how: How::Gone }),
                Some(&j) if units[j].key != u.key => moves.push(Move { from: u.key.clone(), to: units[j].key.clone(), entry: e.unwrap().clone(), how: if edited.contains(&i) { How::Edited } else { How::Moved } }),
                _ => {}
            }
        }
        let leaving: IndexSet<String> = moves.iter().map(|m| m.from.clone()).collect();
        // ключ призначення, що вже тримає чужий переклад (не з тих, що йдуть), не перезаписується: той, хто йде, паркується
        for m in moves.iter_mut() {
            if m.how != How::Gone && has_content(ents.get(&m.to)) && !leaving.contains(&m.to) {
                m.to = format!("{}{GONE}", m.from);
                m.how = How::Gone;
            }
        }
        let mut put: IndexMap<String, Entry> = IndexMap::new();
        let mut cleared: IndexSet<String> = IndexSet::new();
        let mut wording: IndexMap<String, &'static str> = IndexMap::new();
        let row = |key: &str, e: &Entry| IngestRow { file: v.name.clone(), key: key.to_string(), source: e.src.clone().unwrap_or_default(), target: e.target.clone() };
        for m in &moves {
            cleared.insert(m.from.clone());
            put.insert(m.to.clone(), m.entry.clone());
            if m.how == How::Gone {
                wording.insert(m.to.clone(), "рядка вже немає в грі: переклад збережено окремо");
                report.gone.push(row(&m.from, &m.entry));
            } else {
                wording.insert(m.to.clone(), if m.how == How::Moved { "рядок пересунувся в грі: переклад перенесено за текстом" } else { "оригінал змінено в грі: переклад лишився при рядку" });
                report.moved += usize::from(m.how == How::Moved);
                report.edited += usize::from(m.how == How::Edited);
            }
        }
        // рядок, що з'явився (чи повернувся), бере запарковений переклад того самого оригіналу, раз
        let mut parked: IndexMap<String, Vec<String>> = IndexMap::new();
        let mut park = |key: &str, e: &Entry| {
            if is_parked(key) && has_content(Some(e)) && !crate::js::trim(&e.target).is_empty() {
                if let Some(src) = &e.src {
                    parked.entry(src.clone()).or_default().push(key.to_string());
                }
            }
        };
        for (k, e) in ents {
            if !cleared.contains(k) {
                park(k, e);
            }
        }
        for (k, e) in &put {
            park(k, e);
        }
        let mut taken: IndexSet<String> = IndexSet::new();
        for (j, u) in units.iter().enumerate() {
            let here: Option<&Entry> = if put.contains_key(&u.key) { put.get(&u.key) } else if cleared.contains(&u.key) { None } else { ents.get(&u.key) };
            if has_content(here) {
                continue;
            }
            if matched_new.contains(&j) {
                continue; // рядок, що був і раніше, не отримує чужого перекладу
            }
            let pk = parked.get(&u.source).and_then(|ks| ks.iter().find(|k| !taken.contains(*k))).cloned();
            let Some(pk) = pk else {
                report.added.push(IngestRow { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target: String::new() });
                continue;
            };
            taken.insert(pk.clone());
            let entry = put.get(&pk).or_else(|| ents.get(&pk)).unwrap().clone();
            put.insert(u.key.clone(), entry);
            cleared.insert(pk.clone());
            put.shift_remove(&pk);
            wording.insert(u.key.clone(), "рядок знову є в грі: переклад повернуто");
            report.adopted += 1;
            if let Some(gi) = report.gone.iter().position(|g| g.file == v.name && format!("{}{GONE}", g.key) == pk) {
                report.gone.remove(gi);
            }
        }
        for key in &cleared {
            if !put.contains_key(key) {
                if let Some(e) = ents.get(key) {
                    changes.push(RowChange { file: v.name.clone(), key: key.clone(), next: Entry { target: String::new(), status: Status::New, mt: next_mt(Some(e.mt), now), ..Entry::blank() }, text: String::new(), what: Some("рядок пересунувся: цей ключ тепер порожній".into()) });
                }
            }
        }
        for (key, entry) in &put {
            let mt = next_mt(Some(entry.mt.max(ents.get(key).map_or(0, |e| e.mt))), now);
            changes.push(RowChange { file: v.name.clone(), key: key.clone(), next: Entry { mt, ..entry.clone() }, text: entry.target.clone(), what: Some(wording.get(key).copied().unwrap_or("перенесено").to_string()) });
        }
    }
    IngestPlan { changes, report }
}

/// Чи прочитана гра — інша, ніж у проєкті (не нова версія)? З рядків, що мають переклад у файлах, спільних за іменем, майже жоден
/// оригінал не знайдено знову. Проєкт із кількома перекладеними рядками ніколи не питається.
pub fn looks_like_another_game(old_snap: Option<&IndexMap<String, Vec<Unit>>>, views: &[FileView], files: &Files) -> bool {
    let Some(old_snap) = old_snap else { return false };
    let (mut total, mut shared) = (0usize, 0usize);
    let empty = Default::default();
    for v in views {
        let Some(old) = old_snap.get(&v.name).filter(|o| !o.is_empty()) else { continue };
        let ents = files.get(&v.name).unwrap_or(&empty);
        let now: IndexSet<&str> = v.units.iter().map(|u| u.source.as_str()).collect();
        for u in old {
            if ents.get(&u.key).is_some_and(|e| !crate::js::trim(&e.target).is_empty()) {
                total += 1;
                if now.contains(u.source.as_str()) {
                    shared += 1;
                }
            }
        }
    }
    total >= 5 && (shared as f64) / (total as f64) < 0.15
}
