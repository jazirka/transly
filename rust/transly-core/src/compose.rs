//! `compose.ts`: складання рядка з частин. «Villager [left arm]» не має перекладу, але «Villager» — термін (чи перекладений
//! короткий рядок), а «left» і «arm» перекладено деінде. Дужки, цифри й коди копіюються з оригіналу, кожен ряд слів між ними
//! покривається найдовшими відомими частинами (до чотирьох слів), а прикметники ставляться в рід і число іменника, перед яким
//! стоять («лівий» + «рука» → «ліва рука»).

use crate::autofill::tokenize;
use crate::js;
use crate::project::SavedProject;
use crate::ukmorph::{uk_forms, uk_word_forms, MorphDict, MorphInfo};
use crate::ukmorph::Gender;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::LazyLock;

/// Оригінальна фраза (малі літери, один пробіл між словами) → переклад (малими літерами).
#[derive(Clone, Debug, PartialEq)]
pub struct LexEntry {
    pub uk: String,
    pub adj: bool,
}
pub type Lexicon = IndexMap<String, LexEntry>;

const MAX_PART: usize = 4;
fn lower(s: &str) -> String {
    s.to_lowercase()
}

/// Англійські прикметники, якими повні рядки гри: вони кажуть, що переклад «ліва» — прикметник «лівий».
static ADJ_EN: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    ("left right upper lower top bottom front back inner outer big small little large tiny huge great long short tall high low wide narrow thick thin \
      old new young ancient fresh first second third last next main secondary basic special rare common unique magic magical holy dark light bright red green blue yellow white black \
      brown gray grey golden silver iron steel wooden stone broken heavy hot cold warm cool dry wet empty full strong weak sharp dull hard soft fast slow good bad best worst \
      happy sad angry wild poor rich dead alive free secret hidden lost final deep shallow sweet sour bitter royal dirty clean")
        .split_whitespace()
        .collect()
});

fn ends_adj(s: &str) -> bool {
    s.ends_with("ий") || s.ends_with("ій")
}

/// Чоловічий лемат прикметника, баченого в іншому роді («ліва» → «лівий»); None, коли слово не таке.
pub fn adj_lemma(uk: &str) -> Option<String> {
    if ends_adj(uk) {
        return Some(uk.to_string());
    }
    for (suf, to) in [("а", "ий"), ("я", "ій"), ("е", "ий"), ("є", "ій"), ("і", "ий")] {
        if !uk.ends_with(suf) || js::len16(uk) < 4 {
            continue;
        }
        let cand = format!("{}{to}", &uk[..uk.len() - suf.len()]);
        // прикметник бере рід від іменника після себе: форми питаються з іменником кожного роду
        if ["стіл", "стіна", "вікно"].iter().any(|n| uk_word_forms(&format!("{cand} {n}"), None).and_then(|f| f.first().map(|s| s.contains(uk))).unwrap_or(false)) {
            return Some(cand);
        }
    }
    None
}

fn only_words(text: &str) -> Option<Vec<String>> {
    let t = tokenize(text);
    if !t.is_empty() && t.len() <= MAX_PART && t.iter().all(|x| x.word) { Some(t.iter().map(|x| lower(&x.text)).collect()) } else { None }
}

fn term_str<'a>(t: &'a Value, k: &str) -> &'a str {
    t.get(k).and_then(|v| v.as_str()).unwrap_or("")
}

/// З чого складається: терміни глосарія й перекладені короткі рядки (цілі фрази) та слова, вивчені з рядків однакової форми.
pub fn build_lexicon(whole_lines: &IndexMap<String, String>, dict: &IndexMap<String, String>, saved: &SavedProject) -> Lexicon {
    let mut lex = Lexicon::new();
    let mut put = |en: &str, uk: &str| {
        let (Some(e), Some(u)) = (only_words(en), only_words(uk)) else { return };
        let one = u.len() == 1 && e.len() == 1;
        let uk_word = u.join(" ");
        let lemma = if one && (ADJ_EN.contains(e[0].as_str()) || ends_adj(&uk_word)) { adj_lemma(&uk_word) } else { None };
        let adj = lemma.is_some();
        lex.insert(e.join(" "), LexEntry { uk: lemma.unwrap_or(uk_word), adj });
    };
    for (w, uk) in dict {
        put(w, uk);
    }
    for (s, t) in whole_lines {
        put(s, t);
    }
    for t in &saved.terms {
        let uk = js::trim(term_str(t, "uk"));
        if !uk.is_empty() {
            put(js::trim(term_str(t, "en")), uk);
        }
    }
    lex
}

