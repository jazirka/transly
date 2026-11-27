//! `tm.ts`: пам'ять перекладів. Подібність за Левенштейном у відсотках; довгі тексти порівнюються по словах (у сотні разів менше
//! роботи, ніж по літерах). Індекс слів відбирає кандидатів, і лише найкращі кілька сотень оцінюються.
//!
//! Відмінність від TS: таблиця «слово → число» своя в кожному `TmIndex` (там вона одна на весь модуль); оцінки від цього не залежать.

use crate::controlcodes::display_length;
use crate::js;
use crate::wrap::unwrap;
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TmEntry {
    pub s: String,
    pub t: String,
    /// Звідки: ім'я файлу чи «Імпорт».
    pub src: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TmMatch {
    pub s: String,
    pub t: String,
    pub src: String,
    pub score: i64,
}

static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+\[[0-9]+\]|\\[{}.|!><^$]").unwrap());
static NON_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());

/// Малі літери, коди й усе, що не літера й не цифра, — пробіли; краї обрізано.
pub fn norm(t: &str) -> String {
    let a = CODE.replace_all(&t.to_lowercase(), " ").into_owned();
    js::trim(&NON_WORD.replace_all(&a, " ")).to_string()
}
fn words(t: &str) -> Vec<String> {
    norm(t).split(' ').filter(|w| !w.is_empty()).map(String::from).collect()
}

/// Від скількох літер (у довшому з двох текстів) збіг рахується по словах.
const LONG_TEXT: usize = 240;

fn codes(t: &str) -> Vec<i32> {
    t.chars().map(|c| c as i32).collect()
}

