//! `autofill.ts`: автозаповнення: слова, вивчені з перекладених рядків, і підстановка за однаковим оригіналом.

use crate::autolog::is_auto_filled;
use crate::compose::{adj_lemma, build_lexicon, compose_line, is_letter};
use crate::js;
use crate::model::{Entry, Status};
use crate::project::{FileView, SavedProject};
use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// Шматок рядка: слово чи будь-що інше (пунктуація, цифри, керівний код гри), що лишається як є.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tok {
    pub text: String,
    pub word: bool,
    /// Позиція в одиницях UTF-16.
    pub index: usize,
    /// Байтовий зсув у рядку (для зрізів у Rust).
    #[serde(skip)]
    pub bi: usize,
}

static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+(?:\[[^\]]*\])?|\\[.|!<>^{}$]|\p{L}[\p{L}'’-]*|[0-9]+|[^\s\x{FEFF}]|\x{85}").unwrap());

pub fn tokenize(text: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let (mut byte, mut u16pos) = (0usize, 0usize);
    for m in TOKEN.find_iter(text) {
        u16pos += text[byte..m.start()].encode_utf16().count();
        let t = m.as_str();
        out.push(Tok { text: t.to_string(), word: t.chars().next().is_some_and(regex_letter), index: u16pos, bi: m.start() });
        u16pos += t.encode_utf16().count();
        byte = m.end();
    }
    out
}

fn regex_letter(c: char) -> bool {
    static L: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{L}$").unwrap());
    L.is_match(c.encode_utf8(&mut [0; 4]))
}

const MAX_WORDS: usize = 8;
fn lower(s: &str) -> String {
    s.to_lowercase()
}

/// Чому можна вчитися: рядок, надісланий чи вичитаний, що сам не є автозаповненням. Чернетка — переклад у роботі (півречення,
/// заглушка, проба), а рядок, який застосунок заповнив, не повинен навчати наступне заповнення.
pub fn trusted(e: Option<&Entry>, drafts: bool) -> bool {
    e.is_some_and(|e| !js::trim(&e.target).is_empty() && (drafts || matches!(e.status, Status::Done | Status::Appr))) && !is_auto_filled(e)
}

/// Чи може переклад бути перекладом рядка, куди його копіюють: довгий рядок не відповідається словом (і навпаки).
pub fn plausible(source: &str, target: &str) -> bool {
    static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+(?:\[[^\]]*\])?").unwrap());
    let s = js::trim(&CODE.replace_all(source, "")).to_string();
    let t = js::trim(&CODE.replace_all(target, "")).to_string();
    if js::len16(&s) < 16 {
        return true;
    }
    let ratio = js::len16(&t) as f64 / js::len16(&s) as f64;
    let runs = |x: &str| -> usize {
        let mut n = 1;
        let mut prev_space = false;
        for c in x.chars() {
            let sp = js::is_space(c);
            if sp && !prev_space {
                n += 1;
            }
            prev_space = sp;
        }
        n
    };
    let (sw, tw) = (runs(&s), runs(&t));
    (0.4..=3.0).contains(&ratio) && (sw < 4 || (tw as f64 >= sw as f64 * 0.4 && tw as f64 <= sw as f64 * 3.0))
}

/// Оригінальне слово → переклад (малі літери), вивчений з глосарія й перекладених коротких рядків.
pub type WordDict = IndexMap<String, String>;

