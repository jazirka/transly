//! `qarules.ts`: реєстр правил QA про форму перекладу (літери, пробіли, апострофи, пошкоджені керівні коди). Кожне правило дивиться
//! на оригінал і переклад і дає одну примітку з місцями; коли кожне місце має однозначне виправлення, примітка несе готове
//! (весь переклад зі всіма виправленнями). Id правила зберігається в списку ігнорованих приміток рядка, тож id не змінюються.
//!
//! Рівень правила — вибір проєкту: `off`, `warn` (порада: показується й виправляється одним кліком, нічого не блокує) або
//! `bad` (помилка: рядок не можна надіслати чи зібрати, доки не виправлено).
//!
//! Не перенесено: правила плагінів (`setPluginQaRules`) — динамічний реєстр, прийде разом із `ext/*`.
//! Позиції — індекси символів (див. `qacodes`).

use crate::js;
use crate::qa::{Issue, IssueCat, IssueFix, Severity};
use crate::qacodes::*;
use fancy_regex::Regex as FRegex;
use indexmap::IndexMap;
use regex::Regex;
use std::cell::OnceCell;
use std::collections::HashSet;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleSeverity {
    Off,
    Warn,
    Bad,
}
impl RuleSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            RuleSeverity::Off => "off",
            RuleSeverity::Warn => "warn",
            RuleSeverity::Bad => "bad",
        }
    }
    pub fn parse(s: &str) -> Option<RuleSeverity> {
        match s {
            "off" => Some(RuleSeverity::Off),
            "warn" => Some(RuleSeverity::Warn),
            "bad" => Some(RuleSeverity::Bad),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct QaRules {
    /// Рівень кожного правила за id.
    pub sev: IndexMap<String, RuleSeverity>,
    /// Латинські слова, які перекладач дозволив лишати в українському тексті (малі літери).
    pub keep: HashSet<String>,
    /// Апостроф проєкту: `any` приймає три правильні й лише відмічає хибні знаки.
    pub apostrophe: String,
    /// Усе вищезгадане одним коротким текстом, для пам'яті відповідей QA.
    pub sig: String,
}

pub struct RuleCtx<'a> {
    /// Вид рядка (діалог, назва, термін гри…), коли відомий.
    pub kind: Option<&'a str>,
    pub source: &'a str,
    pub target: &'a str,
    pub ms: String,
    pub mt: String,
    pub rules: &'a QaRules,
    src_words: OnceCell<HashSet<String>>,
}
impl RuleCtx<'_> {
    /// Слова оригіналу (замасковані) як множина: слово, що стоїть в оригіналі, — власне слово гри.
    fn src_words(&self) -> &HashSet<String> {
        self.src_words.get_or_init(|| script_words(&self.ms).into_iter().map(|w| w.text).collect())
    }
}

struct RuleOut {
    message: String,
    detail: Option<String>,
    fixed: Option<String>,
}

pub struct QaRule {
    pub id: &'static str,
    pub title: &'static str,
    pub explain: &'static str,
    pub cat: IssueCat,
    /// Рівень, коли проєкт не обрав.
    pub def: RuleSeverity,
    /// Чи має правило готове виправлення взагалі.
    pub fixable: bool,
    run: fn(&RuleCtx) -> Option<RuleOut>,
}

/* ---------- літери, що схожі ---------- */

fn c2l_strong(c: char) -> Option<char> {
    Some(match c {
        'а' => 'a', 'е' => 'e', 'о' => 'o', 'р' => 'p', 'с' => 'c', 'у' => 'y', 'х' => 'x', 'і' => 'i',
        'А' => 'A', 'В' => 'B', 'Е' => 'E', 'К' => 'K', 'М' => 'M', 'Н' => 'H', 'О' => 'O', 'Р' => 'P', 'С' => 'C', 'Т' => 'T', 'Х' => 'X', 'У' => 'Y', 'І' => 'I',
        _ => return None,
    })
}
fn c2l(c: char) -> Option<char> {
    c2l_strong(c).or(match c {
        'к' => Some('k'), 'м' => Some('m'), 'т' => Some('t'), 'ї' => Some('ï'), 'Ї' => Some('Ï'),
        _ => None,
    })
}
fn l2c_strong(c: char) -> Option<char> {
    "аеорсухіАВЕКМНОРСТХУІ".chars().find(|&k| c2l_strong(k) == Some(c))
}
fn l2c(c: char) -> Option<char> {
    l2c_strong(c).or(match c {
        'k' => Some('к'), 'm' => Some('м'), 't' => Some('т'), 'ï' => Some('ї'), 'Ï' => Some('Ї'),
        _ => None,
    })
}

