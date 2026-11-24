//! `glossary.ts`: ключі слів (англійська й українська), токенізація, пошук термінів і шаблонів («take … off»).
//! Усі позиції (`start`/`end`) — у кодових одиницях UTF-16, як у JS; всередині Rust працює з байтовими зсувами окремо.
//!
//! Не перенесено: кеші `touchTerms`/`termsStamp`/індекс за `WeakMap` — це механіка JS-посилань; у Rust кешування
//! буде влаштоване окремо (результати від нього не залежать). Відома відмінність: слово `constructor` в англійському
//! тексті в TS потрапляє у прототип об'єкта `EN_IRREGULAR` (помилка TS), тут обробляється як звичайне слово.

use crate::js;
use crate::ukmorph::{uk_norm, uk_word_forms};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::LazyLock;

/// Рід перекладу: чоловічий, жіночий, середній або лише множина.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TermGender {
    #[serde(rename = "m")]
    M,
    #[serde(rename = "f")]
    F,
    #[serde(rename = "n")]
    N,
    #[serde(rename = "p")]
    P,
}
pub const TERM_GENDERS: [TermGender; 4] = [TermGender::M, TermGender::F, TermGender::N, TermGender::P];

/// Пара «англійською — українською» (`Term` з qa.ts).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Term {
    pub en: String,
    pub uk: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<Vec<String>>,
    /// false = лише підказка.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qa: Option<bool>,
}

/// Запис глосарія. Імпортовані словники мають `qa: false`: допомагають, але не дають попереджень QA.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlossaryTerm {
    pub en: String,
    pub uk: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qa: Option<bool>,
    pub mt: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gender: Option<TermGender>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

fn is_cyrillic(w: &str) -> bool {
    w.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
}
fn norm_apostrophes(s: &str) -> String {
    s.replace(['\'', '’', 'ʼ', '`'], "'")
}
fn cut(s: &str, n: usize) -> String {
    let len = s.chars().count();
    s.chars().take(len.saturating_sub(n)).collect()
}

/* ---------- англійська ---------- */

static EN_IRREGULAR: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    [
        ("knives", "knife"), ("wolves", "wolf"), ("leaves", "leaf"), ("lives", "life"), ("halves", "half"), ("thieves", "thief"), ("shelves", "shelf"), ("men", "man"), ("women", "woman"), ("children", "child"), ("feet", "foot"), ("teeth", "tooth"), ("mice", "mouse"), ("geese", "goose"), ("oxen", "ox"), ("people", "person"), ("dice", "die"), ("staves", "staff"),
        ("took", "take"), ("taken", "take"), ("gave", "give"), ("given", "give"), ("went", "go"), ("gone", "go"), ("came", "come"), ("made", "make"), ("got", "get"), ("gotten", "get"), ("ran", "run"), ("seen", "see"), ("knew", "know"), ("known", "know"),
        ("threw", "throw"), ("thrown", "throw"), ("drew", "draw"), ("drawn", "draw"), ("wore", "wear"), ("worn", "wear"), ("broke", "break"), ("broken", "break"), ("fell", "fall"), ("fallen", "fall"), ("ate", "eat"), ("eaten", "eat"), ("drank", "drink"), ("drunk", "drink"),
        ("rode", "ride"), ("ridden", "ride"), ("sang", "sing"), ("sung", "sing"), ("swam", "swim"), ("swum", "swim"), ("held", "hold"), ("kept", "keep"), ("brought", "bring"), ("bought", "buy"), ("caught", "catch"), ("taught", "teach"), ("sold", "sell"), ("told", "tell"),
        ("stood", "stand"), ("sat", "sit"), ("spoke", "speak"), ("spoken", "speak"), ("woke", "wake"), ("woken", "wake"), ("chose", "choose"), ("chosen", "choose"), ("hid", "hide"), ("hidden", "hide"), ("blew", "blow"), ("blown", "blow"), ("grew", "grow"), ("grown", "grow"),
        ("flew", "fly"), ("flown", "fly"), ("shook", "shake"), ("shaken", "shake"), ("forgot", "forget"), ("forgotten", "forget"), ("froze", "freeze"), ("frozen", "freeze"), ("stole", "steal"), ("stolen", "steal"), ("wrote", "write"), ("written", "write"),
        ("began", "begin"), ("begun", "begin"), ("sent", "send"), ("built", "build"), ("lay", "lie"), ("laid", "lay"), ("paid", "pay"), ("said", "say"), ("slept", "sleep"), ("met", "meet"), ("led", "lead"), ("fought", "fight"), ("sought", "seek"),
    ]
    .into_iter()
    .collect()
});

