//! `termsync.ts`: коли перекладач змінює, як передано термін глосарія (меч → клинок), знаходяться рядки, що тримають старий варіант
//! у якомусь відмінку чи числі (мечем, залізних мечів), і для кожного пропонується той самий відмінок нового (клинком, сталевих клинків).
//! Тут нічого не записується: пропозиції показуються з упевненістю, перекладач відмічає, що застосувати, а `term_changes`
//! перетворює відмічене на одну дію журналу.
//!
//! Відмінність від TS: `start`/`end` проміжків — байтові зсуви в `before`, не одиниці UTF-16.

use crate::glossary::{has_term_in, prepare_text};
use crate::journal::RowChange;
use crate::js;
use crate::model::Status;
use crate::project::{FileView, SavedProject};
use crate::ukmorph::{level_of, uk_retarget, uk_word_forms, Alt, Conf, MorphDict, RetargetOpts};
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::LazyLock;

/// Варіанти передачі терміна (`uk` і `alt`).
pub struct TermRendering<'a> {
    pub en: &'a str,
    pub uk: &'a str,
    pub alt: &'a [String],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TermChange {
    pub en: String,
    /// Варіанти, яких уже нема.
    pub old: Vec<String>,
    /// Варіант, що їх замінює.
    pub next: String,
}

fn key(s: &str) -> String {
    js::trim(s).to_lowercase().replace(['\'', 'ʼ', '`'], "’")
}