const BUILTIN_LATIN: &str = "hp mp tp sp exp xp lv lvl atk def mat mdf agi luk str dex int vit wis ap cp ui hud npc pc dlc dps aoe dot pvp pve rpg ok tv gps id usb vip dj ai km m cm mm kg g mg l ml s ms h hz khz mhz ghz kb mb gb tb px pt dpi fps wi fi";
static RE_X_NUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?i:[x×][0-9]+|[0-9]+[x×])$").unwrap());
static RE_ROMAN_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[IVXLCDM]+$").unwrap());
static ROMAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$").unwrap());

fn is_latin_ok(w: &str, c: &RuleCtx) -> bool {
    let low = w.to_lowercase();
    BUILTIN_LATIN.split(' ').any(|b| b == low) || c.rules.keep.contains(&low) || RE_X_NUM.is_match(w) || RE_ROMAN_ONLY.is_match(w) || c.src_words().contains(w)
}

fn convert(w: &str, map: fn(char) -> Option<char>) -> String {
    w.chars().map(|ch| map(ch).unwrap_or(ch)).collect()
}
fn all_mapped(w: &str, test: fn(char) -> bool, map: fn(char) -> Option<char>) -> bool {
    w.chars().all(|ch| !test(ch) || map(ch).is_some())
}

/* ---------- 1. пошкоджені керівні коди ---------- */

struct CodeHit {
    start: usize,
    end: usize,
    shown: String,
    fix: Option<String>,
}

static R_CYR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\([\x{0400}-\x{04FF}]+)(\[[^\]\n]*\])?").unwrap());
static R_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\\s+[A-Za-z]{1,3}\[[0-9]+\]|\\[A-Za-z]{1,3}\s+\[[0-9]+\]|\\[A-Za-z]{1,3}\[(?:\s+[0-9]+\s*|[0-9]+\s+)\]").unwrap());
static R_OPEN1: LazyLock<FRegex> = LazyLock::new(|| FRegex::new(r"\\[A-Za-z]{1,3}\[([0-9]+)(?![0-9\]]|\s+\])").unwrap());
static R_OPEN2: LazyLock<FRegex> = LazyLock::new(|| FRegex::new(r"\\[A-Za-z]{1,3}\[(?![0-9\]])").unwrap());
static R_PARAM: LazyLock<FRegex> = LazyLock::new(|| FRegex::new(r"\\[CVNPI]\[(?![0-9]+\])[^\]\n]*\]").unwrap());
static R_WIDE: LazyLock<Regex> = LazyLock::new(|| Regex::new("[\u{FF3C}\u{FF3B}\u{FF3D}]").unwrap());
static R_LATIN_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z]+$").unwrap());
static R_WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

fn rule_code_malformed(c: &RuleCtx) -> Option<RuleOut> {
    let src: HashSet<String> = code_hits_full(c.source).into_iter().map(|h| h.shown).collect();
    let hits: Vec<CodeHit> = code_hits_full(c.target).into_iter().filter(|h| !src.contains(&h.shown)).collect();
    if hits.is_empty() {
        return None;
    }
    let fixable: Vec<&CodeHit> = hits.iter().filter(|h| h.fix.is_some()).collect();
    let shown: Vec<&str> = hits.iter().take(3).map(|h| h.shown.as_str()).collect();
    Some(RuleOut {
        message: format!("Пошкоджений керівний код: {}{}", shown.join(" "), if hits.len() > 3 { "…" } else { "" }),
        detail: Some("Керівні коди пишуться латиницею, без пробілів, із числом у дужках.".into()),
        fixed: (fixable.len() == hits.len()).then(|| apply_edits(c.target, &fixable.iter().map(|h| Edit { start: h.start, end: h.end, text: h.fix.clone().unwrap() }).collect::<Vec<_>>())),
    })
}