static EN_SPELLING: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    [
        ("centre", "center"), ("theatre", "theater"), ("metre", "meter"), ("litre", "liter"), ("fibre", "fiber"), ("calibre", "caliber"), ("sabre", "saber"), ("sombre", "somber"), ("lustre", "luster"), ("spectre", "specter"), ("grey", "gray"), ("mould", "mold"), ("plough", "plow"), ("cheque", "check"), ("tyre", "tire"), ("sceptic", "skeptic"), ("artefact", "artifact"), ("catalogue", "catalog"), ("dialogue", "dialog"), ("analogue", "analog"), ("aluminium", "aluminum"), ("jewellery", "jewelry"), ("moustache", "mustache"), ("speciality", "specialty"), ("ageing", "aging"), ("towards", "toward"), ("learnt", "learned"), ("burnt", "burned"), ("spelt", "spelled"), ("dreamt", "dreamed"), ("judgement", "judgment"), ("manoeuvre", "maneuver"), ("sulphur", "sulfur"), ("cosy", "cozy"), ("draught", "draft"), ("kerb", "curb"), ("storey", "story"), ("pyjamas", "pajamas"), ("mum", "mom"), ("whilst", "while"), ("amongst", "among"), ("gaol", "jail"), ("paralyse", "paralyze"), ("cancelled", "canceled"), ("cancelling", "canceling"),
    ]
    .into_iter()
    .collect()
});

static EN_OUR: LazyLock<Regex> = LazyLock::new(|| Regex::new("^(arm|col|hon|fav|flav|lab|neighb|rum|sav|vap|harb|hum|behavi|endeav|glam|od|rig|vig|val|splend|ferv|clam|cand|parl|savi|demean)our").unwrap());
static EN_CE: LazyLock<Regex> = LazyLock::new(|| Regex::new("^(defen|offen|licen|preten)ce").unwrap());
static EN_ISE: LazyLock<Regex> = LazyLock::new(|| Regex::new("([a-z]{2,})is(e|ed|es|ing|ation|ations|er|ers)$").unwrap());
static EN_YSE: LazyLock<Regex> = LazyLock::new(|| Regex::new("([a-z]{2,})ys(e|ed|es|ing)$").unwrap());
static EN_LL: LazyLock<Regex> = LazyLock::new(|| Regex::new("([aeiou])ll(ed|ing|er|ers)$").unwrap());

fn en_spelling(w: &str) -> String {
    if let Some(k) = EN_SPELLING.get(w) {
        return k.to_string();
    }
    // англійського слова такої довжини немає: ряд літер такої довжини (ворожий рядок) не перебирається шаблонами з усіх позицій
    if js::len16(w) > 40 {
        return w.to_string();
    }
    let r = EN_OUR.replace(w, "${1}or").into_owned();
    let r = EN_CE.replace(&r, "${1}se").into_owned();
    let r = EN_ISE.replace(&r, "${1}iz${2}").into_owned();
    let r = EN_YSE.replace(&r, "${1}yz${2}").into_owned();
    EN_LL.replace(&r, "${1}l${2}").into_owned()
}