/// Подібність двох текстів, заданих кодовими точками; див. `similarity`.
fn score_codes(x: &[i32], y: &[i32], min: f64) -> i64 {
    let (n, m) = (x.len() as i64, y.len() as i64);
    if n == 0 || m == 0 {
        return 0;
    }
    let longest = n.max(m);
    // оцінка округлюється, тож пара на півбала нижче `min` ще може округлитися до нього: запас міряється звідти (і волосина на плаваючу кому)
    let room: i64 = if min > 0.0 { (longest as f64 * (1.0 - (min - 0.5) / 100.0) + 1e-9).floor() as i64 } else { longest };
    if (n - m).abs() > room {
        return 0;
    }
    const FAR: i32 = 1 << 20;
    let mut prev = vec![0i32; m as usize + 2];
    let mut cur = vec![0i32; m as usize + 2];
    // лише смуга клітинок на відстані `room` від діагоналі може тримати відстань не більше `room`: решта пропускається
    for j in 0..=m {
        prev[j as usize] = if j <= room { j as i32 } else { FAR };
    }
    prev[m as usize + 1] = FAR;
    for i in 1..=n {
        let lo = (i - room).max(1);
        let hi = m.min(i + room);
        cur[(lo - 1) as usize] = if lo == 1 { i as i32 } else { FAR };
        let mut best = FAR;
        let xi = x[(i - 1) as usize];
        let mut j = lo;
        while j <= hi {
            let ju = j as usize;
            let mut v = prev[ju - 1] + i32::from(xi != y[ju - 1]);
            let del = prev[ju] + 1;
            let ins = cur[ju - 1] + 1;
            if del < v {
                v = del;
            }
            if ins < v {
                v = ins;
            }
            cur[ju] = v;
            if v < best {
                best = v;
            }
            j += 1;
        }
        cur[(hi + 1) as usize] = FAR;
        // будь-який шлях через наступні рядки проходить клітинку цього: коли всі вони за межею запасу, пара задалеко
        if best as i64 > room {
            return 0;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    let d = prev[m as usize] as i64;
    if d > room {
        return 0;
    }
    ((1.0 - d as f64 / longest as f64) * 100.0 + 0.5).floor() as i64
}

/// Подібність за Левенштейном у відсотках (0–100) між двома короткими рядками. З `min` робота зупиняється, щойно пара не може
/// досягти цієї оцінки: відповідь тоді 0, і вона точна, коли не менша за `min`.
pub fn similarity(a: &str, b: &str, min: f64) -> i64 {
    if a == b {
        return 100;
    }
    score_codes(&codes(a), &codes(b), min)
}

struct Indexed {
    e: TmEntry,
    w: Vec<String>,
    len: usize,
    /// Пару вилучено (див. `TmIndex::remove`): місце в індексі лишається, але збігом вона не стає.
    dead: bool,
}

/// Пошуковий індекс по перекладених парах. Будується раз; запит — на кожен вибраний рядок.
pub struct TmIndex {
    items: Vec<Indexed>,
    by_word: HashMap<String, Vec<usize>>,
    word_ids: std::cell::RefCell<HashMap<String, i32>>,
    /// Переноси в перекладах поставлено під вікно гри (перенесення «у тексті»): збіги повертають їх одним потоком.
    flow: bool,
}

#[derive(Default)]
pub struct FindOpts<'a> {
    pub min: Option<f64>,
    pub limit: Option<usize>,
    pub exclude: Option<&'a dyn Fn(&TmEntry) -> bool>,
}

impl TmIndex {
    pub fn new(flow: bool) -> TmIndex {
        TmIndex { items: Vec::new(), by_word: HashMap::new(), word_ids: Default::default(), flow }
    }

    fn word_codes(&self, n: &str) -> Vec<i32> {
        let mut ids = self.word_ids.borrow_mut();
        let mut out = Vec::new();
        for w in n.split(' ') {
            if w.is_empty() {
                continue;
            }
            let next = ids.len() as i32 + 1;
            out.push(*ids.entry(w.to_string()).or_insert(next));
        }
        out
    }

    pub fn add(&mut self, e: TmEntry) {
        if js::trim(&e.s).is_empty() || js::trim(&e.t).is_empty() {
            return;
        }
        let mut w: Vec<String> = Vec::new();
        for x in words(&e.s) {
            if !w.contains(&x) {
                w.push(x);
            }
        }
        let id = self.items.len();
        let len = display_length(&e.s);
        for x in &w {
            self.by_word.entry(x.clone()).or_default().push(id);
        }
        self.items.push(Indexed { e, w, len, dead: false });
    }

    /// Вилучає пару (оригінал, переклад, файл): рядок змінили, і його стара пара не повинна лишатися підказкою. Індекс не перебудовується.
    pub fn remove(&mut self, e: &TmEntry) -> bool {
        let words: Vec<String> = words(&e.s);
        let Some(first) = words.first() else { return false };
        let Some(ids) = self.by_word.get(first) else { return false };
        for &id in ids {
            let it = &mut self.items[id];
            if !it.dead && it.e == *e {
                it.dead = true;
                return true;
            }
        }
        false
    }

    pub fn size(&self) -> usize {
        self.items.iter().filter(|i| !i.dead).count()
    }

    /// Пари, чий оригінал чи переклад має кожне слово `query` (для перегляду пам'яті за словом), не більше `limit`, найкоротші першими.
    pub fn search(&self, query: &str, limit: usize) -> Vec<TmEntry> {
        let qw = words(query);
        if qw.is_empty() {
            return Vec::new();
        }
        let mut out: Vec<&Indexed> = Vec::new();
        for &id in self.by_word.get(&qw[0]).map_or(&[][..], |v| v.as_slice()) {
            let it = &self.items[id];
            if !it.dead && qw.iter().all(|w| it.w.contains(w)) {
                out.push(it);
            }
        }
        // слово, що є лише в перекладі, шукається за його текстом
        if out.is_empty() {
            let q = qw.join(" ");
            for it in self.items.iter().filter(|i| !i.dead) {
                if norm(&it.e.t).contains(&q) {
                    out.push(it);
                    if out.len() >= limit * 4 {
                        break;
                    }
                }
            }
        }
        out.sort_by_key(|i| i.len);
        out.into_iter().take(limit).map(|i| i.e.clone()).collect()
    }

    /// Найкращі збіги для `source`, найвища оцінка першою. Рядок ніколи не пропонує сам себе (той самий текст і той самий переклад).
    pub fn find(&self, source: &str, opts: &FindOpts) -> Vec<TmMatch> {
        let min = opts.min.unwrap_or(60.0);
        let limit = opts.limit.unwrap_or(5);
        let mut qw: Vec<String> = Vec::new();
        for x in words(source) {
            if !qw.contains(&x) {
                qw.push(x);
            }
        }
        if qw.is_empty() {
            return Vec::new();
        }
        // відбір кандидатів: хоча б одне спільне слово, ранжування за перетином, далі оцінюються лише кращі кілька сотень
        let mut hits: IndexMap<usize, usize> = IndexMap::new();
        for x in &qw {
            for &id in self.by_word.get(x).map_or(&[][..], |v| v.as_slice()) {
                *hits.entry(id).or_insert(0) += 1;
            }
        }
        let mut cands: Vec<(usize, usize)> = hits.into_iter().collect();
        cands.sort_by_key(|c| std::cmp::Reverse(c.1));
        cands.truncate(300);
        let qn = norm(source);
        let ql = display_length(source);
        let qc = codes(&qn);
        let mut qw2: Option<Vec<i32>> = None;
        let mut out: Vec<TmMatch> = Vec::new();
        // коли `limit` збігів набрано, кандидат важить, лише якщо оцінений не гірше за найслабший з них: оцінка здається на решті раніше
        let mut floor = min;
        for (id, overlap) in cands {
            let it = &self.items[id];
            if it.dead || opts.exclude.is_some_and(|f| f(&it.e)) {
                continue;
            }
            let union = qw.len() + it.w.len() - overlap;
            if (overlap as f64) / (union as f64) < 0.3 {
                continue;
            }
            if (it.len as f64 - ql as f64).abs() > (ql.max(it.len) as f64) * 0.6 {
                continue;
            }
            let ns = norm(&it.e.s);
            let score = if qn == ns {
                100
            } else if js::len16(&qn).max(js::len16(&ns)) > LONG_TEXT {
                let q2 = qw2.get_or_insert_with(|| self.word_codes(&qn));
                score_codes(q2, &self.word_codes(&ns), floor)
            } else {
                score_codes(&qc, &codes(&ns), floor)
            };
            if score as f64 >= min {
                out.push(TmMatch { s: it.e.s.clone(), t: if self.flow { unwrap(&it.e.t) } else { it.e.t.clone() }, src: it.e.src.clone(), score });
                if out.len() >= limit {
                    let mut sc: Vec<i64> = out.iter().map(|m| m.score).collect();
                    sc.sort_by(|a, b| b.cmp(a));
                    let kth = sc[limit - 1];
                    if kth as f64 > floor {
                        floor = kth as f64;
                    }
                }
            }
        }
        out.sort_by_key(|m| std::cmp::Reverse(m.score));
        out.truncate(limit);
        out
    }
}
