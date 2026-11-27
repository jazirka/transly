//! `mine.ts`: конструкції, які перекладач уже передавав однаково, знайдені в перекладених рядках: дієслово й частка з іншими словами
//! між ними («take your hat off», «take the ring off»), що завжди передаються одним українським словом. Вони лише пропонуються:
//! нічого не додається, поки перекладач не підтвердить запис у формі.

use crate::glossary::{normalize_gap, prepare_text, word_tokens, GAP};
use crate::js;
use crate::model::{Entry, Status};
use crate::project::{FileView, SavedProject};
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MineRef {
    pub file: String,
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConstructionSuggestion {
    /// Шаблон, як він був би записаний у глосарії: «take … off».
    pub en: String,
    /// Українське слово, яким це передають рядки (найчастіша форма): відправна точка для запису.
    pub uk: String,
    /// Перекладені рядки, де це знайдено.
    pub rows: Vec<MineRef>,
}

/// Шаблон пропонується від такої кількості рядків, з яких така частка передає його тим самим словом.
const MIN_ROWS: usize = 3;
const SAME_SHARE: f64 = 0.8;
/// Слів, що можуть стояти між дієсловом і часткою.
const MAX_GAP: usize = 3;
/// Українське слово, що стоїть у більшій частці всіх перекладених рядків, нічого не каже про одну конструкцію.
const COMMON_SHARE: f64 = 0.2;
/// Частка рядків щось каже лише про корпус якогось розміру.
const MIN_FOR_COMMON: usize = 50;
/// Де рядки з дієсловом, але без частки передають те саме слово так часто, частка нічого не міняє: запис був би дієслова.
const CONTROL_SHARE: f64 = 0.3;
const MAX_SUGGESTIONS: usize = 30;

pub(crate) const PARTICLES: &[&str] = &["up", "off", "on", "out", "in", "down", "away", "back", "over", "through", "around", "apart", "along", "aside", "ahead", "into", "onto", "to", "for", "from", "with", "about", "at"];
pub(crate) const STOP: &[&str] = &[
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "with", "from", "it", "its", "he", "she", "we", "you", "they", "i", "me", "him", "her", "us", "them", "my", "your", "his", "our", "their", "this", "that", "these", "those", "is", "are",
    "was", "were", "be", "been", "am", "do", "does", "did", "have", "has", "had", "will", "would", "can", "could", "shall", "should", "may", "might", "must", "not", "no", "so", "if", "then", "than", "as", "there", "here", "what", "who", "how", "why", "when", "where", "all",
    "any", "some",
];
static BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[.!?;]|\n").unwrap());
static LETTERS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{L}+$").unwrap());
static TY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"ти$").unwrap());

pub(crate) fn translated(e: Option<&Entry>) -> Option<&Entry> {
    e.filter(|e| !js::trim(&e.target).is_empty() && (e.status == Status::Done || e.status == Status::Appr))
}

fn norm(s: &str) -> String {
    normalize_gap(s).to_lowercase()
}

/// Два корені українських слів — одне слово, коли більша частина коротшого збігається з початку («знім» і «зніміть» — те саме дієслово).
fn same_word(a: &str, b: &str) -> bool {
    let (a, b): (Vec<u16>, Vec<u16>) = (a.encode_utf16().collect(), b.encode_utf16().collect());
    let mut p = 0;
    while p < a.len() && p < b.len() && a[p] == b[p] {
        p += 1;
    }
    p >= 4 && p as f64 / a.len().min(b.len()) as f64 >= 0.75
}

fn has(stems: &IndexSet<String>, rep: &str) -> bool {
    stems.iter().any(|s| s == rep || same_word(s, rep))
}

struct Group {
    w1: String,
    part: String,
    rows: Vec<usize>,
    surfaces: IndexMap<String, usize>,
}

struct Row {
    file: String,
    key: String,
    target: String,
    stems: IndexSet<String>,
}

struct Cand {
    g: usize,
    stem: String,
}

/// Слово — кандидат у дієслова, коли має лише літери, не службове і саме не частка.
pub(crate) fn content(keys: &[String], word: &str) -> bool {
    LETTERS.is_match(word) && js::len16(word) >= 3 && !STOP.contains(&keys[0].as_str()) && !PARTICLES.contains(&keys[0].as_str())
}