/// Усі знахідки пошкоджених кодів у тому порядку, в якому їх збирає TS: cyr, space, open, (param), wide.
fn code_hits_full(text: &str) -> Vec<CodeHit> {
    let tab = byte_to_char(text);
    let mut hits: Vec<(&'static str, CodeHit)> = Vec::new();
    let mk = |m: (usize, usize), fix: Option<String>| CodeHit { start: tab[m.0], end: tab[m.1], shown: text[m.0..m.1].to_string(), fix };
    for m in R_CYR.captures_iter(text) {
        let g = m.get(0).unwrap();
        let latin: String = m[1].chars().map(|ch| c2l_strong(ch).unwrap_or('?')).collect();
        let fix = R_LATIN_ONLY.is_match(&latin).then(|| format!("\\{latin}{}", m.get(2).map_or("", |x| x.as_str())));
        hits.push(("cyr", mk((g.start(), g.end()), fix)));
    }
    for m in R_SPACE.find_iter(text) {
        hits.push(("space", mk((m.start(), m.end()), Some(R_WS.replace_all(m.as_str(), "").into_owned()))));
    }
    for m in R_OPEN1.find_iter(text).flatten() {
        hits.push(("open", mk((m.start(), m.end()), Some(format!("{}]", m.as_str())))));
    }
    for m in R_OPEN2.find_iter(text).flatten() {
        if !text[m.end()..].split('\n').next().unwrap_or("").contains(']') {
            hits.push(("open", mk((m.start(), m.end()), None)));
        }
    }
    let opened: HashSet<usize> = hits.iter().filter(|(k, _)| *k == "open" || *k == "space").map(|(_, h)| h.start).collect();
    for m in R_PARAM.find_iter(text).flatten() {
        if !opened.contains(&tab[m.start()]) {
            hits.push(("param", mk((m.start(), m.end()), None)));
        }
    }
    for m in R_WIDE.find_iter(text) {
        let fix = match m.as_str() {
            "\u{FF3C}" => "\\",
            "\u{FF3B}" => "[",
            _ => "]",
        };
        hits.push(("wide", mk((m.start(), m.end()), Some(fix.into()))));
    }
    hits.into_iter().map(|(_, h)| h).collect()
}

/* ---------- 2. латинські й кириличні літери, що переплутані ---------- */

fn rule_homoglyph(c: &RuleCtx) -> Option<RuleOut> {
    let words = script_words(&c.mt);
    let mt: Vec<char> = c.mt.chars().collect();
    let mut edits: Vec<Edit> = Vec::new();
    let mut bad: Vec<String> = Vec::new();
    let mut unfixable = 0;
    let mut note = |w: &ScriptWord, fix: Option<String>| {
        bad.push(w.text.clone());
        match fix {
            Some(f) if f != w.text => edits.push(Edit { start: w.start, end: w.end, text: f }),
            _ => unfixable += 1,
        }
    };
    // лише пробіли й звичайна пунктуація можуть стояти між словами
    let near = |i: usize, dir: isize| -> Option<&ScriptWord> {
        let j = i as isize + dir;
        let w = words.get(usize::try_from(j).ok()?)?;
        let gap: String = if dir < 0 { mt[w.end..words[i].start].iter().collect() } else { mt[words[i].end..w.start].iter().collect() };
        if gap.contains(BLANK) || gap.contains('\n') { None } else { Some(w) }
    };
    let single = |t: &str| matches!(t, "a" | "i" | "o" | "y" | "c");
    for (i, w) in words.iter().enumerate() {
        if c.src_words().contains(&w.text) {
            continue;
        }
        match w.script {
            Script::Mixed => {
                let to_lat = convert(&w.text, c2l);
                if all_mapped(&w.text, is_cyrillic_letter, c2l) && is_latin_ok(&to_lat, c) {
                    note(w, Some(to_lat));
                } else {
                    note(w, all_mapped(&w.text, is_latin_letter, l2c).then(|| convert(&w.text, l2c)));
                }
            }
            Script::Cyr => {
                // НР замість HP: великі, що малюються як латинські й дають слово оригіналу (чи дозволене)
                if js::len16(&w.text) >= 2 && w.text == w.text.to_uppercase() && w.text.chars().all(|ch| c2l_strong(ch).is_some()) {
                    let lat = convert(&w.text, c2l_strong);
                    // велике слово З голосним — слово («АТОМ», «ТОМ», «МАМА!» — українські слова, що малюються як ATOM, TOM, MAMA);
                    // НР для HP, КС для KC голосних не мають: це абревіатури, набрані не тією розкладкою
                    if !w.text.chars().any(|ch| "АЕИІОУЄЇЮЯ".contains(ch)) && (c.src_words().contains(&lat) || c.rules.keep.contains(&lat.to_lowercase())) {
                        note(w, Some(lat));
                        continue;
                    }
                    // ХІХ замість XIX, ІІ замість II: римське число з кириличними Х та І (українським словом не буває)
                    if w.text.chars().count() >= 2 && w.text.chars().all(|ch| ch == '\u{0406}' || ch == '\u{0425}') && ROMAN.is_match(&lat) {
                        note(w, Some(lat));
                    }
                }
            }
            Script::Lat if w.cyr == 0 && w.lat == 1 && single(&w.text) => {
                // «Ти i я»: одна латинська літера, що є українським словом, між двома українськими словами.
                // З іншою самотньою латинською літерою в рядку («x i y») рядок — формула чи список змінних, не помилка розкладки.
                let (p, n) = (near(i, -1), near(i, 1));
                let formula = words.iter().enumerate().any(|(j, o)| j != i && o.script == Script::Lat && js::len16(&o.text) == 1 && !single(&o.text));
                if p.is_some_and(|p| p.script == Script::Cyr) && n.is_some_and(|n| n.script == Script::Cyr) && !formula {
                    note(w, Some(convert(&w.text, l2c_strong)));
                }
            }
            _ => {}
        }
    }
    if bad.is_empty() {
        return None;
    }
    let shown: Vec<String> = bad.iter().take(3).map(|b| format!("«{b}»")).collect();
    Some(RuleOut {
        message: format!("Літери не з того алфавіту: {}{}", shown.join(" "), if bad.len() > 3 { "…" } else { "" }),
        detail: Some("Це латинські літери, схожі на українські (або навпаки). Виправлення замінює їх на літери того алфавіту, до якого належить слово.".into()),
        fixed: (unfixable == 0 && !edits.is_empty()).then(|| apply_edits(c.target, &edits)),
    })
}

/* ---------- 3. літери, яких немає в українській ---------- */

fn is_cyr_block(c: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&c)
}
fn in_uk_set(c: char) -> bool {
    matches!(c, 'А'..='Щ' | 'Ь' | 'Ю' | 'Я' | 'Є' | 'І' | 'Ї' | 'Ґ' | 'а'..='щ' | 'ь' | 'ю' | 'я' | 'є' | 'і' | 'ї' | 'ґ')
}
fn rule_foreign_letters(c: &RuleCtx) -> Option<RuleOut> {
    let in_source: HashSet<char> = c.source.chars().filter(|&ch| is_cyr_block(ch)).collect();
    let mut found: Vec<char> = Vec::new();
    for ch in c.target.chars() {
        if is_cyr_block(ch) && !in_uk_set(ch) && !in_source.contains(&ch) && !found.contains(&ch) {
            found.push(ch);
        }
    }
    if found.is_empty() {
        return None;
    }
    let shown: Vec<String> = found.iter().take(4).map(|c| c.to_string()).collect();
    Some(RuleOut { message: format!("Літери, яких немає в українській: {}", shown.join(" ")), detail: Some("ы → и, э → е, ъ → ’, ё → е або йо. Якщо це ім’я чи навмисна репліка, проігноруйте.".into()), fixed: None })
}