/// Що вивчено: словник і слова, переклади яких розходяться (варіанти з голосами).
#[derive(Clone, Debug, PartialEq)]
pub struct Learned {
    pub dict: WordDict,
    pub ambiguous: IndexMap<String, Vec<(String, usize)>>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FillOpts {
    pub drafts: bool,
}

pub fn learn_words(views: &[FileView], saved: &SavedProject, opts: FillOpts) -> WordDict {
    learn_detailed(views, saved, opts).dict
}

/// Перекладений рядок учить слова, коли оригінал і переклад мають однакову форму: стільки ж шматків і однакові пунктуація,
/// цифри й коди на тих самих місцях; тоді слово i оригіналу — слово i перекладу. Слово з різними перекладами лишає той, що
/// виграє 2:1, інакше воно неоднозначне й відкидається. Односкладові терміни глосарія завжди виграють.
pub fn learn_detailed(views: &[FileView], saved: &SavedProject, opts: FillOpts) -> Learned {
    let mut votes: IndexMap<String, IndexMap<String, usize>> = IndexMap::new();
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let e = ents.get(&u.key);
            if !trusted(e, opts.drafts) {
                continue;
            }
            let target = js::trim(&e.unwrap().target).to_string();
            let (a, b) = (tokenize(&u.source), tokenize(&target));
            if a.len() != b.len() || a.iter().filter(|t| t.word).count() > MAX_WORDS {
                continue;
            }
            if !a.iter().zip(&b).all(|(t, x)| t.word == x.word && (t.word || t.text == x.text)) {
                continue;
            }
            for (t, x) in a.iter().zip(&b) {
                if !t.word {
                    continue;
                }
                let m = votes.entry(lower(&t.text)).or_default();
                *m.entry(lower(&x.text)).or_insert(0) += 1;
            }
        }
    }
    let mut dict: WordDict = IndexMap::new();
    let mut ambiguous: IndexMap<String, Vec<(String, usize)>> = IndexMap::new();
    for (w, m) in &votes {
        let mut ranked: Vec<(String, usize)> = m.iter().map(|(k, n)| (k.clone(), *n)).collect();
        ranked.sort_by_key(|x| std::cmp::Reverse(x.1));
        // слово з двома різними перекладами відкидається, навіть коли один частіший: другий — зазвичай те саме слово в іншому
        // відмінку («game» → «гра» і «гру»), і частіший у новому рядку дає хибну форму («Нова гру»);
        // слово, бачене в одному рядку, — здогад: потрібен другий рядок, що збігається
        if ranked.len() == 1 {
            if ranked[0].1 >= 2 {
                dict.insert(w.clone(), ranked[0].0.clone());
            }
        } else {
            // «ліва», «ліве», «лівий»: форми одного прикметника — не розбіжність, слово — «лівий», і воно бере рід свого іменника
            let lemmas: Vec<Option<String>> = {
                let mut seen: Vec<Option<String>> = Vec::new();
                for x in &ranked {
                    let l = adj_lemma(&x.0);
                    if !seen.contains(&l) {
                        seen.push(l);
                    }
                }
                seen
            };
            let total: usize = ranked.iter().map(|x| x.1).sum();
            if lemmas.len() == 1 && lemmas[0].is_some() && total >= 2 {
                dict.insert(w.clone(), lemmas[0].clone().unwrap());
            } else {
                ambiguous.insert(w.clone(), ranked);
            }
        }
    }
    for t in &saved.terms {
        let en = js::trim(t.get("en").and_then(|e| e.as_str()).unwrap_or("")).to_string();
        let uk = js::trim(t.get("uk").and_then(|e| e.as_str()).unwrap_or("")).to_string();
        let toks = tokenize(&en);
        if toks.len() == 1 && toks[0].word && !uk.is_empty() {
            dict.insert(lower(&en), lower(&uk));
            ambiguous.shift_remove(&lower(&en));
        }
    }
    Learned { dict, ambiguous }
}

/// Звідки пропозиція: рядок з тим самим оригіналом, що перекладений, чи слова перекладених рядків.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProposalFrom {
    Same,
    Words,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Proposal {
    pub file: String,
    pub key: String,
    pub source: String,
    pub target: String,
    pub from: ProposalFrom,
}

