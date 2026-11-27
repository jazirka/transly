//! Автословник: пари «слово оригіналу → слово перекладу», які застосунок виводить сам з надісланих і вичитаних рядків (збіги «слово ↔ слово» по всіх рядках,
//! а не лише в рядках однакової будови, як `autofill::learn_words`). Для кожного слова оригіналу береться український корінь, що найчастіше стоїть у тих самих
//! рядках (коефіцієнт Дайса), якщо таких рядків щонайменше три. Кандидати лише пропонуються: у глосарій нічого не потрапляє, поки перекладач не додав запис.
//! З цього ж словника малюються пунктирні нитки в рядку й підказка узгодженості («зазвичай „меч“, а тут „клинок“»). Нічого не зберігається, усе рахується з текстів.

use crate::glossary::{prepare_text, uk_stems_agree, word_tokens};
use crate::js;
use crate::mine::{content, translated, MineRef};
use crate::project::{FileView, SavedProject};
use std::collections::HashMap;

/// Пара пропонується від такої кількості рядків, де слово й корінь стоять разом.
pub const MIN_ROWS: usize = 3;
/// Мінімальна подібність (Дайс) слова й кореня: чим ближче до 1, тим рідше слово стоїть без цього кореня й корінь без цього слова.
const DICE_MIN: f64 = 0.5;
/// Частка рядків слова, де корінь є: нижче — слово перекладають по-різному, пара не пропонується.
const SHARE_MIN: f64 = 0.6;
/// Корінь, що є в такій частці всіх рядків (при достатньому корпусі), нічого не каже про одне слово.
const COMMON_SHARE: f64 = 0.2;
const MIN_FOR_COMMON: usize = 50;
/// Скільки слів оригіналу й коренів перекладу береться з одного рядка (довгий текст дав би забагато пар).
const MAX_PER_ROW: usize = 14;
/// «Певна» пара: стільки рядків згодні.
pub const SURE_SHARE: f64 = 0.9;
const MAX_PAIRS: usize = 400;
const MAX_REFS: usize = 60;

/// Вивчена пара. `share` — частка рядків із цим словом оригіналу, де є корінь перекладу.
#[derive(Clone, Debug, PartialEq)]
pub struct AutoPair {
    /// Слово оригіналу: найчастіша форма (малими літерами).
    pub en: String,
    /// Ключ слова оригіналу (так воно знаходиться в тексті).
    pub key: String,
    /// Слово перекладу: найчастіша форма; відправна точка для запису.
    pub uk: String,
    /// Корінь слова перекладу (за ним воно знаходиться в перекладі).
    pub stem: String,
    /// Рядків, де слово й корінь стоять разом, і всіх рядків зі словом.
    pub rows: usize,
    pub of: usize,
    pub share: f64,
    pub dice: f64,
    /// Конкуруючі переклади слова: (слово перекладу, рядків).
    pub alts: Vec<(String, usize)>,
    pub refs: Vec<MineRef>,
}

impl AutoPair {
    /// Пара впевнена настільки, що розбіжність з нею варта підказки (а «Додати всі певні» бере саме такі).
    pub fn sure(&self) -> bool {
        self.share >= SURE_SHARE && self.rows >= MIN_ROWS && self.alts.is_empty()
    }
}

#[derive(Clone, Debug, Default)]
pub struct AutoDict {
    pub pairs: Vec<AutoPair>,
    by_key: HashMap<String, usize>,
}

/// Нитка вивченої пари в одному рядку: місце слова в оригіналі, місце його відповідника в перекладі (`None` — переклад передає слово інакше).
#[derive(Clone, Debug, PartialEq)]
pub struct LearnedThread {
    pub pair: usize,
    pub src: (usize, usize),
    pub dst: Option<(usize, usize)>,
}

fn intern(k: &str, ids: &mut HashMap<String, u32>, names: &mut Vec<String>) -> u32 {
    if let Some(i) = ids.get(k) {
        return *i;
    }
    let i = names.len() as u32;
    ids.insert(k.to_string(), i);
    names.push(k.to_string());
    i
}

/// Обрана пара під час складання: (слово оригіналу, корінь перекладу, рядків разом, Дайс, конкуренти (корінь, рядків)).
type Chosen = (u32, u32, u32, f64, Vec<(u32, u32)>);

fn is_word(key: &str) -> bool {
    key.chars().all(|c| c.is_alphabetic())
}

impl AutoDict {
    pub fn pair_for(&self, key: &str) -> Option<&AutoPair> {
        self.by_key.get(key).map(|i| &self.pairs[*i])
    }