/* ---------- 4. літера з двох символів ---------- */

fn rule_normalization(c: &RuleCtx) -> Option<RuleOut> {
    // U+2000 і U+2001 мають канонічного двійника (U+2002, U+2003), на якого NFC їх міняє: це широкий пробіл (його називає правило
    // про невидимі знаки), а не літера з двох частин
    let t0: String = c.target.chars().map(|ch| if ch == '\u{2000}' || ch == '\u{2001}' { '\u{2002}' } else { ch }).collect();
    let n: String = t0.nfc().collect();
    // переклад, що є самим оригіналом (скопьована назва), — не помилка перекладача
    if n == t0 || n == c.source.nfc().collect::<String>() {
        return None;
    }
    Some(RuleOut { message: "Літера записана розкладеною (й, ї)".into(), detail: Some("Виправлення складає такі літери в один символ.".into()), fixed: Some(n) })
}

/* ---------- 5. невидимі символи ---------- */

fn is_hidden(c: char) -> bool {
    matches!(c as u32,
        0x200B..=0x200F | 0x202A..=0x202E | 0x2060 | 0x2066..=0x2069 | 0xFEFF | 0x00AD | 0x0085 | 0x2028 | 0x2029 | 0x2000..=0x200A | 0x3000
        | 0x0000..=0x0008 | 0x000B | 0x000C | 0x000E..=0x001F | 0x007F)
}
static R_PICT_BEFORE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Extended_Pictographic}\x{FE0F}?$").unwrap());
static R_PICT_AFTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{Extended_Pictographic}").unwrap());
/// З'єднувач усередині послідовності емодзі (родина, прапор зі шкірою) — частина картинки, не прихований знак.
fn emoji_joiner(chars: &[char], at: usize) -> bool {
    chars[at] == '\u{200D}' && R_PICT_BEFORE.is_match(&chars[..at].iter().collect::<String>()) && R_PICT_AFTER.is_match(&chars[at + 1..].iter().collect::<String>())
}
fn hex(ch: char) -> String {
    format!("U+{:04X}", ch as u32)
}
fn rule_hidden(c: &RuleCtx) -> Option<RuleOut> {
    let own: HashSet<char> = c.source.chars().filter(|&ch| is_hidden(ch)).collect();
    let chars: Vec<char> = c.target.chars().collect();
    let found: Vec<(char, usize)> = chars.iter().enumerate().filter(|&(i, &ch)| is_hidden(ch) && !own.contains(&ch) && !emoji_joiner(&chars, i)).map(|(i, &ch)| (ch, i)).collect();
    if found.is_empty() {
        return None;
    }
    let edits: Vec<Edit> = found
        .iter()
        .map(|&(ch, at)| Edit {
            start: at,
            end: at + 1,
            text: if matches!(ch as u32, 0x2000..=0x200A | 0x3000) { " ".into() } else if matches!(ch as u32, 0x2028 | 0x2029 | 0x0085) { "\n".into() } else { String::new() },
        })
        .collect();
    let mut uniq: Vec<char> = Vec::new();
    for &(ch, _) in &found {
        if !uniq.contains(&ch) {
            uniq.push(ch);
        }
    }
    Some(RuleOut {
        message: format!("Невидимі символи: {}", uniq.iter().take(3).map(|&c| hex(c)).collect::<Vec<_>>().join(" ")),
        detail: Some("Виправлення прибирає їх (нестандартні пробіли стають звичайними).".into()),
        fixed: Some(apply_edits(c.target, &edits)),
    })
}