/// Переглядає перекладені рядки в пошуках конструкцій, яких ще нема в глосарії. `pause` викликається між частинами (в JS він віддавав
/// екран), щоб гра на сто тисяч рядків переглядалась без зависання; читається не більше `limit` рядків.
pub fn mine_constructions(views: &[FileView], saved: &SavedProject, terms: &[String], pause: &mut dyn FnMut(), limit: usize, slice: usize) -> Vec<ConstructionSuggestion> {
    let mut rows: Vec<Row> = Vec::new();
    let mut groups: IndexMap<String, Group> = IndexMap::new();
    let mut df: HashMap<String, usize> = HashMap::new();
    let mut seen = 0usize;
    // прохід 1: рядки з дієсловом, до трьох слів і часткою; і як часто вживається кожне українське слово
    for v in views {
        let ents = saved.files.get(&v.name);
        for u in &v.units {
            let Some(e) = translated(ents.and_then(|m| m.get(&u.key))) else { continue };
            if rows.len() >= limit {
                break;
            }
            let idx = rows.len();
            let stems: IndexSet<String> = word_tokens(&e.target).iter().map(|t| t.keys[0].clone()).filter(|k| js::len16(k) >= 4).collect();
            for k in &stems {
                *df.entry(k.clone()).or_insert(0) += 1;
            }
            rows.push(Row { file: v.name.clone(), key: u.key.clone(), target: e.target.clone(), stems });
            let p = prepare_text(&u.source);
            let t = &p.tokens;
            for j in 0..t.len() {
                let pk = &t[j].keys[0];
                if !PARTICLES.contains(&pk.as_str()) {
                    continue;
                }
                let mut i = j as isize - 1;
                while i >= 0 && j - i as usize - 1 <= MAX_GAP {
                    let iu = i as usize;
                    i -= 1;
                    if BREAK.is_match(&p.text[t[iu].be..t[iu + 1].bs]) {
                        break;
                    }
                    let word = p.text[t[iu].bs..t[iu].be].to_lowercase();
                    if !content(&t[iu].keys, &word) {
                        continue;
                    }
                    for k in &t[iu].keys {
                        let id = format!("{k}\u{1}{pk}");
                        let g = groups.entry(id).or_insert_with(|| Group { w1: k.clone(), part: pk.clone(), rows: vec![], surfaces: IndexMap::new() });
                        if g.rows.last() != Some(&idx) {
                            g.rows.push(idx);
                        }
                        *g.surfaces.entry(word.clone()).or_insert(0) += 1;
                    }
                }
            }
            seen += 1;
            if seen.is_multiple_of(slice) {
                pause();
            }
        }
    }
    let total = rows.len().max(1);
    let known: HashSet<String> = terms.iter().map(|t| norm(t)).collect();

    // група — кандидат, коли більшість її рядків передає її одним українським словом, не поширеним скрізь
    let glist: Vec<&Group> = groups.values().collect();
    let mut cands: Vec<Cand> = Vec::new();
    for (gi, g) in glist.iter().enumerate() {
        if g.rows.len() < MIN_ROWS {
            continue;
        }
        // корінь (з самих рядків), що більшість рядків містить у якійсь формі й що не поширений скрізь
        let mut distinct: IndexSet<&String> = IndexSet::new();
        for r in &g.rows {
            for x in &rows[*r].stems {
                distinct.insert(x);
            }
        }
        let (mut best, mut best_n) = (String::new(), 0usize);
        for rep in distinct.iter().take(400) {
            if total >= MIN_FOR_COMMON && *df.get(*rep).unwrap_or(&0) as f64 / total as f64 >= COMMON_SHARE {
                continue;
            }
            let n = g.rows.iter().filter(|r| has(&rows[**r].stems, rep)).count();
            if n > best_n {
                best = (*rep).clone();
                best_n = n;
            }
        }
        if best.is_empty() || (best_n as f64 / g.rows.len() as f64) < SAME_SHARE {
            continue;
        }
        cands.push(Cand { g: gi, stem: best });
    }
    if cands.is_empty() {
        return vec![];
    }

    // прохід 2: рядки з дієсловом, але без частки. Коли вони передають те саме слово, запис — дієслово саме, а не конструкція.
    let mut wanted: IndexMap<&str, Vec<usize>> = IndexMap::new();
    for (ci, c) in cands.iter().enumerate() {
        wanted.entry(glist[c.g].w1.as_str()).or_default().push(ci);
    }
    let mut control: Vec<(usize, usize)> = vec![(0, 0); cands.len()];
    let in_group: Vec<HashSet<usize>> = cands.iter().map(|c| glist[c.g].rows.iter().copied().collect()).collect();
    let mut at = 0usize;
    for v in views {
        let ents = saved.files.get(&v.name);
        for u in &v.units {
            if translated(ents.and_then(|m| m.get(&u.key))).is_none() {
                continue;
            }
            if at >= rows.len() {
                break;
            }
            let idx = at;
            at += 1;
            let mut keys: IndexSet<&str> = IndexSet::new();
            for t in &prepare_text(&u.source).tokens {
                for k in &t.keys {
                    if let Some((w, _)) = wanted.get_key_value(k.as_str()) {
                        keys.insert(*w);
                    }
                }
            }
            for k in keys {
                for ci in &wanted[k] {
                    if in_group[*ci].contains(&idx) {
                        continue;
                    }
                    control[*ci].0 += 1;
                    if has(&rows[idx].stems, &cands[*ci].stem) {
                        control[*ci].1 += 1;
                    }
                }
            }
            if at.is_multiple_of(slice) {
                pause();
            }
        }
    }

    // одна пропозиція на українське слово й рядки, що перетинаються: «take … off» перемагає «hat … off» (більше рядків); запис, що вже є в глосарії, не пропонується
    let mut out: Vec<ConstructionSuggestion> = Vec::new();
    let mut taken: Vec<(String, HashSet<usize>)> = Vec::new();
    let mut order: Vec<usize> = (0..cands.len()).collect();
    order.sort_by(|a, b| glist[cands[*b].g].rows.len().cmp(&glist[cands[*a].g].rows.len()).then_with(|| js::len16(&glist[cands[*a].g].w1).cmp(&js::len16(&glist[cands[*b].g].w1))));
    for ci in order {
        let c = &cands[ci];
        let g = glist[c.g];
        let (n, hit) = control[ci];
        if n >= MIN_ROWS && hit as f64 / n as f64 > CONTROL_SHARE {
            continue;
        }
        if taken.iter().any(|(stem, rows_set)| *stem == c.stem && g.rows.iter().filter(|r| rows_set.contains(r)).count() * 2 > g.rows.len()) {
            continue;
        }
        // основа дієслова, як вона стоїть у рядках (написання, чий власний ключ — ключ групи), українське слово, як його найчастіше пишуть
        let mut surf: Vec<(&String, &usize)> = g.surfaces.iter().collect();
        surf.sort_by(|a, b| b.1.cmp(a.1));
        let base = surf.iter().find(|(w, _)| word_tokens(w).first().is_some_and(|t| t.keys[0] == g.w1) || **w == g.w1).map_or(g.w1.clone(), |(w, _)| (*w).clone());
        let mut forms: IndexMap<String, usize> = IndexMap::new();
        for r in &g.rows {
            let target = &rows[*r].target;
            for t in word_tokens(target) {
                if t.keys[0] == c.stem || same_word(&t.keys[0], &c.stem) {
                    *forms.entry(target[t.bs..t.be].to_lowercase()).or_insert(0) += 1;
                }
            }
        }
        let mut fv: Vec<(String, usize)> = forms.into_iter().collect();
        fv.sort_by(|a, b| (TY.is_match(&b.0) as i32).cmp(&(TY.is_match(&a.0) as i32)).then_with(|| b.1.cmp(&a.1)));
        let uk = fv.first().map_or(c.stem.clone(), |f| f.0.clone());
        let en = format!("{base} {GAP} {}", g.part);
        if known.contains(&norm(&en)) || known.contains(&norm(&format!("{base} {}", g.part))) {
            continue;
        }
        taken.push((c.stem.clone(), g.rows.iter().copied().collect()));
        out.push(ConstructionSuggestion { en, uk, rows: g.rows.iter().map(|r| MineRef { file: rows[*r].file.clone(), key: rows[*r].key.clone() }).collect() });
        if out.len() >= MAX_SUGGESTIONS {
            break;
        }
    }
    out
}