/// Рід термінів відомий: морфології не доводиться вгадувати.
struct TermGenders(std::collections::HashMap<String, Gender>);
impl MorphDict for TermGenders {
    fn info(&self, lemma: &str) -> Option<MorphInfo> {
        self.0.get(&lower(lemma)).map(|g| MorphInfo { gender: Some(*g), animate: None })
    }
}
fn morph_of(saved: &SavedProject) -> TermGenders {
    let mut g = std::collections::HashMap::new();
    for t in &saved.terms {
        let uk = js::trim(term_str(t, "uk"));
        let gender = match t.get("gender").and_then(|x| x.as_str()) {
            Some("m") => Some(Gender::M),
            Some("f") => Some(Gender::F),
            Some("n") => Some(Gender::N),
            _ => None,
        };
        if let Some(gd) = gender.filter(|_| !uk.is_empty() && !uk.chars().any(js::is_space)) {
            g.insert(lower(uk), gd);
        }
    }
    TermGenders(g)
}

pub fn is_letter(c: char) -> bool {
    c.to_lowercase().collect::<String>() != c.to_uppercase().collect::<String>()
}
fn is_cap(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.to_lowercase().collect::<String>() != c.to_string())
}
pub fn capitalise(s: &str) -> String {
    let mut it = s.chars();
    match it.next() {
        Some(c) => c.to_uppercase().collect::<String>() + it.as_str(),
        None => String::new(),
    }
}

/// Один ряд слів: покритий найдовшими частинами, прикметники погоджені з іменником; None, коли якесь слово невідоме.
fn compose_group(words: &[String], lex: &Lexicon, dict: &dyn MorphDict) -> Option<String> {
    let mut pieces: Vec<LexEntry> = Vec::new();
    let mut plural = false;
    let mut i = 0;
    while i < words.len() {
        let mut hit: Option<LexEntry> = None;
        let mut took = 0;
        let mut n = MAX_PART.min(words.len() - i);
        while n >= 1 && hit.is_none() {
            if let Some(e) = lex.get(&words[i..i + n].join(" ")) {
                hit = Some(e.clone());
                took = n;
            }
            n -= 1;
        }
        if hit.is_none() {
            // «arms» від «arm»: множина останнього слова
            let w = &words[i];
            let base = if i == words.len() - 1 {
                let a = w.strip_suffix("es").unwrap_or_else(|| w.strip_suffix('s').unwrap_or(w));
                lex.get(a).or_else(|| lex.get(w.strip_suffix('s').unwrap_or(w)))
            } else {
                None
            };
            let ends_s = w.ends_with("es") || w.ends_with('s');
            match base {
                Some(b) if ends_s && !b.adj => {
                    hit = Some(b.clone());
                    took = 1;
                    plural = true;
                }
                _ => return None,
            }
        }
        pieces.push(hit.unwrap());
        i += took;
    }
    let phrase = pieces.iter().map(|p| p.uk.as_str()).collect::<Vec<_>>().join(" ");
    if !pieces.iter().any(|p| p.adj) && !plural {
        return Some(phrase);
    }
    let forms = uk_forms(&phrase, Some(dict))?;
    forms[if plural { 1 } else { 0 }].first().cloned()
}

/// Переклад рядка, складений з частин; None, коли якесь слово невідоме чи нічого не змінилося.
pub fn compose_line(source: &str, lex: &Lexicon, saved: &SavedProject, max_words: usize) -> Option<String> {
    let toks = tokenize(source);
    let n_words = toks.iter().filter(|t| t.word).count();
    if n_words == 0 || n_words > max_words {
        return None;
    }
    let dict = morph_of(saved);
    let mut out = String::new();
    let mut at = 0usize; // байтовий зсув
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        out.push_str(&source[at..t.bi]);
        if !t.word {
            out.push_str(&t.text);
            at = t.bi + t.text.len();
            i += 1;
            continue;
        }
        // ряд слів, між якими лише пробіли
        let mut j = i;
        while j + 1 < toks.len() && toks[j + 1].word && source[toks[j].bi + toks[j].text.len()..toks[j + 1].bi].chars().all(js::is_space) {
            j += 1;
        }
        let run = &toks[i..=j];
        let words: Vec<String> = run.iter().map(|x| lower(&x.text)).collect();
        let uk = compose_group(&words, lex, &dict)?;
        let first = &run[0].text;
        let last = &run[run.len() - 1];
        let letters: Vec<char> = source[run[0].bi..last.bi + last.text.len()].chars().filter(|&c| is_letter(c)).collect();
        let upper = |c: &char| c.to_uppercase().collect::<String>() == c.to_string();
        out.push_str(&if letters.len() > 1 && letters.iter().all(upper) {
            uk.to_uppercase()
        } else if is_cap(first) {
            capitalise(&uk)
        } else {
            uk
        });
        at = last.bi + last.text.len();
        i = j + 1;
    }
    if out == source { None } else { Some(out) }
}