/* ---------- 6. пробіли на краях ---------- */

fn is_edge(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\u{00A0}')
}
fn rule_edges(c: &RuleCtx) -> Option<RuleOut> {
    if js::len16(js::trim(c.source)) < 2 || js::trim(c.target).is_empty() {
        return None;
    }
    let lead_of = |s: &str| -> String { s.chars().take_while(|&ch| is_edge(ch)).collect() };
    let tail_of = |s: &str| -> String {
        let v: Vec<char> = s.chars().rev().take_while(|&ch| is_edge(ch)).collect();
        v.into_iter().rev().collect()
    };
    let (sl, st, tl, tt) = (lead_of(c.source), tail_of(c.source), lead_of(c.target), tail_of(c.target));
    // рядок повідомлення: хибне лише те, що додав перекладач; власні поля оригіналу не вимагаються
    let message = matches!(c.kind, Some("dialogue") | Some("scroll"));
    let lead = if message { tl.chars().count() > sl.chars().count() } else { sl != tl };
    let tail = if message { tt.chars().count() > st.chars().count() } else { st != tt };
    if !lead && !tail {
        return None;
    }
    let tc: Vec<char> = c.target.chars().collect();
    let core: String = tc[tl.chars().count()..tc.len() - tt.chars().count()].iter().collect();
    let fixed_lead = if lead { &sl } else { &tl };
    let fixed_tail = if tail { &st } else { &tt };
    Some(RuleOut {
        message: format!("Пробіли {} {}", if lead { "на початку" } else { "в кінці" }, if message { "зайві" } else { "не такі, як в оригіналі" }),
        detail: Some("Виправлення копіює пробіли й переходи на новий рядок з країв оригіналу.".into()),
        fixed: Some(format!("{fixed_lead}{core}{fixed_tail}")),
    })
}

/* ---------- 7. два пробіли поспіль ---------- */

