//! `branches.ts` (частина): гілки перекладу. Гілка — повна копія рядків перекладача (файли гри в усіх однакові).
//! `SavedProject.files` завжди тримає рядки ПОТОЧНОЇ гілки, тож кожен інструмент і екран працює без змін; інші гілки запарковані
//! в `SavedProject.branches[name].files`. Перемикання переносить рядки туди й назад. Гілка пам'ятає, де почалася (`base`).
//!
//! Перенесено те, що потрібне проєкту й злиттю: `branch_of`, перемикання, створення, перейменування, видалення, злиття запаркованих
//! гілок двох копій. Порівняння гілок (`diffBranches`, `planMerge`) прийде окремим кроком.

use crate::merge::merge;
use crate::model::Translations;
use crate::project::{Branch, SavedProject};
use indexmap::IndexMap;
use std::collections::HashSet;

pub const MAIN: &str = "main";
pub const MAX_NAME: usize = 40;

type Files = IndexMap<String, Translations>;

/// Назва гілки, чиї рядки лежать у `files`.
pub fn branch_of(p: &SavedProject) -> String {
    p.branch.as_deref().filter(|b| !b.is_empty()).unwrap_or(MAIN).to_string()
}

/// Усі гілки проєкту: `main` першою, далі в порядку створення.
pub fn branch_names(p: &SavedProject) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut names: Vec<String> = Vec::new();
    for n in [MAIN.to_string(), branch_of(p)].into_iter().chain(p.branches.iter().flat_map(|b| b.keys().cloned())) {
        if seen.insert(n.clone()) {
            names.push(n);
        }
    }
    let at = |n: &str| p.branches.as_ref().and_then(|b| b.get(n)).map_or(0, |b| b.at);
    names.sort_by(|x, y| {
        if x == MAIN {
            std::cmp::Ordering::Less
        } else if y == MAIN {
            std::cmp::Ordering::Greater
        } else {
            at(x).cmp(&at(y)).then_with(|| crate::js::cmp(x, y))
        }
    });
    names
}

/// Чому назву не можна використати для гілки, або None (`except` — гілка, що перейменовується).
pub fn name_problem(p: &SavedProject, raw: &str, except: Option<&str>) -> Option<String> {
    let name = crate::js::trim(raw);
    if name.is_empty() {
        return Some("Назва гілки не може бути порожньою".into());
    }
    if crate::js::len16(name) > MAX_NAME {
        return Some(format!("Назва гілки не довша за {MAX_NAME} знаків"));
    }
    if name.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f) {
        return Some("У назві гілки не може бути керівних знаків".into());
    }
    let taken = branch_names(p).into_iter().find(|n| n.to_lowercase() == name.to_lowercase() && Some(n.as_str()) != except);
    taken.map(|t| format!("Гілка «{t}» уже є"))
}

/// Скільки рядків із перекладом має гілка (поточна — це `files`).
pub fn rows_in(p: &SavedProject, name: &str) -> usize {
    let files = if name == branch_of(p) { Some(&p.files) } else { p.branches.as_ref().and_then(|b| b.get(name)).and_then(|b| b.files.as_ref()) };
    files.map_or(0, |f| f.values().flat_map(|t| t.values()).filter(|e| !crate::js::trim(&e.target).is_empty()).count())
}

fn blank_branch() -> Branch {
    Branch { from: None, at: 0, base: None, files: None, extra: Default::default() }
}

/// Нова гілка з поточної; вона стає поточною (рядки старої поточної запарковуються).
pub fn create_branch(p: &SavedProject, name: &str, now: i64) -> Result<SavedProject, String> {
    if let Some(bad) = name_problem(p, name, None) {
        return Err(bad);
    }
    let cur = branch_of(p);
    let key = crate::js::trim(name).to_string();
    let mut branches: IndexMap<String, Branch> = p.branches.clone().unwrap_or_default();
    let mut curb = branches.get(&cur).cloned().unwrap_or_else(blank_branch);
    curb.files = Some(p.files.clone());
    branches.insert(cur.clone(), curb);
    branches.insert(key.clone(), Branch { from: Some(cur), at: now, base: Some(serde_json::to_value(&p.files).unwrap()), files: None, extra: Default::default() });
    let mut out = SavedProject { files: p.files.clone(), branch: Some(key.clone()), branches: Some(branches), ..p.clone() };
    if p.gone_branches.as_ref().is_some_and(|g| g.contains_key(&key)) {
        let mut g = p.gone_branches.clone().unwrap();
        g.shift_remove(&key);
        out.gone_branches = if g.is_empty() { None } else { Some(g) };
    }
    Ok(out)
}

fn move_to(p: &SavedProject, name: &str, strict: bool) -> Result<SavedProject, String> {
    let cur = branch_of(p);
    if name == cur {
        return Ok(p.clone());
    }
    let target = p.branches.as_ref().and_then(|b| b.get(name));
    if strict && target.and_then(|t| t.files.as_ref()).is_none() && name != MAIN {
        return Err(format!("Гілки «{name}» немає"));
    }
    let mut branches: IndexMap<String, Branch> = p.branches.clone().unwrap_or_default();
    let mut curb = branches.get(&cur).cloned().unwrap_or_else(blank_branch);
    curb.files = Some(p.files.clone());
    branches.insert(cur, curb);
    let mut meta = target.cloned().unwrap_or_else(blank_branch);
    let files = meta.files.take();
    branches.insert(name.to_string(), meta);
    let mut out = SavedProject { files: files.unwrap_or_default(), branches: Some(branches), ..p.clone() };
    out.branch = if name == MAIN { None } else { Some(name.to_string()) };
    Ok(out)
}