/// Що зміна терміна означає для рядків: None, коли нічого міняти (новий термін, перейменований оригінал, перший варіант не змінився);
/// інакше варіанти, яких нема, і той, що їх замінює. Старий варіант, що лишився запасним, не чіпається.
pub fn term_change(prev: Option<&TermRendering>, next: &TermRendering) -> Option<TermChange> {
    let prev = prev?;
    if key(prev.en) != key(next.en) || key(prev.uk) == key(next.uk) {
        return None;
    }
    let kept: HashSet<String> = std::iter::once(next.uk).chain(next.alt.iter().map(String::as_str)).map(key).collect();
    let old: Vec<String> = std::iter::once(prev.uk).chain(prev.alt.iter().map(String::as_str)).filter(|f| !js::trim(f).is_empty() && !kept.contains(&key(f))).map(String::from).collect();
    (!old.is_empty()).then(|| TermChange { en: next.en.to_string(), old, next: js::trim(next.uk).to_string() })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermSpan {
    pub start: usize,
    pub end: usize,
    /// Текст, що стоїть там зараз.
    pub old: String,
    /// Що пропонується замість нього.
    pub text: String,
    pub conf: Conf,
    /// Інші форми того самого місця (спостережувана форма підходить до кількох відмінків, що дають різні нові форми).
    pub alts: Vec<Alt>,
    pub cells: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermProposal {
    pub file: String,
    pub key: String,
    pub source: String,
    pub before: String,
    pub after: String,
    pub spans: Vec<TermSpan>,
    /// Найслабший проміжок; без терміна в оригіналі — `low`.
    pub conf: Conf,
    /// В оригіналі рядка є термін (тож старий варіант був перекладом терміна, а не іншого слова).
    #[serde(rename = "hasSource")]
    pub has_source: bool,
    pub status: Status,
    /// Відмічено за замовчуванням: певно, і в оригіналі є термін.
    pub tick: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TermSync {
    /// Найкращі першими.
    pub proposals: Vec<TermProposal>,
    /// Скільки рядків тримають старий варіант; `proposals` обрізано до `limit`.
    pub total: usize,
    pub truncated: bool,
}

static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]+(?:['’ʼ`][\p{L}]+)*").unwrap());
static LEAD_NON_LETTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^\p{L}]+").unwrap());
const UK_CONS: &str = "бвгґджзклмнпрстфхцчшщ";

fn cons(c: Option<char>) -> bool {
    // `'абв'.includes('')` у JS істинне: порожній символ (слова нема) вважається приголосним
    c.is_none_or(|c| UK_CONS.contains(c))
}

/// Форма прийменника з/із/зі перед `next`: «зі» перед двома приголосними (зі звіром, зі змієм, зі шкіл, зі мною),
/// «з», коли «зі» стоїть перед одним приголосним чи голосним; «із» лишається. Інші слова не чіпаються.
fn euphony(prep: &str, next: &str) -> Option<String> {
    let low = prep.to_lowercase();
    if low != "з" && low != "із" && low != "зі" {
        return None;
    }
    let lowered = js::trim(next).to_lowercase();
    let w = LEAD_NON_LETTER.replace(&lowered, "");
    let mut it = w.chars();
    let (a, b) = (it.next(), it.next());
    let cluster = cons(a) && (cons(b) || b == Some('ь'));
    let want = if cluster {
        "зі".to_string()
    } else if low == "зі" {
        "з".to_string()
    } else {
        low
    };
    let first = prep.chars().next()?;
    if first.to_uppercase().next() == Some(first) && first.to_lowercase().next() != Some(first) {
        let mut c = want.chars();
        Some(c.next().map_or(String::new(), |f| f.to_uppercase().collect::<String>()) + c.as_str())
    } else {
        Some(want)
    }
}

fn between(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| js::is_space(c) || c == '-' || c == '–' || c == '—')
}
fn spaces_only(s: &str) -> bool {
    !s.is_empty() && s.chars().all(js::is_space)
}

fn rank(level: &str) -> u8 {
    match level {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    }
}

/// Текст із проміжками, заміненими їхніми пропозиціями (`choice[i]` обирає запасну форму проміжку `i`: -1 чи нема — головна).
pub fn apply_spans(before: &str, spans: &[TermSpan], choice: &[i64]) -> String {
    let mut out = before.to_string();
    for i in (0..spans.len()).rev() {
        let s = &spans[i];
        let c = choice.get(i).copied().unwrap_or(-1);
        let text = if c >= 0 { s.alts.get(c as usize).map_or(&s.text, |a| &a.text) } else { &s.text };
        out = format!("{}{}{}", &out[..s.start], text, &out[s.end..]);
    }
    out
}

/// Знаходить старі варіанти терміна в перекладах і пропонує заміну. Кожен варіант шукається за точними формами (усі відмінки й числа),
/// потім перевіряється як цілий вираз; слово, що лише схоже (мечник, клин), не береться. `limit` обрізає повернене, `total` — знайдене.
pub fn propose_term_sync(views: &[FileView], saved: &SavedProject, change: &TermChange, limit: usize, dict: Option<&dyn MorphDict>) -> TermSync {
    let olds: Vec<(&String, Vec<HashSet<String>>)> = change.old.iter().filter_map(|o| uk_word_forms(o, dict).filter(|s| !s.is_empty()).map(|s| (o, s))).collect();
    let mut all: Vec<TermProposal> = Vec::new();
    if olds.is_empty() {
        return TermSync { proposals: all, total: 0, truncated: false };
    }
    for v in views {
        let Some(ents) = saved.files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(e) = ents.get(&u.key).filter(|e| !js::trim(&e.target).is_empty()) else { continue };
            let t = e.target.as_str();
            struct Tok {
                w: String,
                start: usize,
                end: usize,
            }
            let toks: Vec<Tok> = WORD.find_iter(t).map(|m| Tok { w: m.as_str().to_lowercase().replace(['\'', 'ʼ', '`'], "’"), start: m.start(), end: m.end() }).collect();
            let mut spans: Vec<TermSpan> = Vec::new();
            for (phrase, sets) in &olds {
                let n = sets.len();
                let mut i = 0;
                while i + n <= toks.len() {
                    let at = i;
                    i += 1;
                    if !sets[0].contains(&toks[at].w) {
                        continue;
                    }
                    let mut ok = true;
                    for j in 1..n {
                        if !ok {
                            break;
                        }
                        ok = sets[j].contains(&toks[at + j].w) && between(&t[toks[at + j - 1].end..toks[at + j].start]);
                    }
                    if !ok {
                        continue;
                    }
                    let (start, end) = (toks[at].start, toks[at + n - 1].end);
                    if spans.iter().any(|s| start < s.end && end > s.start) {
                        continue;
                    }
                    let prev = (at > 0 && spaces_only(&t[toks[at - 1].end..start])).then(|| toks[at - 1].w.as_str());
                    let Some(r) = uk_retarget(phrase, &change.next, &t[start..end], &RetargetOpts { prev, dict }) else { continue };
                    // з/із/зі перед терміном іде за першими звуками нового слова (з вовком → зі звіром): прийменник входить у проміжок
                    let pt = if at > 0 && prev.is_some() { Some(&toks[at - 1]) } else { None };
                    let prep = pt.map(|p| &t[p.start..p.end]);
                    let eu = prep.and_then(|p| euphony(p, &r.text));
                    if let (Some(pt), Some(prep), Some(eu)) = (pt, prep, eu) {
                        if eu != prep {
                            let gap = &t[pt.end..start];
                            spans.push(TermSpan {
                                start: pt.start,
                                end,
                                old: t[pt.start..end].to_string(),
                                text: format!("{eu}{gap}{}", r.text),
                                conf: r.conf.clone(),
                                alts: r.alts.iter().map(|a| Alt { text: format!("{}{gap}{}", euphony(prep, &a.text).unwrap_or_else(|| "null".into()), a.text), conf: a.conf.clone() }).collect(),
                                cells: r.cells.clone(),
                            });
                            continue;
                        }
                    }
                    spans.push(TermSpan { start, end, old: t[start..end].to_string(), text: r.text.clone(), conf: r.conf.clone(), alts: r.alts.clone(), cells: r.cells.clone() });
                }
            }
            if spans.is_empty() {
                continue;
            }
            spans.sort_by_key(|s| s.start);
            let has_source = has_term_in(&prepare_text(&u.source), &change.en);
            let mut worst = spans[0].conf.clone();
            for s in &spans {
                if s.conf.score < worst.score {
                    worst = s.conf.clone();
                }
            }
            let conf = if has_source {
                worst
            } else {
                let score = worst.score.min(0.5);
                let mut flags = worst.flags.clone();
                flags.push("no-source".into());
                Conf { score, level: level_of(score), flags }
            };
            let tick = has_source && conf.level == "high" && !conf.flags.iter().any(|f| f == "gender-change");
            all.push(TermProposal { file: v.name.clone(), key: u.key.clone(), source: u.source.clone(), before: t.to_string(), after: apply_spans(t, &spans, &[]), spans, conf, has_source, status: e.status, tick });
        }
    }
    all.sort_by(|a, b| rank(a.conf.level).cmp(&rank(b.conf.level)).then_with(|| b.conf.score.partial_cmp(&a.conf.score).unwrap_or(std::cmp::Ordering::Equal)));
    let total = all.len();
    all.truncate(limit);
    TermSync { proposals: all, total, truncated: total > limit }
}

/// Рядки такими, якими вони стають після заміни. Статус рядка лишається (механічна зміна слова не скасовує надсилання чи вичитку);
/// історія показує «змінено термін» з новим текстом і тим, що було.
pub fn term_changes(picks: &[(&TermProposal, Vec<i64>)], saved: &SavedProject, now: i64) -> Vec<RowChange> {
    let mut out = Vec::new();
    for (p, choice) in picks {
        let Some(cur) = saved.files.get(&p.file).and_then(|m| m.get(&p.key)) else { continue };
        let after = apply_spans(&p.before, &p.spans, choice);
        // рядок, що змінився після створення пропозицій, не чіпається
        if cur.target != p.before || after == cur.target {
            continue;
        }
        let mut next = cur.clone();
        next.target = after.clone();
        next.mt = now;
        if cur.orig.is_some() {
            next.orig = Some(after.clone());
        }
        out.push(RowChange { file: p.file.clone(), key: p.key.clone(), text: after, next, what: None });
    }
    out
}