/// Ключі одного англійського слова: форма без закінчень множини/дієслова. Термін бере перший, текст — усі.
fn en_keys(raw: &str) -> Vec<String> {
    let mut w = norm_apostrophes(&raw.to_lowercase());
    if w.ends_with("'s") {
        w.truncate(w.len() - 2);
    } else if w.ends_with('\'') {
        w.truncate(w.len() - 1);
    }
    if let Some(x) = EN_IRREGULAR.get(w.as_str()) {
        w = x.to_string();
    }
    w = en_spelling(&w);
    if !w.is_empty() && w.chars().all(|c| c.is_ascii_digit()) {
        return vec![w];
    }
    let len = js::len16(&w);
    if len > 4 && w.ends_with("ies") {
        return vec![cut(&w, 3) + "y"];
    }
    if len > 4 && ["sses", "uses", "ises", "shes", "ches", "xes", "zes"].iter().any(|e| w.ends_with(e)) {
        return vec![cut(&w, 2)];
    }
    if len > 3 && w.ends_with('s') && !(w.ends_with("ss") || w.ends_with("us") || w.ends_with("is")) {
        return vec![cut(&w, 1)];
    }
    let mut out = vec![w.clone()];
    let mut derived = |stem: String| {
        if js::len16(&stem) < 3 {
            return;
        }
        out.push(stem.clone());
        out.push(format!("{stem}e"));
        let ch: Vec<char> = stem.chars().collect();
        let k = ch.len();
        if k >= 2 && ch[k - 1] == ch[k - 2] && !"aeioulsfz".contains(ch[k - 1]) {
            out.push(cut(&stem, 1)); // running → runn → run
        }
    };
    if len > 5 && w.ends_with("ing") {
        derived(cut(&w, 3));
    } else if len > 4 && w.ends_with("ed") {
        derived(cut(&w, 2));
    }
    out
}

/* ---------- українська ---------- */

static UK_ENDINGS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    let mut v = vec![
        "ськими", "ськими", "ського", "ськими", "ами", "ями", "ові", "еві", "єві", "ого", "ому", "ими", "іми", "ою", "ею", "єю", "ої", "ую", "юю", "ий", "ій", "їй", "ів", "їв", "ам", "ям", "ах", "ях", "ом", "ем", "єм", "ей", "ать", "ять", "ють", "уть", "ати", "яти", "ити", "ути", "ає", "яє", "ює", "ає", "ав", "ив", "ла", "ли", "ло", "а", "я", "у", "ю", "і", "ї", "и", "е", "є", "о", "ь", "й",
    ];
    v.sort_by_key(|a| std::cmp::Reverse(a.chars().count()));
    v
});

/// Основа українського слова, що переживає відмінювання: закінчення відрізано, чергування вирівняно (г/з/ж, к/ц/ч, х/с/ш
/// наприкінці; і/о всередині), щоб «нога/нозі», «рука/руці», «кінь/коня» збігалися.
fn uk_key(raw: &str) -> String {
    let mut w: String = raw.to_lowercase().chars().filter(|c| !matches!(c, '\'' | '’' | 'ʼ' | '`')).collect();
    if js::len16(&w) >= 4 {
        for e in UK_ENDINGS.iter() {
            if w.ends_with(e) && js::len16(&w) - js::len16(e) >= 3 {
                w = cut(&w, e.chars().count());
                break;
            }
        }
    }
    // родовий множини з голосним, що випадає: навичок → навичк, кінець → кінц
    if js::len16(&w) >= 5 {
        let ch: Vec<char> = w.chars().collect();
        let k = ch.len();
        if k >= 3 && "кц".contains(ch[k - 1]) && "оеє".contains(ch[k - 2]) && "бвгґджзклмнпрстфхцчшщ".contains(ch[k - 3]) {
            w = ch[..k - 2].iter().collect::<String>() + &ch[k - 1].to_string();
        }
    }
    let mut ch: Vec<char> = w.chars().map(|c| if c == 'і' { 'о' } else { c }).collect();
    if let Some(l) = ch.last_mut() {
        if "гзж".contains(*l) {
            *l = 'г';
        } else if "кцч".contains(*l) {
            *l = 'к';
        } else if "хсш".contains(*l) {
            *l = 'х';
        }
    }
    ch.into_iter().collect()
}

/* ---------- токени ---------- */

/// Слово тексту з місцем (UTF-16) і ключами, за якими воно порівнюється.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Token {
    pub start: usize,
    pub end: usize,
    pub keys: Vec<String>,
    /// Байтові зсуви в тексті (для зрізів у Rust); не входять у JSON.
    #[serde(skip)]
    pub bs: usize,
    #[serde(skip)]
    pub be: usize,
}
pub type WordToken = Token;