/// Серії з двох і більше пробілів між двома непробільними символами: (початок, кінець) у символах.
fn double_spaces(chars: &[char]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ' ' {
            let start = i;
            while i < chars.len() && chars[i] == ' ' {
                i += 1;
            }
            if i - start >= 2 && start > 0 && !js::is_space(chars[start - 1]) && i < chars.len() && !js::is_space(chars[i]) {
                out.push((start, i));
            }
        } else {
            i += 1;
        }
    }
    out
}
fn rule_double(c: &RuleCtx) -> Option<RuleOut> {
    let (s, t): (Vec<char>, Vec<char>) = (c.source.chars().collect(), c.target.chars().collect());
    if !double_spaces(&s).is_empty() || double_spaces(&t).is_empty() {
        return None;
    }
    let edits: Vec<Edit> = double_spaces(&t).into_iter().map(|(a, b)| Edit { start: a, end: b, text: " ".into() }).collect();
    Some(RuleOut { message: "Подвійний пробіл між словами".into(), detail: Some("Виправлення лишає один пробіл.".into()), fixed: Some(apply_edits(c.target, &edits)) })
}

/* ---------- 8. апостроф ---------- */

fn is_cyr_let(c: char) -> bool {
    matches!(c, 'А'..='Я' | 'а'..='я' | 'Ё' | 'ё' | 'Ґ' | 'ґ' | 'Є' | 'є' | 'І' | 'і' | 'Ї' | 'ї')
}
fn is_wrong_apos(c: char) -> bool {
    matches!(c, '`' | '\u{00B4}' | '‘' | '′' | 'ʹ' | 'ˈ' | '՚' | '\u{02BB}' | '\u{201B}' | '\u{FF07}' | '"' | '”')
}
fn is_good_apos(c: char) -> bool {
    matches!(c, '\'' | 'ʼ' | '’')
}
/// Місця між двома українськими літерами, де стоїть знак з `is`.
fn between_letters(chars: &[char], is: fn(char) -> bool) -> Vec<usize> {
    (1..chars.len().saturating_sub(1)).filter(|&i| is(chars[i]) && is_cyr_let(chars[i - 1]) && is_cyr_let(chars[i + 1])).collect()
}
fn is_quote(c: char) -> bool {
    c == '"' || c == '”'
}
/// Закривальна лапка між двома літерами («„Так”і») — лапка, не апостроф: рахується, лише коли перед нею не було відкривальної.
fn closes_quote(chars: &[char], at: usize) -> bool {
    if chars[at] == '"' {
        chars[..at].iter().filter(|&&c| c == '"').count() % 2 == 1
    } else {
        chars[..at].iter().any(|c| matches!(c, '„' | '«' | '“' | '‹'))
    }
}
fn rule_apostrophe(c: &RuleCtx) -> Option<RuleOut> {
    let any = c.rules.apostrophe == "any";
    let want: char = if any { '’' } else { c.rules.apostrophe.chars().next().unwrap_or('’') };
    let chars: Vec<char> = c.target.chars().collect();
    let wrong_at: Vec<usize> = between_letters(&chars, is_wrong_apos).into_iter().filter(|&i| !(is_quote(chars[i]) && closes_quote(&chars, i))).collect();
    let wrong: Vec<char> = wrong_at.iter().map(|&i| chars[i]).collect();
    let differs: Vec<char> = if any { vec![] } else { between_letters(&chars, is_good_apos).into_iter().map(|i| chars[i]).filter(|&ch| ch != want).collect() };
    if wrong.is_empty() && differs.is_empty() {
        return None;
    }
    // WRONG_APOS: усі місця між літерами; закривальна лапка лишається
    let mut out = chars.clone();
    for i in between_letters(&chars, is_wrong_apos) {
        out[i] = if is_quote(chars[i]) && closes_quote(&chars, i) { chars[i] } else { want };
    }
    // GOOD_APOS у результаті першої заміни
    if !any {
        for i in between_letters(&out.clone(), is_good_apos) {
            out[i] = want;
        }
    }
    let uniq = |v: &[char]| -> String {
        let mut u: Vec<char> = Vec::new();
        for &c in v {
            if !u.contains(&c) {
                u.push(c);
            }
        }
        u.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")
    };
    Some(RuleOut {
        message: if !wrong.is_empty() { format!("Неправильний апостроф: {}", uniq(&wrong)) } else { format!("Апостроф не такий, як у проєкті: {}", uniq(&differs)) },
        detail: Some(format!("Виправлення ставить {want}.")),
        fixed: Some(out.into_iter().collect()),
    })
}