    /// Нитки вивчених пар у рядку: для кожного слова оригіналу, що є в словнику, — де переклад його передає. Слова, пара яких не певна, теж повертаються
    /// (картка пояснить, чому нитка слабка), а відповідність корінь↔слово перевіряється з урахуванням відмін.
    pub fn threads(&self, source: &str, target: &str) -> Vec<LearnedThread> {
        if self.pairs.is_empty() {
            return Vec::new();
        }
        let ps = prepare_text(source);
        let tt = word_tokens(target);
        let mut out = Vec::new();
        for tok in &ps.tokens {
            let Some(i) = self.by_key.get(&tok.keys[0]) else { continue };
            let pair = &self.pairs[*i];
            let dst = tt.iter().find(|t| t.keys.iter().any(|k| uk_stems_agree(k, &pair.stem))).map(|t| (t.start, t.end));
            out.push(LearnedThread { pair: *i, src: (tok.start, tok.end), dst });
        }
        out
    }
}

/// Складає словник з надісланих і вичитаних рядків (не більше `limit` рядків). `known` — слова оригіналу, що вже є записами глосарія: вони не пропонуються.
pub fn learn_dictionary(views: &[FileView], saved: &SavedProject, known: &[String], limit: usize) -> AutoDict {
    // ключі слів оригіналу й коренів перекладу окремо (одне й те саме слово в двох мовах — різні слова)
    let (mut sids, mut snames): (HashMap<String, u32>, Vec<String>) = (HashMap::new(), Vec::new());
    let (mut tids, mut tnames): (HashMap<String, u32>, Vec<String>) = (HashMap::new(), Vec::new());
    let mut rows_s: Vec<Vec<u32>> = Vec::new();
    let mut rows_t: Vec<Vec<u32>> = Vec::new();
    let mut row_at: Vec<(usize, usize)> = Vec::new();
    'files: for (fi, v) in views.iter().enumerate() {
        let ents = saved.files.get(&v.name);
        for (ui, u) in v.units.iter().enumerate() {
            let Some(e) = translated(ents.and_then(|m| m.get(&u.key))) else { continue };
            if rows_s.len() >= limit {
                break 'files;
            }
            let p = prepare_text(&u.source);
            let mut s: Vec<u32> = Vec::new();
            for t in &p.tokens {
                let word = p.text[t.bs..t.be].to_lowercase();
                if !content(&t.keys, &word) || !is_word(&t.keys[0]) {
                    continue;
                }
                let id = intern(&t.keys[0], &mut sids, &mut snames);
                if !s.contains(&id) {
                    s.push(id);
                }
                if s.len() >= MAX_PER_ROW {
                    break;
                }
            }
            let mut tg: Vec<u32> = Vec::new();
            for t in word_tokens(&e.target) {
                let k = &t.keys[0];
                if js::len16(k) < 3 || !is_word(k) {
                    continue;
                }
                let id = intern(k, &mut tids, &mut tnames);
                if !tg.contains(&id) {
                    tg.push(id);
                }
                if tg.len() >= MAX_PER_ROW {
                    break;
                }
            }
            rows_s.push(s);
            rows_t.push(tg);
            row_at.push((fi, ui));
        }
    }
    let total = rows_s.len();
    if total < MIN_ROWS {
        return AutoDict::default();
    }
    let mut df_s = vec![0u32; snames.len()];
    let mut df_t = vec![0u32; tnames.len()];
    for (s, t) in rows_s.iter().zip(&rows_t) {
        s.iter().for_each(|i| df_s[*i as usize] += 1);
        t.iter().for_each(|i| df_t[*i as usize] += 1);
    }
    let known_keys: std::collections::HashSet<String> = known.iter().flat_map(|k| word_tokens(k).into_iter().map(|t| t.keys[0].clone())).collect();
    // збіги: лише для слів і коренів, що трапляються щонайменше в MIN_ROWS рядках
    let mut co: HashMap<(u32, u32), u32> = HashMap::new();
    for (s, t) in rows_s.iter().zip(&rows_t) {
        for a in s.iter().filter(|a| df_s[**a as usize] as usize >= MIN_ROWS) {
            for b in t.iter().filter(|b| df_t[**b as usize] as usize >= MIN_ROWS) {
                *co.entry((*a, *b)).or_insert(0) += 1;
            }
        }
    }
    let mut best: HashMap<u32, Vec<(u32, u32, f64)>> = HashMap::new();
    for ((a, b), c) in &co {
        if (*c as usize) < MIN_ROWS {
            continue;
        }
        let dice = 2.0 * *c as f64 / (df_s[*a as usize] + df_t[*b as usize]) as f64;
        best.entry(*a).or_default().push((*b, *c, dice));
    }
    let mut chosen: Vec<Chosen> = Vec::new();
    for (a, mut list) in best {
        if known_keys.contains(&snames[a as usize]) {
            continue;
        }
        list.sort_by(|x, y| y.2.partial_cmp(&x.2).unwrap_or(std::cmp::Ordering::Equal).then_with(|| y.1.cmp(&x.1)));
        let (b, c, dice) = list[0];
        let share = c as f64 / df_s[a as usize] as f64;
        if total >= MIN_FOR_COMMON && df_t[b as usize] as f64 / total as f64 >= COMMON_SHARE {
            continue;
        }
        // конкуруючі переклади: інший корінь, що теж стоїть щонайменше в MIN_ROWS рядків слова й у третині його рядків
        let alts: Vec<(u32, u32)> = list
            .iter()
            .skip(1)
            .filter(|(b2, c2, _)| *c2 as usize >= MIN_ROWS && *c2 as f64 / df_s[a as usize] as f64 >= 0.3 && !uk_stems_agree(&tnames[*b2 as usize], &tnames[b as usize]))
            .map(|(b2, c2, _)| (*b2, *c2))
            .take(2)
            .collect();
        // пара або певна, або слово має два чіткі переклади (разом вони покривають майже всі рядки слова): тоді пропонується з варіантами
        let steady = dice >= DICE_MIN && share >= SHARE_MIN;
        let split = !alts.is_empty() && dice >= 0.4 && (c + alts[0].1) as f64 / df_s[a as usize] as f64 >= 0.8;
        if !steady && !split {
            continue;
        }
        chosen.push((a, b, c, dice, alts));
    }
    chosen.sort_by(|x, y| {
        let sx = x.3 * (1.0 + (x.2 as f64).ln());
        let sy = y.3 * (1.0 + (y.2 as f64).ln());
        sy.partial_cmp(&sx).unwrap_or(std::cmp::Ordering::Equal).then_with(|| snames[x.0 as usize].cmp(&snames[y.0 as usize]))
    });
    chosen.truncate(MAX_PAIRS);
    // рядки пар і форми слів: другий прохід по рядках, що містять вибрані слова
    let want: HashMap<u32, usize> = chosen.iter().enumerate().map(|(i, c)| (c.0, i)).collect();
    let mut refs: Vec<Vec<usize>> = vec![Vec::new(); chosen.len()];
    for (ri, (s, t)) in rows_s.iter().zip(&rows_t).enumerate() {
        for a in s {
            if let Some(&ci) = want.get(a) {
                if refs[ci].len() < MAX_REFS && t.contains(&chosen[ci].1) {
                    refs[ci].push(ri);
                }
            }
        }
    }
    let mut pairs: Vec<AutoPair> = Vec::new();
    for (ci, (a, b, c, dice, alts)) in chosen.iter().enumerate() {
        let (skey, tstem) = (snames[*a as usize].clone(), tnames[*b as usize].clone());
        // найчастіші форми слів на кількох рядках зразка
        let (mut en_forms, mut uk_forms): (HashMap<String, usize>, HashMap<String, usize>) = (HashMap::new(), HashMap::new());
        for &ri in refs[ci].iter().take(12) {
            let (fi, ui) = row_at[ri];
            let u = &views[fi].units[ui];
            let p = prepare_text(&u.source);
            for t in p.tokens.iter().filter(|t| t.keys[0] == skey) {
                *en_forms.entry(p.text[t.bs..t.be].to_lowercase()).or_insert(0) += 1;
            }
            if let Some(e) = translated(saved.files.get(&views[fi].name).and_then(|m| m.get(&u.key))) {
                let pt = prepare_text(&e.target);
                for t in pt.tokens.iter().filter(|t| t.keys[0] == tstem) {
                    *uk_forms.entry(pt.text[t.bs..t.be].to_lowercase()).or_insert(0) += 1;
                }
            }
        }
        let top = |m: &HashMap<String, usize>, fallback: &str| -> String { m.iter().max_by(|x, y| x.1.cmp(y.1).then_with(|| y.0.len().cmp(&x.0.len()))).map_or(fallback.to_string(), |x| x.0.clone()) };
        let alt_names: Vec<(String, usize)> = alts.iter().map(|(b2, c2)| (tnames[*b2 as usize].clone(), *c2 as usize)).collect();
        pairs.push(AutoPair {
            en: top(&en_forms, &skey),
            key: skey,
            uk: top(&uk_forms, &tstem),
            stem: tstem,
            rows: *c as usize,
            of: df_s[*a as usize] as usize,
            share: *c as f64 / df_s[*a as usize] as f64,
            dice: *dice,
            alts: alt_names,
            refs: refs[ci].iter().map(|ri| MineRef { file: views[row_at[*ri].0].name.clone(), key: views[row_at[*ri].0].units[row_at[*ri].1].key.clone() }).collect(),
        });
    }
    let by_key = pairs.iter().enumerate().map(|(i, p)| (p.key.clone(), i)).collect();
    AutoDict { pairs, by_key }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Entry, Status};
    use crate::project::empty_project;
    use serde_json::json;

    /// Проєкт з одного файлу: (оригінал, переклад) надіслано (`Done`).
    fn project(rows: &[(&str, &str)]) -> (Vec<FileView>, SavedProject) {
        let units: Vec<crate::model::Unit> = rows.iter().enumerate().map(|(i, (s, _))| serde_json::from_value(json!({ "key": format!("k{i}"), "source": s, "speaker": "", "kind": "dialogue", "context": "" })).unwrap()).collect();
        let mut saved = empty_project("T", "en", "uk");
        let mut m = indexmap::IndexMap::new();
        for (i, (_, t)) in rows.iter().enumerate() {
            if !t.is_empty() {
                m.insert(format!("k{i}"), Entry { target: t.to_string(), status: Status::Done, ..Entry::blank() });
            }
        }
        saved.files.insert("Items.json".into(), m);
        (vec![FileView { name: "Items.json".into(), units, label: None }], saved)
    }

    fn sample() -> (Vec<FileView>, SavedProject) {
        project(&[
            ("Draw the sword", "Діставай меч"),
            ("The sword is sharp", "Меч гострий"),
            ("A rusty sword lies here", "Тут лежить іржавий меч"),
            ("He lost the sword", "Він загубив меч"),
            ("Open the gate", "Відкрий браму"),
            ("The gate is closed", "Брама зачинена"),
            ("Guard the gate", "Охороняй браму"),
            ("Light the torch", "Запали смолоскип"),
            ("The torch burns", "Смолоскип горить"),
            ("Take the torch", "Візьми смолоскип"),
            ("Light the torch now", "Запали факел зараз"),
            ("A torch in the dark", "Факел у темряві"),
            ("Bring the torch", "Принеси факел"),
        ])
    }

    #[test]
    fn a_word_translated_the_same_way_in_enough_rows_becomes_a_pair() {
        let (v, s) = sample();
        let d = learn_dictionary(&v, &s, &[], 1000);
        let sword = d.pair_for("sword").expect("sword → меч");
        assert_eq!((sword.en.as_str(), sword.uk.as_str(), sword.rows, sword.of), ("sword", "меч", 4, 4));
        assert!(sword.share >= 0.99 && sword.sure(), "{sword:?}");
        let gate = d.pair_for("gate").expect("gate → брама");
        assert_eq!(gate.uk, "браму".to_string().as_str().replace("браму", &gate.uk), "форма береться з рядків");
        assert_eq!(gate.rows, 3);
        assert!(gate.refs.len() == 3 && gate.refs.iter().all(|r| r.file == "Items.json"));
        // слово, яке бачили лише двічі, не пропонується
        assert!(d.pair_for("dark").is_none());
    }

    #[test]
    fn two_competing_translations_are_not_sure_and_list_the_alternative() {
        let (v, s) = sample();
        let d = learn_dictionary(&v, &s, &[], 1000);
        let torch = d.pair_for("torch").expect("torch має пару");
        assert!(!torch.sure(), "два переклади — не певна пара: {torch:?}");
        assert!(!torch.alts.is_empty(), "{torch:?}");
    }

    #[test]
    fn a_word_already_in_the_glossary_is_not_offered() {
        let (v, s) = sample();
        let d = learn_dictionary(&v, &s, &["sword".to_string()], 1000);
        assert!(d.pair_for("sword").is_none());
        assert!(d.pair_for("gate").is_some());
    }

    #[test]
    fn threads_show_where_the_translation_carries_a_learned_word() {
        let (v, s) = sample();
        let d = learn_dictionary(&v, &s, &[], 1000);
        // слово в рядку: нитка до відмінкової форми («мечем»), а де слова немає — нитка без другого кінця
        let th = d.threads("Strike with the sword", "Бий мечем");
        let t = th.iter().find(|t| d.pairs[t.pair].key == "sword").expect("нитка sword");
        assert_eq!(t.src, (16, 21));
        assert_eq!(t.dst, Some((4, 9)));
        let odd = d.threads("Strike with the sword", "Бий клинком");
        assert_eq!(odd.iter().find(|t| d.pairs[t.pair].key == "sword").unwrap().dst, None, "переклад передає слово інакше");
    }

    #[test]
    fn drafts_and_untranslated_rows_teach_nothing() {
        let mut rows: Vec<(&str, &str)> = Vec::new();
        for _ in 0..5 {
            rows.push(("Draw the sword", ""));
        }
        let (v, s) = project(&rows);
        assert!(learn_dictionary(&v, &s, &[], 1000).pairs.is_empty());
    }
}