static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]+(?:['’ʼ`]\p{L}+)*").unwrap());

pub fn word_tokens(text: &str) -> Vec<Token> {
    tokens(text)
}

/// Чи належать два ключі українських слів одному слову: один — початок іншого, а дуже короткий ключ має збігатися повністю.
pub fn uk_stems_agree(hay: &str, need: &str) -> bool {
    hay == need || prefix_agrees(hay, need) || prefix_agrees(need, hay)
}

type Forms = Option<Vec<HashSet<String>>>;
thread_local! {
    static FORMS_MEMO: RefCell<HashMap<String, Rc<Forms>>> = RefCell::new(HashMap::new());
}
/// Усі форми кожного слова української фрази (None, коли фраза не кирилична або не відмінюється).
pub fn phrase_forms(phrase: &str) -> Rc<Forms> {
    if !is_cyrillic(phrase) {
        return Rc::new(None);
    }
    FORMS_MEMO.with(|m| {
        if let Some(f) = m.borrow().get(phrase) {
            return f.clone();
        }
        let f = Rc::new(uk_word_forms(phrase, None));
        let mut m = m.borrow_mut();
        if m.len() > 2000 {
            m.clear();
        }
        m.insert(phrase.to_string(), f.clone());
        f
    })
}
/// Чи слово тексту (ключ і літери) — слово `j` фрази: за основами або, де основи не розрізняють («майстер» — «майстра»), за точними формами.
pub fn word_agrees(forms: &Forms, j: usize, text: &str, key: &str, need: &str) -> bool {
    uk_stems_agree(key, need) || forms.as_ref().and_then(|f| f.get(j)).is_some_and(|s| s.contains(&uk_norm(text)))
}
/// `long` починається з `short`: для короткого ключа лише одна літера більше — те саме слово, не «богдан».
fn prefix_agrees(long: &str, short: &str) -> bool {
    let (ls, ll) = (js::len16(short), js::len16(long));
    ls >= 3 && long.starts_with(short) && (ls >= 5 || ll - ls <= 1)
}

fn tokens(text: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let (mut byte, mut u16pos) = (0usize, 0usize);
    for m in WORD.find_iter(text) {
        u16pos += text[byte..m.start()].encode_utf16().count();
        let start = u16pos;
        u16pos += m.as_str().encode_utf16().count();
        byte = m.end();
        let word = m.as_str();
        out.push(Token { start, end: u16pos, keys: if is_cyrillic(word) { vec![uk_key(word)] } else { en_keys(word) }, bs: m.start(), be: m.end() });
    }
    out
}

/// Текст оригіналу, розбитий на слова один раз, щоб дешево пробувати багато термінів.
#[derive(Clone, Debug)]
pub struct PreparedText {
    pub text: String,
    pub tokens: Vec<Token>,
}
static CODES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[A-Za-z]+\[[0-9]+\]|\\[{}.|!><^$]").unwrap());
/// Керівні коди (`\N[1]`, `\C[2]`) — не слова: перед розбиттям вони замінюються пробілами.
pub fn prepare_text(text: &str) -> PreparedText {
    let blank = CODES.replace_all(text, |c: &regex::Captures| " ".repeat(c[0].len())).into_owned();
    let tokens = tokens(&blank);
    PreparedText { text: blank, tokens }
}

fn term_keys(en: &str) -> Vec<String> {
    tokens(en).into_iter().map(|t| t.keys[0].clone()).collect()
}

/* ---------- шаблони ---------- */

pub const GAP: &str = "…";
static GAP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*(?:…|\.{3})\s*").unwrap());
/// Скільки слів може стояти між частинами шаблону: в оригіналі й у перекладі (порядок слів там вільніший).
pub const EN_GAP: usize = 4;
pub const UK_GAP: usize = 6;

pub fn has_gap(s: &str) -> bool {
    GAP_RE.is_match(s)
}
/// Відрізки слів, що стоять разом між пропусками: «take … off» — це «take» і «off».
pub fn pattern_parts(s: &str) -> Vec<String> {
    GAP_RE.split(s).map(|x| js::trim(x).to_string()).filter(|x| !x.is_empty()).collect()
}
pub fn normalize_gap(s: &str) -> String {
    js::trim(&GAP_RE.replace_all(s, format!(" {GAP} ").as_str())).to_string()
}

/// Одна частина шаблону: скільки в ній слів і чи вона стоїть на слові `i`.
pub struct PartMatcher<'a> {
    pub len: usize,
    pub at: Box<dyn Fn(usize) -> bool + 'a>,
}

/// Між двома частинами шаблону закінчується речення: вони не належать одна одній.
fn has_break(s: &str) -> bool {
    s.contains(['.', '!', '?', ';', '\n'])
}
/// `/^[\s\-–—]+$/`
pub fn is_sep(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| js::is_space(c) || matches!(c, '-' | '–' | '—'))
}