/// Проєкт з іншою гілкою поточною.
pub fn switch_branch(p: &SavedProject, name: &str) -> Result<SavedProject, String> {
    move_to(p, name, true)
}

/// Те саме для злиття двох копій: гілка, якої копія не бачила, там порожня.
pub fn checkout_branch(p: &SavedProject, name: &str) -> SavedProject {
    move_to(p, name, false).expect("нестрогий перехід не відмовляє")
}

/// Перейменувати гілку (гілки, зроблені з неї, йдуть за нею).
pub fn rename_branch(p: &SavedProject, from: &str, to: &str) -> Result<SavedProject, String> {
    if from == MAIN {
        return Err("Гілку «main» не можна перейменувати".into());
    }
    if let Some(bad) = name_problem(p, to, Some(from)) {
        return Err(bad);
    }
    let key = crate::js::trim(to).to_string();
    if key == from {
        return Ok(p.clone());
    }
    let mut branches: IndexMap<String, Branch> = IndexMap::new();
    for (n, b) in p.branches.iter().flatten() {
        let b = if b.from.as_deref() == Some(from) { Branch { from: Some(key.clone()), ..b.clone() } } else { b.clone() };
        branches.insert(if n == from { key.clone() } else { n.clone() }, b);
    }
    let mut out = SavedProject { branches: Some(branches), ..p.clone() };
    if branch_of(p) == from {
        out.branch = Some(key);
    }
    Ok(out)
}

/// Видалити гілку, що не є поточною; гілки, зроблені з неї, тепер зроблені з її батька.
pub fn delete_branch(p: &SavedProject, name: &str, now: i64) -> Result<SavedProject, String> {
    if name == branch_of(p) {
        return Err("Поточну гілку не можна видалити: спершу перемкніться на іншу".into());
    }
    if name == MAIN {
        return Err("Гілку «main» не можна видалити".into());
    }
    let own_from = p.branches.as_ref().and_then(|b| b.get(name)).and_then(|b| b.from.clone());
    let mut branches: IndexMap<String, Branch> = IndexMap::new();
    for (n, b) in p.branches.iter().flatten() {
        if n != name {
            let b = if b.from.as_deref() == Some(name) { Branch { from: own_from.clone(), ..b.clone() } } else { b.clone() };
            branches.insert(n.clone(), b);
        }
    }
    let mut gone = p.gone_branches.clone().unwrap_or_default();
    gone.insert(name.to_string(), now);
    Ok(SavedProject { branches: Some(branches), gone_branches: Some(gone), ..p.clone() })
}

/// Зливає запарковані гілки двох копій проєкту (обидві вже мають одну поточну гілку `cur`).
#[allow(clippy::type_complexity)]
pub fn merge_branch_data(a: &SavedProject, b: &SavedProject, cur: &str, epoch: i64, live: &dyn Fn(&Translations) -> Translations) -> (Option<IndexMap<String, Branch>>, Option<IndexMap<String, i64>>) {
    let mut gone: IndexMap<String, i64> = IndexMap::new();
    for src in [a.gone_branches.as_ref(), b.gone_branches.as_ref()].into_iter().flatten() {
        for (k, &t) in src {
            if t > epoch && t > gone.get(k).copied().unwrap_or(0) {
                gone.insert(k.clone(), t);
            }
        }
    }
    let mut names: Vec<String> = Vec::new();
    for n in a.branches.iter().flat_map(|x| x.keys()).chain(b.branches.iter().flat_map(|x| x.keys())) {
        if !names.contains(n) {
            names.push(n.clone());
        }
    }
    let mut branches: IndexMap<String, Branch> = IndexMap::new();
    for name in names {
        let x = a.branches.as_ref().and_then(|m| m.get(&name));
        let y = b.branches.as_ref().and_then(|m| m.get(&name));
        let born = x.map_or(i64::MAX, |v| v.at).min(y.map_or(i64::MAX, |v| v.at));
        let g = gone.get(&name).copied().unwrap_or(0);
        if name != cur && g >= born && g > 0 {
            continue;
        }
        let (x, y) = match (x, y) {
            (Some(x), Some(y)) => (x, y),
            (Some(one), None) | (None, Some(one)) => {
                branches.insert(name, one.clone());
                continue;
            }
            (None, None) => continue,
        };
        let from = x.from.clone().or_else(|| y.from.clone());
        let base = match (&x.base, &y.base) {
            (Some(xb), Some(yb)) => Some(if crate::js::cmp(&serde_json::to_string(yb).unwrap(), &serde_json::to_string(xb).unwrap()) == std::cmp::Ordering::Greater { yb.clone() } else { xb.clone() }),
            (xb, yb) => xb.clone().or_else(|| yb.clone()),
        };
        let mut merged = Branch { from, at: x.at.min(y.at), base, files: None, extra: Default::default() };
        if name != cur && (x.files.is_some() || y.files.is_some()) {
            let mut files: Files = IndexMap::new();
            let empty = Translations::new();
            let mut fnames: Vec<&String> = Vec::new();
            for f in x.files.iter().flat_map(|m| m.keys()).chain(y.files.iter().flat_map(|m| m.keys())) {
                if !fnames.contains(&f) {
                    fnames.push(f);
                }
            }
            for f in fnames {
                let xf = x.files.as_ref().and_then(|m| m.get(f)).unwrap_or(&empty);
                let yf = y.files.as_ref().and_then(|m| m.get(f)).unwrap_or(&empty);
                files.insert(f.clone(), merge(&live(xf), &live(yf), 0).merged);
            }
            merged.files = Some(files);
        }
        branches.insert(name, merged);
    }
    (if branches.is_empty() { None } else { Some(branches) }, if gone.is_empty() { None } else { Some(gone) })
}
