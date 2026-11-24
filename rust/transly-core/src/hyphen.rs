//! `hyphen.ts`: український перенос слів по складах за правилами, без таблиць. `hyphen_points` дає кожне місце, де слово
//! можна розірвати дефісом наприкінці рядка. Позиції — індекси символів (усі літери кириличні, тож збігаються з UTF-16).

use std::collections::BTreeSet;

const VOWELS: &str = "аеєиіїоуюя";
const SONORANT: &str = "вмнлр";
const VOICED: &str = "бгґджз";
const VOICELESS: &str = "кптфхцчшщс";
/// Префікси, що розриваються на своєму краї перед приголосним: роз-мова, під-земний (але ро-зум).
const PREFIXES: [&str; 11] = ["роз", "без", "від", "під", "над", "пред", "між", "через", "перед", "понад", "попід"];

fn is_apos_char(c: char) -> bool {
    matches!(c, '\'' | '’' | 'ʼ' | '`')
}

/// Слово лише з українських літер (і апострофів) з принаймні одним голосним — єдине, що переноситься по складах.
pub fn is_hyphenatable(word: &str) -> bool {
    !word.is_empty()
        && word.chars().all(|c| ('\u{0400}'..='\u{04FF}').contains(&c) || is_apos_char(c))
        && !word.chars().any(|c| "ыэъёЫЭЪЁ".contains(c))
        && word.to_lowercase().chars().any(|c| VOWELS.contains(c))
}

fn voicing(c: char) -> char {
    if VOICED.contains(c) { 'v' } else if VOICELESS.contains(c) { 'u' } else { 's' }
}

/// Позиції (між символами `word`), де можна поставити дефіс, від найменшої. `min_left` і `min_right` — найменше літер до й після розриву.
pub fn hyphen_points(word: &str, min_left: usize, min_right: usize) -> Vec<usize> {
    if !is_hyphenatable(word) {
        return Vec::new();
    }
    let w: Vec<char> = word.to_lowercase().chars().collect();
    let n = w.len();
    // '\0' — «немає символа» (поза межами), як порожній рядок у JS
    let at = |i: isize| -> char { if i >= 0 && (i as usize) < n { w[i as usize] } else { '\0' } };
    let is_v = |i: isize| i >= 0 && (i as usize) < n && VOWELS.contains(at(i));
    let is_apos = |i: isize| i >= 0 && (i as usize) < n && is_apos_char(at(i));
    let vowels: Vec<isize> = (0..n as isize).filter(|&i| is_v(i)).collect();
    let starts = |p: &str| {
        let pc: Vec<char> = p.chars().collect();
        w.len() >= pc.len() && w[..pc.len()] == pc[..]
    };
    let prefix = PREFIXES.iter().find(|p| {
        let pl = p.chars().count() as isize;
        starts(p) && n as isize > pl + 2 && !is_v(pl) && at(pl) != 'ь' && !is_apos(pl)
    });
    let prefix_len = prefix.map(|p| p.chars().count() as isize);
    let mut out: BTreeSet<isize> = BTreeSet::new();
    for k in 0..vowels.len().saturating_sub(1) {
        let (a, b) = (vowels[k], vowels[k + 1]);
        // префікс розривається на своєму краї
        if let Some(pl) = prefix_len {
            if a < pl && b >= pl {
                out.insert(pl);
                continue;
            }
        }
        let mut s = a + 1;
        // «й» лишається з голосним перед ним, крім «о» (ма-йор)
        if at(s) == 'й' && !(s + 1 == b && at(b) == 'о') {
            s += 1;
        }
        // приголосні між двома голосними як одиниці: літера з «ь» чи апострофом після неї, «дж» і «дз» як одна
        let mut units: Vec<(isize, isize)> = Vec::new();
        let mut j = s;
        while j < b {
            let start = j;
            j += if at(j) == 'д' && (at(j + 1) == 'ж' || at(j + 1) == 'з') && j + 1 < b { 2 } else { 1 };
            while j < b && (at(j) == 'ь' || is_apos(j)) {
                j += 1;
            }
            units.push((start, j));
        }
        let last = |u: (isize, isize)| at(u.1 - 1);
        let first = |u: (isize, isize)| at(u.0);
        if units.is_empty() {
            // два голосні поспіль розриваються між ними (кра-ї-на), крім «іо»/«ео» після приголосного (біо-, ра-діо)
            if !(s == a + 1 && "іе".contains(at(a)) && at(b) == 'о' && a > 0 && !is_v(a - 1)) {
                out.insert(s);
            }
            continue;
        }
        if units.len() == 1 {
            out.insert(if is_apos(units[0].1 - 1) { units[0].1 } else { units[0].0 });
            continue;
        }
        let (c1, c2) = (units[0], units[1]);
        if is_apos(c1.1 - 1) {
            out.insert(c1.1);
        } else if first(c1) == first(c2) && c1.1 - c1.0 == 1 {
            out.insert(c1.0);
            out.insert(c1.1);
        } else if (last(c1) == 'ь' && "сзц".contains(first(c1)) && first(c2) == 'к') || (first(c1) == 'т' && last(c1) == 'ь' && first(c2) == 'с' && c2.1 == n as isize - 1 && w.ends_with(&['с', 'я'])) {
            out.insert(c1.0);
        } else if last(c1) == 'ь' || SONORANT.contains(first(c1)) {
            out.insert(c1.1);
        } else {
            let (d1, d2) = (voicing(first(c1)), voicing(first(c2)));
            out.insert(if d1 != 's' && d2 != 's' && d1 != d2 { c1.1 } else { c1.0 });
        }
    }
    // розрив не може лишити апостроф чи «ь» на початку наступного рядка
    out.into_iter().filter(|&j| j >= min_left as isize && n as isize - j >= min_right as isize && !is_apos(j) && at(j) != 'ь').map(|j| j as usize).collect()
}

/// Склади слова так, як вони написані в тексті (точки розриву `hyphen_points` ріжуть слово на них).
pub fn syllables(word: &str, min_left: usize, min_right: usize) -> Vec<String> {
    let ch: Vec<char> = word.chars().collect();
    let mut out = Vec::new();
    let mut from = 0;
    for p in hyphen_points(word, min_left, min_right) {
        out.push(ch[from..p].iter().collect());
        from = p;
    }
    out.push(ch[from..].iter().collect());
    out
}