/// Місця, де стоять усі частини шаблону по черзі, з не більше `max_gap` слів між частинами й без кінця речення між ними.
pub fn match_chain(toks: &[Token], text: &str, parts: &[PartMatcher], max_gap: usize) -> Vec<Vec<(usize, usize)>> {
    let mut out = Vec::new();
    let Some(first) = parts.first() else { return out };
    if first.len < 1 {
        return out;
    }
    let mut i = 0;
    while i + first.len <= toks.len() {
        if (first.at)(i) {
            let mut spans = vec![(toks[i].start, toks[i + first.len - 1].end)];
            let mut end = i + first.len - 1;
            let mut ok = true;
            for part in &parts[1..] {
                if !ok {
                    break;
                }
                ok = false;
                let mut j = end + 1;
                while j <= end + 1 + max_gap && j + part.len <= toks.len() {
                    if has_break(&text[toks[end].be..toks[j].bs]) {
                        break;
                    }
                    if (part.at)(j) {
                        spans.push((toks[j].start, toks[j + part.len - 1].end));
                        end = j + part.len - 1;
                        ok = true;
                        break;
                    }
                    j += 1;
                }
            }
            if ok {
                out.push(spans);
            }
        }
        i += 1;
    }
    out
}

/// Ключ першого слова терміна чи шаблону: кожен текст з терміном має слово з цим ключем.
pub fn term_first_key(en: &str) -> Option<String> {
    term_keys(js::trim(en)).into_iter().next()
}

pub fn term_ranges_in(p: &PreparedText, en: &str) -> Vec<(usize, usize)> {
    term_matches_in(p, en).into_iter().flatten().collect()
}

/// Де стоїть термін: по одному списку діапазонів на входження (простий термін — один діапазон, шаблон — по одному на частину).
pub fn term_matches_in(p: &PreparedText, en: &str) -> Vec<Vec<(usize, usize)>> {
    let e = js::trim(en);
    if !has_gap(e) {
        return plain_ranges(p, e).into_iter().map(|r| vec![r]).collect();
    }
    let parts = pattern_parts(e);
    if parts.len() < 2 {
        return plain_ranges(p, parts.first().map_or("", |s| s.as_str())).into_iter().map(|r| vec![r]).collect();
    }
    let keys: Vec<Vec<String>> = parts.iter().map(|part| term_keys(part)).collect();
    if keys.iter().any(|k| k.is_empty()) {
        return Vec::new();
    }
    let t = &p.tokens;
    let matchers: Vec<PartMatcher> = keys
        .iter()
        .map(|need| PartMatcher {
            len: need.len(),
            at: Box::new(move |i| need.iter().enumerate().all(|(j, k)| t[i + j].keys.contains(k) && (j == 0 || is_sep(&p.text[t[i + j - 1].be..t[i + j].bs])))),
        })
        .collect();
    match_chain(t, &p.text, &matchers, EN_GAP)
}

fn plain_ranges(p: &PreparedText, en: &str) -> Vec<(usize, usize)> {
    let need = term_keys(en);
    let mut out = Vec::new();
    if need.is_empty() {
        return out;
    }
    let t = &p.tokens;
    let mut i = 0;
    while i + need.len() <= t.len() {
        let ok = (0..need.len()).all(|j| t[i + j].keys.contains(&need[j]) && (j == 0 || is_sep(&p.text[t[i + j - 1].be..t[i + j].bs])));
        if ok {
            out.push((t[i].start, t[i + need.len() - 1].end));
        }
        i += 1;
    }
    out
}

pub fn has_term_in(p: &PreparedText, en: &str) -> bool {
    !term_ranges_in(p, en).is_empty()
}
/// Чи є в тексті англійський термін у будь-якій формі множини, дієслова чи британського/американського написання. Лише цілі слова.
pub fn has_term(text: &str, en: &str) -> bool {
    has_term_in(&prepare_text(text), en)
}
/// Діапазони терміна в тексті (для підсвічування).
pub fn term_ranges(text: &str, en: &str) -> Vec<(usize, usize)> {
    term_ranges_in(&prepare_text(text), en)
}