/// Неперекладені короткі рядки, де кожне слово відоме: переклад складається слово за словом.
pub fn proposals(views: &[FileView], saved: &SavedProject, dict: Option<&WordDict>, limit: usize, opts: FillOpts) -> Vec<Proposal> {
    let own;
    let dict = match dict {
        Some(d) => d,
        None => {
            own = learn_words(views, saved, FillOpts::default());
            &own
        }
    };
    let mut out = Vec::new();
    // цілий рядок, що вже перекладений (ті самі слова в іншому регістрі літер), підставляється так, як був перекладений
    let mut whole: IndexMap<String, String> = IndexMap::new();
    let empty = Default::default();
    for v in views {
        let ents = saved.files.get(&v.name).unwrap_or(&empty);
        for u in &v.units {
            let e = ents.get(&u.key);
            if trusted(e, opts.drafts) && plausible(&u.source, &e.unwrap().target) && !whole.contains_key(&lower(js::trim(&u.source))) {
                whole.insert(lower(js::trim(&u.source)), js::trim(&e.unwrap().target).to_string());
            }
        }
    }
    let lex = build_lexicon(&whole, dict, saved);
    for v in views {
        let ents = saved.files.get(&v.name).unwrap_or(&empty);
        for u in &v.units {
            if ents.get(&u.key).is_some_and(|e| !js::trim(&e.target).is_empty()) {
                continue;
            }
            let same = whole.get(&lower(js::trim(&u.source)));
            if let Some(same) = same.filter(|s| **s != u.source) {
                let letters: Vec<char> = u.source.chars().filter(|&c| is_letter(c)).collect();
                let loud = letters.len() > 1 && letters.iter().all(|c| c.to_uppercase().collect::<String>() == c.to_string());
                out.push(Proposal { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target: if loud { same.to_uppercase() } else { same.clone() }, from: ProposalFrom::Same });
                if out.len() >= limit {
                    return out;
                }
                continue;
            }
            let Some(target) = compose_line(&u.source, &lex, saved, MAX_WORDS + 2) else { continue };
            if !plausible(&u.source, &target) {
                continue;
            }
            out.push(Proposal { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), target, from: ProposalFrom::Words });
            if out.len() >= limit {
                return out;
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockReason {
    Unknown,
    Ambiguous,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Blocker {
    pub word: String,
    pub reason: BlockReason,
    /// Для неоднозначних слів: конкуруючі переклади.
    pub variants: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Almost {
    pub file: String,
    pub key: String,
    pub source: String,
    pub blockers: Vec<Blocker>,
}

/// Неперекладені короткі рядки, яким бракує одного-двох слів, зі словами, що їх блокують.
pub fn almost(views: &[FileView], saved: &SavedProject, learned: Option<&Learned>, limit: usize) -> Vec<Almost> {
    let own;
    let learned = match learned {
        Some(l) => l,
        None => {
            own = learn_detailed(views, saved, FillOpts::default());
            &own
        }
    };
    let mut out = Vec::new();
    let empty = Default::default();
    for v in views {
        let ents = saved.files.get(&v.name).unwrap_or(&empty);
        for u in &v.units {
            if ents.get(&u.key).is_some_and(|e| !js::trim(&e.target).is_empty()) {
                continue;
            }
            let words: Vec<Tok> = tokenize(&u.source).into_iter().filter(|t| t.word).collect();
            if words.is_empty() || words.len() > MAX_WORDS {
                continue;
            }
            let mut seen: Vec<String> = Vec::new();
            let mut blockers = Vec::new();
            for t in &words {
                let k = lower(&t.text);
                if learned.dict.contains_key(&k) || seen.contains(&k) {
                    continue;
                }
                seen.push(k.clone());
                let amb = learned.ambiguous.get(&k);
                blockers.push(Blocker { word: t.text.clone(), reason: if amb.is_some() { BlockReason::Ambiguous } else { BlockReason::Unknown }, variants: amb.map_or(vec![], |a| a.iter().map(|x| x.0.clone()).collect()) });
            }
            if blockers.is_empty() || blockers.len() > 2 {
                continue;
            }
            out.push(Almost { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), blockers });
            if out.len() >= limit {
                return out;
            }
        }
    }
    out
}
