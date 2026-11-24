//! `reference.ts`: довідкова мова: текст кожного рядка робочої мови в копії гри іншою мовою, зіставлений за ключем чи вирівнюванням.

use crate::controlcodes::codes_of;
use crate::js;
use crate::model::Unit;
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Текст довідкової мови за ключем рядка робочої мови.
pub type Reference = IndexMap<String, String>;

/// Одна довідкова мова: її тексти за файлами.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReferenceSet {
    pub lang: String,
    pub texts: IndexMap<String, Reference>,
}

/// Перша довідкова мова та інші; усе їде одним блоком, тож синхронізація й сховище лишаються як були.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReferenceBundle {
    pub lang: String,
    pub texts: IndexMap<String, Reference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Vec<ReferenceSet>>,
}

pub fn reference_sets(b: Option<&ReferenceBundle>) -> Vec<ReferenceSet> {
    match b {
        None => vec![],
        Some(b) => std::iter::once(ReferenceSet { lang: b.lang.clone(), texts: b.texts.clone() }).chain(b.extra.clone().unwrap_or_default()).collect(),
    }
}

fn bundle_of(mut sets: Vec<ReferenceSet>) -> Option<ReferenceBundle> {
    if sets.is_empty() {
        return None;
    }
    let first = sets.remove(0);
    Some(ReferenceBundle { lang: first.lang, texts: first.texts, extra: (!sets.is_empty()).then_some(sets) })
}

/// Додає довідкову мову або заміняє ту, що має той самий код. Повертає новий блок.
pub fn with_reference(b: Option<&ReferenceBundle>, set: ReferenceSet) -> ReferenceBundle {
    let cur = reference_sets(b);
    let merged: Vec<ReferenceSet> = if cur.iter().any(|x| x.lang == set.lang) { cur.into_iter().map(|x| if x.lang == set.lang { set.clone() } else { x }).collect() } else { cur.into_iter().chain([set]).collect() };
    bundle_of(merged).expect("є принаймні одна мова")
}

/// Прибирає одну довідкову мову; None, коли жодної не лишилось.
pub fn without_reference(b: Option<&ReferenceBundle>, lang: &str) -> Option<ReferenceBundle> {
    bundle_of(reference_sets(b).into_iter().filter(|x| x.lang != lang).collect())
}

static LIST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.*\.list)\[\d+\]").unwrap());
static CHOICE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.choice\[\d+\]$").unwrap());

fn prefix_of(key: &str) -> Option<String> {
    LIST.captures(key).map(|m| m[1].to_string())
}

fn code_sig(t: &str) -> String {
    let mut v: Vec<String> = codes_of(t).iter().map(|c| c.to_lowercase()).collect();
    v.sort_by(|a, b| js::cmp(a, b));
    v.concat()
}

/// Наскільки два рядки схожі на один рядок гри. None = не можна поєднувати.
fn score(a: &Unit, b: &Unit) -> Option<i32> {
    if a.kind != b.kind {
        return None;
    }
    let mut s = 3;
    if code_sig(&a.source) == code_sig(&b.source) {
        s += 2;
    }
    let (la, lb) = (js::len16(&a.source).max(1) as f64, js::len16(&b.source).max(1) as f64);
    let ratio = la.max(lb) / la.min(lb);
    s += if ratio <= 1.6 {
        1
    } else if ratio <= 3.0 {
        0
    } else {
        -1
    };
    // варіант вибору стоїть під тим самим індексом усередині своєї команди: віддаємо перевагу парам зі схожими хвостами ключів
    let (ta, tb) = (CHOICE.find(&a.key).map(|m| m.as_str()), CHOICE.find(&b.key).map(|m| m.as_str()));
    if ta.is_some() && ta == tb {
        s += 1;
    }
    Some(s)
}

/// Глобальне вирівнювання (Нідлман—Вунш) двох упорядкованих списків рядків; повертає пари індексів.
fn align(a: &[&Unit], b: &[&Unit]) -> Vec<(usize, usize)> {
    let (n, m, gap) = (a.len(), b.len(), -1i32);
    let w = m + 1;
    let mut dp = vec![0i32; (n + 1) * w];
    let mut from = vec![0u8; (n + 1) * w]; // 1 по діагоналі, 2 вгору (пропустити a), 3 вліво (пропустити b)
    for i in 1..=n {
        dp[i * w] = i as i32 * gap;
        from[i * w] = 2;
    }
    for j in 1..=m {
        dp[j] = j as i32 * gap;
        from[j] = 3;
    }
    for i in 1..=n {
        for j in 1..=m {
            let sc = score(a[i - 1], b[j - 1]);
            let mut best = dp[(i - 1) * w + j] + gap;
            let mut f = 2;
            let left = dp[i * w + j - 1] + gap;
            if left > best {
                best = left;
                f = 3;
            }
            if let Some(sc) = sc {
                let d = dp[(i - 1) * w + j - 1] + sc;
                if d >= best {
                    best = d;
                    f = 1;
                }
            }
            dp[i * w + j] = best;
            from[i * w + j] = f;
        }
    }
    let mut out = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        match from[i * w + j] {
            1 => {
                out.push((i - 1, j - 1));
                i -= 1;
                j -= 1;
            }
            2 => i -= 1,
            _ => j -= 1,
        }
    }
    out.reverse();
    out
}

/// Поєднує кожен рядок робочої мови з тим самим рядком у копії гри довідковою мовою. Записи бази — за ключем. Текст подій — усередині
/// того самого списку команд вирівнюванням, бо перекладачі інших версій додають і прибирають рядки, що зсуває індекси команд.
pub fn align_reference(units: &[Unit], reference: &[Unit]) -> Reference {
    let mut out = Reference::new();
    let by_key: IndexMap<&str, &Unit> = reference.iter().map(|u| (u.key.as_str(), u)).collect();
    let mut groups: IndexMap<String, (Vec<&Unit>, Vec<&Unit>)> = IndexMap::new();
    for u in units {
        match prefix_of(&u.key) {
            None => {
                if let Some(r) = by_key.get(u.key.as_str()).filter(|r| r.kind == u.kind) {
                    out.insert(u.key.clone(), r.source.clone());
                }
            }
            Some(p) => groups.entry(p).or_default().0.push(u),
        }
    }
    for u in reference {
        if let Some(p) = prefix_of(&u.key) {
            groups.entry(p).or_default().1.push(u);
        }
    }
    for (a, b) in groups.values() {
        if a.is_empty() || b.is_empty() {
            continue;
        }
        // однакова розкладка команд (ті самі індекси, ті самі види): поєднуємо по порядку без пошуку
        if a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| x.key == y.key && x.kind == y.kind) {
            for (x, y) in a.iter().zip(b.iter()) {
                out.insert(x.key.clone(), y.source.clone());
            }
            continue;
        }
        for (i, j) in align(a, b) {
            out.insert(a[i].key.clone(), b[j].source.clone());
        }
    }
    out
}