/// Індекси термінів, які можуть траплятися в підготовленому тексті (дешевий префільтр; підтверджувати `has_term_in`).
pub fn candidate_terms(p: &PreparedText, terms: &[Term]) -> Vec<usize> {
    let seen: HashSet<&str> = p.tokens.iter().flat_map(|t| t.keys.iter().map(|k| k.as_str())).collect();
    terms
        .iter()
        .enumerate()
        .filter(|(_, t)| term_first_key(&t.en).is_some_and(|k| seen.contains(k.as_str())))
        .map(|(i, _)| i)
        .collect()
}

/// Терміни, англійська форма яких є в тексті оригіналу (індекси в `terms`).
pub fn terms_in(source: &str, terms: &[Term]) -> Vec<usize> {
    let p = prepare_text(source);
    candidate_terms(&p, terms).into_iter().filter(|&i| has_term_in(&p, &terms[i].en)).collect()
}

/// Чи є в `target` український термін (або один із варіантів)? Кожне слово порівнюється за основою: будь-який відмінок, число, закінчення.
pub fn target_has_term(target: &str, uk: &str, alt: &[String]) -> bool {
    let toks = tokens(target);
    let hay: Vec<&str> = toks.iter().map(|t| t.keys[0].as_str()).collect();
    let has = |phrase: &str| -> bool {
        if has_gap(phrase) && pattern_parts(phrase).len() > 1 {
            return !term_matches_in_target(target, phrase).is_empty();
        }
        let need: Vec<String> = tokens(phrase).into_iter().map(|t| t.keys[0].clone()).collect();
        if need.is_empty() {
            return false;
        }
        let forms = phrase_forms(phrase);
        // Слова фрази стоять поряд (між ними лише пробіли чи дефіс), те саме правило, що й підсвічування в редакторі:
        // переклад, де слова розкидані рядком, «не має терміна».
        let mut i = 0;
        while i + need.len() <= hay.len() {
            let ok = (0..need.len()).all(|j| word_agrees(&forms, j, &target[toks[i + j].bs..toks[i + j].be], hay[i + j], &need[j]) && (j == 0 || is_sep(&target[toks[i + j - 1].be..toks[i + j].bs])));
            if ok {
                return true;
            }
            i += 1;
        }
        false
    };
    std::iter::once(uk).chain(alt.iter().map(|s| s.as_str())).any(has)
}

/// Де в перекладі стоїть український шаблон («зняти … з»): по списку діапазонів на входження, по одному на частину, по черзі,
/// з не більше `UK_GAP` слів між ними. Шаблон з однією частиною (пропуск лише з краю) — просто ця фраза.
pub fn term_matches_in_target(text: &str, phrase: &str) -> Vec<Vec<(usize, usize)>> {
    let parts = pattern_parts(phrase);
    let toks = tokens(text);
    let mut matchers: Vec<PartMatcher> = Vec::new();
    for part in &parts {
        let need: Vec<String> = tokens(part).into_iter().map(|t| t.keys[0].clone()).collect();
        if need.is_empty() {
            continue;
        }
        let forms = phrase_forms(part);
        let toks = &toks;
        matchers.push(PartMatcher {
            len: need.len(),
            at: Box::new(move |i| (0..need.len()).all(|j| word_agrees(&forms, j, &text[toks[i + j].bs..toks[i + j].be], &toks[i + j].keys[0], &need[j]) && (j == 0 || is_sep(&text[toks[i + j - 1].be..toks[i + j].bs])))),
        });
    }
    if matchers.is_empty() { Vec::new() } else { match_chain(&toks, text, &matchers, UK_GAP) }
}

/// Розбирає рядки «english<TAB>українською» (також `;`). Повертає вірні пари й кількість відкинутих рядків.
pub fn parse_terms(text: &str) -> (Vec<Term>, usize) {
    let mut terms = Vec::new();
    let mut rejected = 0;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if js::trim(line).is_empty() {
            continue;
        }
        let parts: Vec<&str> = if line.contains('\t') { line.split('\t').collect() } else { line.split(';').collect() };
        let en = parts.first().map(|s| js::trim(s)).unwrap_or("");
        let uk = parts.get(1).map(|s| js::trim(s)).unwrap_or("");
        if !en.is_empty() && !uk.is_empty() {
            terms.push(Term { en: en.to_string(), uk: uk.to_string(), alt: None, qa: None });
        } else {
            rejected += 1;
        }
    }
    (terms, rejected)
}