/// Правила застосунку в порядку, в якому робляться примітки.
pub static QA_RULES: [QaRule; 8] = [
    QaRule { id: "code-malformed", cat: IssueCat::Error, def: RuleSeverity::Bad, fixable: true, title: "Пошкоджений керівний код", explain: "Керівний код гри (\\C[2], \\N[1]) написано з помилкою: кирилична літера замість латинської, зайвий пробіл, немає дужки чи не число. Гра покаже його текстом або зламає рядок.", run: rule_code_malformed },
    QaRule { id: "uk-homoglyph", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Латинські літери в українському слові", explain: "Латинська літера, схожа на кириличну (a, c, e, i, o, p, x), потрапила всередину українського слова, або навпаки. Текст виглядає правильно, але пошук, переноси й перевірка слів її не впізнають.", run: rule_homoglyph },
    QaRule { id: "uk-foreign-letters", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: false, title: "Літери, яких немає в українській", explain: "Літери ы, э, ъ, ё (та інша кирилиця поза українським алфавітом) потрапили в текст, найчастіше з російської. Українською: ы → и, э → е, ъ → ’, ё → е або йо.", run: rule_foreign_letters },
    QaRule { id: "uk-normalization", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Літера з двох символів", explain: "Літери й та ї записано розкладеними (и + знак, і + дві крапки). На екрані вони схожі на звичайні, але пошук і порівняння їх не впізнають.", run: rule_normalization },
    QaRule { id: "ws-hidden", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Невидимі символи", explain: "У тексті є символи, яких не видно: нульової ширини, м’який перенос, нестандартні пробіли. Вони ламають перенесення рядків і пошук, а в деяких шрифтах показуються квадратиками.", run: rule_hidden },
    QaRule { id: "ws-edges", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Пробіли на краях", explain: "На початку чи в кінці перекладу пробілів або переходів на новий рядок не стільки, скільки в оригіналі. У назвах, термінах і текстах плагінів гра склеює рядок з іншим текстом, тому зайвий або загублений пробіл видно на екрані. У репліках діалогів лише зайві пробіли й переходи на новий рядок: оригінал часто має хвостові пробіли, які нічого не значать.", run: rule_edges },
    QaRule { id: "ws-double", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Подвійні пробіли", explain: "Між словами два й більше пробілів, а в оригіналі їх нема. Найчастіше це випадковий зайвий пробіл.", run: rule_double },
    QaRule { id: "uk-apostrophe", cat: IssueCat::Style, def: RuleSeverity::Warn, fixable: true, title: "Апостроф", explain: "Між двома українськими літерами стоїть не апостроф (наприклад, ` \u{00B4} ‘ або лапка). Правильний апостроф: ’ (U+2019), ʼ (U+02BC) або ' з клавіатури; один знак на весь проєкт обирається в налаштуваннях правил.", run: rule_apostrophe },
];

pub fn rule_by_id(id: &str) -> Option<&'static QaRule> {
    QA_RULES.iter().find(|r| r.id == id)
}

/// Число, що змінюється, коли змінюється набір правил (без плагінів — завжди 0).
pub fn qa_rules_revision() -> u32 {
    0
}

/// Примітки ввімкнених правил для перекладу, по одній на правило.
pub fn run_rules(source: &str, target: &str, rules: &QaRules, kind: Option<&str>) -> Vec<Issue> {
    let ctx = RuleCtx { kind, source, target, ms: mask_codes(source), mt: mask_codes(target), rules, src_words: OnceCell::new() };
    let mut out = Vec::new();
    for r in QA_RULES.iter() {
        let sev = rules.sev.get(r.id).copied().unwrap_or(r.def);
        if sev == RuleSeverity::Off {
            continue;
        }
        let Some(hit) = (r.run)(&ctx) else { continue };
        out.push(Issue {
            key: r.id.to_string(),
            severity: if sev == RuleSeverity::Bad { Severity::Bad } else { Severity::Warn },
            cat: if sev == RuleSeverity::Bad { IssueCat::Error } else { r.cat },
            message: hit.message,
            detail: Some(hit.detail.unwrap_or_else(|| r.explain.to_string())),
            fix: hit.fixed.filter(|f| f != target).map(|text| IssueFix { label: "Виправити".into(), text }),
            codes: None,
        });
    }
    out
}
