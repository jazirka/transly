//! `ukmorph.ts`: відмінювання іменників і прикметників за правилами, без словника («аналіз через синтез»).
//! Слова, списки й ваги — ті самі, що в TS; мета — однакові форми й однакові оцінки впевненості.
//!
//! Відомі відмінності: словник `MorphDict` — трейт (у векторах не використовується); пошук у таблицях виключень не
//! має збігів із властивостями прототипу JS (`constructor` тощо), бо такі слова — латиниця й не відмінюються.

#![allow(clippy::needless_range_loop)]

use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

pub const UK_CASES: [&str; 7] = ["nom", "gen", "dat", "acc", "ins", "loc", "voc"];

/// Клітинка парадигми: індекс 0..14 у порядку `CELLS` (відмінок × [одн., множ.]).
pub type Cell = usize;
pub const NCELLS: usize = 14;

pub fn cell_name(c: Cell) -> String {
    format!("{}.{}", UK_CASES[c / 2], if c.is_multiple_of(2) { "sg" } else { "pl" })
}
pub fn cell_idx(name: &str) -> Cell {
    let (case, num) = name.split_once('.').expect("клітинка");
    UK_CASES.iter().position(|c| *c == case).expect("відмінок") * 2 + usize::from(num == "pl")
}
fn cell_case(c: Cell) -> &'static str {
    UK_CASES[c / 2]
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Conf {
    pub score: f64,
    pub level: &'static str,
    pub flags: Vec<String>,
}
pub fn level_of(score: f64) -> &'static str {
    if score >= 0.9 { "high" } else if score >= 0.6 { "medium" } else { "low" }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gender {
    M,
    F,
    N,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct MorphInfo {
    pub gender: Option<Gender>,
    pub animate: Option<bool>,
}
/// Джерело кращого знання (словник): повні форми слова або його рід і одушевленість.
pub trait MorphDict {
    fn lexeme(&self, _lemma: &str) -> Option<HashMap<Cell, Vec<String>>> {
        None
    }
    fn info(&self, _lemma: &str) -> Option<MorphInfo> {
        None
    }
}

#[derive(Clone, Debug)]
struct Form {
    form: String,
    p: f64,
    flags: Vec<String>,
}
type Paradigm = Vec<Vec<Form>>;
fn blank() -> Paradigm {
    vec![Vec::new(); NCELLS]
}
fn form(f: impl Into<String>, p: f64, flags: Vec<String>) -> Form {
    Form { form: f.into(), p, flags }
}

/* ---------- літери й короткі списки ---------- */

/// Слово у вигляді, в якому зберігаються точні форми (малі літери, один вид апострофа).
pub fn uk_norm(s: &str) -> String {
    s.to_lowercase().replace(['\'', 'ʼ', '`'], "’")
}
const CONS: &str = "бвгґджзклмнпрстфхцчшщ";
const HUSH: &str = "жчшщ";
fn is_vowel(c: Option<char>) -> bool {
    c.is_some_and(|c| "аеєиіїоуюя".contains(c))
}
fn is_cons(c: Option<char>) -> bool {
    c.is_some_and(|c| CONS.contains(c))
}
/// `HUSH.includes(x)` у JS: порожній рядок «входить» завжди.
fn in_hush(c: Option<char>) -> bool {
    c.is_none_or(|c| HUSH.contains(c))
}
fn last_ch(s: &str) -> Option<char> {
    s.chars().next_back()
}
/// Рядок без останніх `n` символів.
fn cut(s: &str, n: usize) -> String {
    let len = s.chars().count();
    s.chars().take(len.saturating_sub(n)).collect()
}
/// Останній символ як рядок (порожній, якщо рядок порожній).
fn last_s(s: &str) -> String {
    last_ch(s).map(String::from).unwrap_or_default()
}
fn nth_from_end(s: &str, k: usize) -> Option<char> {
    s.chars().rev().nth(k)
}

macro_rules! list {
    ($name:ident, $s:expr) => {
        static $name: LazyLock<HashSet<&'static str>> = LazyLock::new(|| $s.split_whitespace().collect());
    };
}

list!(G_A, "меч щит шолом кинджал клинок лук спис посох жезл плащ пояс перстень амулет браслет медальйон обруч обладунок молот ніж ключ камінь кристал самоцвіт артефакт предмет талісман свиток жетон мішок рюкзак чобіт черевик капюшон костюм кубок келих глечик горщик ліхтар факел смолоскип засув барабан тесак келеп арбалет патрон снаряд набій стілець стіл лист листок значок аркуш прапор шарф ремінь пакет ящик сундук ланцюг якір гаманець візок");
list!(G_U, "ліс світ страх вогонь дощ сніг дим пил час сон ґрунт гнів вітер лід мороз туман острів будинок міст сад двір храм цех рух звук запах смак шлях бій спокій мир порядок розум успіх голод холод жар суд гріх труд вік рік ранок вечір край");
list!(ANIMATE, "дракон ельф гном орк троль гоблін лицар маг чарівник чаклун воїн король принц вовк кінь лев ведмідь пес кіт майстер умілець звір птах лебідь голуб ворог друг герой бог дух привид демон ангел вампір скелет павук щур змій торговець слуга гість старець селянин купець жрець мудрець хлопець чоловік лікар вчитель мисливець розбійник злодій стражник солдат капітан командир цар князь пан дід батько син брат хазяїн господар бик козел баран вепр олень лис заєць орел ворон сокіл дятел крук соловей шакал гігант велетень циклоп мертвяк упир");
list!(MASC_A, "слуга воєвода староста суддя микола хома лука сава кузьма фома добриня юрась");
list!(MASC_O, "петро павло данило михайло гаврило дмитро панько мирослав батько дядько тарас");
list!(MASC_IST, "гість");
list!(FEM_AN, "жінка відьма сестра корова королева миша дочка дівчина дівка лисиця вовчиця принцеса служниця чарівниця відьмачка кобила вівця курка свиня жриця воїтелька пані");
list!(FEM3, "ніч піч річ сіль ціль осінь тінь мідь подорож кров любов заметіль мозоль цвіль міць честь лють жовч смерть путь кість");
list!(MASS, "золото залізо срібло молоко масло борошно зілля вугілля насіння любов кров мідь честь лють");
list!(INDECL, "кафе меню метро кіно радіо таксі пальто бюро інтерв’ю шосе какао кенгуру журі цунамі хобі попурі");
list!(SOFT_AR, "лікар пекар кобзар бондар гончар писар секретар бібліотекар слюсар токар володар лицар цар кухар сухар шахтар вівчар школяр");
list!(NOUN_IJ, "геній санаторій андрій сергій василій юрій марій гарій дарій сувій гній змій рій");
list!(SOFT_ADJ, "синій третій");
list!(GEN_EJ, "кінь гість гусь");
list!(FLEET, "клинок листок значок мішок візок хлопець палець кінець стрілець купець старець торговець мисливець гаманець");
list!(KEEP_VOWEL, "урок рок мудрець олень кремень");
list!(NOALT, "ліс хліб вік мир гріх біг сміх дід тріск крик");
list!(COMB, "жар напів екс віце диво міні міді максі супер квазі лейб обер анти контр мега псевдо");
list!(FROZEN, "в у на з із зі до від для про при над під між за по без через перед й і та або чи ні не а але як проти біля коло серед крізь навколо поруч");

/// Голосний перед останнім приголосним випадає: основа у формах із закінченням.
fn fleet_stem(l: &str) -> Option<&'static str> {
    Some(match l {
        "день" => "дн", "пень" => "пн", "сон" => "сн", "вогонь" => "вогн", "лоб" => "лб", "вітер" => "вітр", "пес" => "пс",
        "перстень" => "персн", "майстер" => "майстр", "орел" => "орл", "козел" => "козл", "заєць" => "зайц", "корабель" => "корабл", "рівень" => "рівн",
        _ => return None,
    })
}
/// і останнього складу стає о або е у формах із закінченням.
fn alt_of(l: &str) -> Option<&'static str> {
    Some(match l {
        "ніч" => "о", "піч" => "е", "річ" => "е", "сіль" => "о", "ніж" => "о", "стіл" => "о", "кіт" => "о", "кінь" => "о", "камінь" => "е",
        "корінь" => "е", "міст" => "о", "ріг" => "о", "рів" => "о", "сніп" => "о", "осінь" => "е", "тінь" => "е", "гість" => "о", "кість" => "о",
        "дім" => "о", "бік" => "о", "сік" => "о", "пліт" => "о", "лід" => "ьо",
        _ => return None,
    })
}
/// Прийменники й відмінки, яких вони вимагають (перший — звичайний).
fn prep(w: &str) -> Option<&'static [&'static str]> {
    Some(match w {
        "в" | "у" => &["loc", "acc", "gen"],
        "на" => &["loc", "acc"],
        "при" => &["loc"],
        "по" => &["loc", "dat", "acc"],
        "о" => &["loc", "acc"],
        "до" | "від" | "для" | "без" | "біля" | "коло" | "серед" | "навколо" | "проти" => &["gen"],
        "з" | "із" | "зі" => &["gen", "ins"],
        "над" | "перед" | "між" => &["ins"],
        "під" | "за" => &["ins", "acc"],
        "про" | "через" | "крізь" => &["acc"],
        _ => return None,
    })
}
fn velar(c: &str) -> Option<&'static str> {
    Some(match c { "г" => "з", "к" => "ц", "х" => "с", "ґ" => "з", _ => return None })
}
fn voc_alt(c: &str) -> Option<&'static str> {
    Some(match c { "г" => "ж", "к" => "ч", "х" => "ш", "ґ" => "ж", _ => return None })
}

struct Exc {
    g: Gender,
    an: Option<bool>,
    forms: Vec<(Cell, Vec<String>)>,
}
fn ex(g: Gender, an: Option<bool>, f: &[(&str, &[&str])]) -> Exc {
    Exc { g, an, forms: f.iter().map(|(c, v)| (cell_idx(c), v.iter().map(|s| s.to_string()).collect())).collect() }
}

const PLURALIA: &[(&str, &str)] = &[
    ("ворота", "ворота воріт воротам ворота воротами воротах"), ("штани", "штани штанів штанам штани штанами штанах"),
    ("окуляри", "окуляри окулярів окулярам окуляри окулярами окулярах"), ("ножиці", "ножиці ножиць ножицям ножиці ножицями ножицях"),
    ("сани", "сани саней саням сани санями санях"), ("гроші", "гроші грошей грошам гроші грошима грошах"),
    ("ліки", "ліки ліків лікам ліки ліками ліках"), ("плечі", "плечі плечей плечам плечі плечима плечах"),
];

/// Слова з неправильними формами: те, що перелічено, береться замість правил.
fn exc(l: &str) -> Option<Exc> {
    use Gender::*;
    Some(match l {
        "ім’я" => ex(N, None, &[("gen.sg", &["імені"]), ("dat.sg", &["імені"]), ("ins.sg", &["ім’ям"]), ("loc.sg", &["імені"]), ("nom.pl", &["імена"]), ("gen.pl", &["імен"]), ("dat.pl", &["іменам"]), ("acc.pl", &["імена"]), ("ins.pl", &["іменами"]), ("loc.pl", &["іменах"]), ("voc.pl", &["імена"])]),
        "сім’я" => ex(F, None, &[("gen.sg", &["сім’ї"]), ("dat.sg", &["сім’ї"]), ("acc.sg", &["сім’ю"]), ("ins.sg", &["сім’єю"]), ("loc.sg", &["сім’ї"]), ("voc.sg", &["сім’є"]), ("nom.pl", &["сім’ї"]), ("gen.pl", &["сімей"]), ("dat.pl", &["сім’ям"]), ("acc.pl", &["сім’ї"]), ("ins.pl", &["сім’ями"]), ("loc.pl", &["сім’ях"]), ("voc.pl", &["сім’ї"])]),
        "мати" => ex(F, Some(true), &[("nom.sg", &["мати"]), ("gen.sg", &["матері"]), ("dat.sg", &["матері"]), ("acc.sg", &["матір"]), ("ins.sg", &["матір’ю"]), ("loc.sg", &["матері"]), ("voc.sg", &["мати"]), ("nom.pl", &["матері"]), ("gen.pl", &["матерів"]), ("dat.pl", &["матерям"]), ("acc.pl", &["матерів"]), ("ins.pl", &["матерями"]), ("loc.pl", &["матерях"]), ("voc.pl", &["матері"])]),
        "око" => ex(N, None, &[("gen.sg", &["ока"]), ("dat.sg", &["оку"]), ("ins.sg", &["оком"]), ("loc.sg", &["оці"]), ("nom.pl", &["очі"]), ("gen.pl", &["очей"]), ("dat.pl", &["очам"]), ("acc.pl", &["очі"]), ("ins.pl", &["очима"]), ("loc.pl", &["очах"]), ("voc.pl", &["очі"])]),
        "людина" => ex(F, Some(true), &[("nom.pl", &["люди"]), ("gen.pl", &["людей"]), ("dat.pl", &["людям"]), ("acc.pl", &["людей"]), ("ins.pl", &["людьми"]), ("loc.pl", &["людях"]), ("voc.pl", &["люди"])]),
        "дитина" => ex(F, Some(true), &[("nom.pl", &["діти"]), ("gen.pl", &["дітей"]), ("dat.pl", &["дітям"]), ("acc.pl", &["дітей"]), ("ins.pl", &["дітьми"]), ("loc.pl", &["дітях"]), ("voc.pl", &["діти"])]),
        "друг" => ex(M, Some(true), &[("nom.pl", &["друзі"]), ("gen.pl", &["друзів"]), ("dat.pl", &["друзям"]), ("acc.pl", &["друзів"]), ("ins.pl", &["друзями"]), ("loc.pl", &["друзях"]), ("voc.sg", &["друже"]), ("voc.pl", &["друзі"])]),
        "гра" => ex(F, None, &[("nom.pl", &["ігри"]), ("gen.pl", &["ігор"]), ("dat.pl", &["іграм"]), ("acc.pl", &["ігри"]), ("ins.pl", &["іграми"]), ("loc.pl", &["іграх"]), ("voc.pl", &["ігри"])]),
        "ілля" => ex(M, Some(true), &[("gen.sg", &["іллі"]), ("dat.sg", &["іллі"]), ("acc.sg", &["іллю"]), ("ins.sg", &["іллею"]), ("loc.sg", &["іллі"]), ("voc.sg", &["іллє"]), ("nom.pl", &[]), ("gen.pl", &[]), ("dat.pl", &[]), ("acc.pl", &[]), ("ins.pl", &[]), ("loc.pl", &[]), ("voc.pl", &[])]),
        "стаття" => ex(F, None, &[("gen.sg", &["статті"]), ("dat.sg", &["статті"]), ("acc.sg", &["статтю"]), ("ins.sg", &["статтею"]), ("loc.sg", &["статті"]), ("voc.sg", &["статте"]), ("nom.pl", &["статті"]), ("gen.pl", &["статей"]), ("dat.pl", &["статтям"]), ("acc.pl", &["статті"]), ("ins.pl", &["статтями"]), ("loc.pl", &["статтях"]), ("voc.pl", &["статті"])]),
        "серце" => ex(N, None, &[("gen.pl", &["сердець"])]),
        "кінь" => ex(M, Some(true), &[("gen.pl", &["коней"]), ("acc.pl", &["коней"]), ("ins.pl", &["кіньми", "конями"])]),
        "двері" => ex(F, None, &[("nom.sg", &["двері"]), ("gen.sg", &["дверей"]), ("dat.sg", &["дверям"]), ("acc.sg", &["двері"]), ("ins.sg", &["дверима", "дверми"]), ("loc.sg", &["дверях"]), ("voc.sg", &["двері"]), ("nom.pl", &["двері"]), ("gen.pl", &["дверей"]), ("dat.pl", &["дверям"]), ("acc.pl", &["двері"]), ("ins.pl", &["дверима", "дверми"]), ("loc.pl", &["дверях"]), ("voc.pl", &["двері"])]),
        _ => {
            let (_, f) = PLURALIA.iter().find(|(k, _)| *k == l)?;
            let w: Vec<&str> = f.split(' ').collect();
            let mut forms = Vec::new();
            for n in ["sg", "pl"] {
                for (case, i) in [("nom", 0), ("gen", 1), ("dat", 2), ("acc", 3), ("ins", 4), ("loc", 5)] {
                    forms.push((cell_idx(&format!("{case}.{n}")), vec![w[i].to_string()]));
                }
                forms.push((cell_idx(&format!("voc.{n}")), vec![w[0].to_string()]));
            }
            Exc { g: N, an: None, forms }
        }
    })
}
fn plural_only(l: &str) -> bool {
    l == "двері" || PLURALIA.iter().any(|(k, _)| *k == l)
}
/// Родовий множини слів середнього й жіночого роду, яких правила не беруть.
fn gen_pl(l: &str) -> Option<&'static str> {
    Some(match l {
        "слово" => "слів", "село" => "сіл", "число" => "чисел", "вікно" => "вікон", "місто" => "міст", "озеро" => "озер", "дерево" => "дерев",
        "коло" => "кіл", "крило" => "крил", "ліжко" => "ліжок", "горло" => "горл", "дзеркало" => "дзеркал", "нога" => "ніг", "гора" => "гір",
        "школа" => "шкіл", "рука" => "рук", "сестра" => "сестер", "країна" => "країн", "книга" => "книг", "вода" => "вод", "ціна" => "цін",
        "земля" => "земель", "пісня" => "пісень", "вишня" => "вишень", "шабля" => "шабель", "зброя" => "зброй", "море" => "морів", "поле" => "полів",
        "стріла" => "стріл", "сокира" => "сокир", "броня" => "броней", "відьма" => "відьом", "королева" => "королев", "дівчина" => "дівчат", "принцеса" => "принцес",
        _ => return None,
    })
}

/* ---------- іменники ---------- */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Cls { MH, MM, MS, MY, MO, NH, NS, NYa, FH, FM, FS, FY, FI, F3, Indecl, Exc }
impl Cls {
    fn is_m(self) -> bool { matches!(self, Cls::MH | Cls::MM | Cls::MS | Cls::MY | Cls::MO) }
    fn is_n(self) -> bool { matches!(self, Cls::NH | Cls::NS | Cls::NYa) }
}

#[derive(Clone, Debug)]
struct Noun {
    lemma: String,
    g: Gender,
    an: bool,
    cls: Cls,
    p: f64,
    flags: Vec<String>,
    plural: bool,
}

fn s(x: &str) -> String {
    x.to_string()
}
fn sv(x: &[&str]) -> Vec<String> {
    x.iter().map(|v| v.to_string()).collect()
}

/// Рід, одушевленість і відміна леми (малі літери, один вид апострофа).
fn parse_noun(lemma: &str, dict: Option<&dyn MorphDict>) -> Noun {
    let info = dict.and_then(|d| d.info(lemma));
    let mut flags: Vec<String> = Vec::new();
    let mut p = 0.99;
    let (mut g, mut cls);
    let last = last_ch(lemma);
    let pre = nth_from_end(lemma, 1);
    let e = exc(lemma);
    let ends = |x: &str| lemma.ends_with(x);
    if let Some(e) = &e {
        g = e.g;
        cls = Cls::Exc;
    } else if INDECL.contains(lemma) {
        g = Gender::N;
        cls = Cls::Indecl;
        flags.push(s("indeclinable"));
    } else if ends("ія") && lemma.chars().count() > 3 {
        g = Gender::F;
        cls = Cls::FI;
    } else if last == Some('а') || last == Some('я') {
        if MASC_A.contains(lemma) {
            g = Gender::M;
            cls = if last == Some('а') { Cls::FH } else { Cls::FS };
        } else if last == Some('а') {
            g = Gender::F;
            cls = if in_hush(pre) { Cls::FM } else { Cls::FH };
        } else if pre == Some('’') {
            g = Gender::N;
            cls = Cls::NYa;
            p *= 0.9;
            flags.push(s("apostrophe-я"));
        } else if pre.is_some() && is_cons(pre) && nth_from_end(lemma, 2) == pre {
            g = Gender::N;
            cls = Cls::NYa;
        } else if is_vowel(pre) {
            g = Gender::F;
            cls = Cls::FY;
        } else {
            g = Gender::F;
            cls = Cls::FS;
        }
    } else if last == Some('о') {
        if MASC_O.contains(lemma) {
            g = Gender::M;
            cls = Cls::MO;
        } else {
            g = Gender::N;
            cls = Cls::NH;
        }
    } else if last == Some('е') {
        g = Gender::N;
        cls = Cls::NS;
    } else if last == Some('ь') {
        if (FEM3.contains(lemma) || ends("сть")) && !MASC_IST.contains(lemma) {
            g = Gender::F;
            cls = Cls::F3;
        } else {
            g = Gender::M;
            cls = Cls::MS;
            if !ANIMATE.contains(lemma) && !G_A.contains(lemma) && !G_U.contains(lemma) && fleet_stem(lemma).is_none() && alt_of(lemma).is_none() && !KEEP_VOWEL.contains(lemma) {
                p *= 0.9;
                flags.push(s("soft-guess"));
            }
        }
    } else if last == Some('й') {
        g = Gender::M;
        cls = Cls::MY;
        p *= 0.7;
        flags.push(s("й-stem"));
    } else if FEM3.contains(lemma) {
        g = Gender::F;
        cls = Cls::F3;
    } else if is_cons(last) {
        g = Gender::M;
        cls = if in_hush(last) { Cls::MM } else if SOFT_AR.contains(lemma) { Cls::MS } else { Cls::MH };
    } else {
        g = Gender::M;
        cls = Cls::MH;
        p *= 0.5;
        flags.push(s("unknown-shape"));
    }
    if let Some(ig) = info.and_then(|i| i.gender) {
        if ig != g {
            if cls.is_m() && ig == Gender::F && (is_cons(last) || last == Some('ь')) {
                cls = Cls::F3;
            } else if cls == Cls::F3 && ig == Gender::M {
                cls = if last == Some('ь') { Cls::MS } else if in_hush(last) { Cls::MM } else { Cls::MH };
            }
            g = ig;
        }
    }
    let an = info
        .and_then(|i| i.animate)
        .or(e.as_ref().and_then(|e| e.an))
        .unwrap_or(ANIMATE.contains(lemma) || FEM_AN.contains(lemma) || MASC_A.contains(lemma) || MASC_O.contains(lemma));
    if !an && g == Gender::M && info.and_then(|i| i.animate).is_none() && cls != Cls::Indecl {
        flags.push(s("animacy-guess"));
    }
    Noun { lemma: lemma.to_string(), g, an, cls, p, flags, plural: plural_only(lemma) }
}

struct Oblique {
    stem: String,
    p: f64,
    flags: Vec<String>,
}

/// Основа форм із закінченням: голосний, що випав, і і → о/е; з вагою.
fn oblique(n: &Noun) -> Oblique {
    let l = n.lemma.as_str();
    let mut stem = if l.ends_with('ь') || l.ends_with('й') { cut(l, 1) } else { l.to_string() };
    let mut p = 1.0;
    let mut flags: Vec<String> = Vec::new();
    if n.g == Gender::M && !KEEP_VOWEL.contains(l) {
        if let Some(fixed) = fleet_stem(l) {
            stem = fixed.to_string();
            p *= 0.98;
            flags.push(s("fleeting"));
        } else if l.ends_with("ок") || l.ends_with("ець") {
            let ch: Vec<char> = stem.chars().collect();
            let k = ch.len();
            if k >= 3 && "оеє".contains(ch[k - 2]) && "кц".contains(ch[k - 1]) && is_cons(Some(ch[k - 3])) {
                let head: String = ch[..k - 2].iter().collect();
                let tail = if ch[k - 3] == 'л' && ch[k - 1] == 'ц' { "ьц".to_string() } else { ch[k - 1].to_string() };
                stem = head + &tail;
                p *= if FLEET.contains(l) { 0.98 } else { 0.85 };
                flags.push(s("fleeting"));
            }
        } else if l.ends_with("ень") {
            p *= 0.75;
            flags.push(s("fleeting?"));
        }
    }
    if let Some(alt) = alt_of(l) {
        let ch: Vec<char> = stem.chars().collect();
        if let Some(i) = ch.iter().rposition(|c| *c == 'і') {
            stem = ch[..i].iter().collect::<String>() + alt + &ch[i + 1..].iter().collect::<String>();
        }
        flags.push(s("alt"));
        p *= 0.98;
    } else if n.cls == Cls::F3 && l.ends_with("ість") {
        if stem.ends_with("іст") {
            stem = cut(&stem, 3) + "ост";
        }
        flags.push(s("alt"));
    } else if !NOALT.contains(l) && (n.g == Gender::M || n.cls == Cls::F3) && !(l.ends_with("ець") || l.ends_with("ень")) {
        let ch: Vec<char> = stem.chars().collect();
        let k = ch.len();
        if k >= 3 && is_cons(Some(ch[k - 3])) && ch[k - 2] == 'і' && is_cons(Some(ch[k - 1])) {
            p *= 0.8;
            flags.push(s("alt?"));
        }
    }
    Oblique { stem, p, flags }
}

fn push(pp: &mut Paradigm, base: f64, flags: &[String], cell: &str, f: String, pm: f64, extra: &[&str]) {
    let mut fl = flags.to_vec();
    fl.extend(extra.iter().map(|x| x.to_string()));
    pp[cell_idx(cell)].push(form(f, (base * pm).min(0.99), fl));
}

/// Петро, Павло, батько: форми чоловічого іменника з основою Петр-, Павл-, батьк-, а називний — як є.
fn masculine_o(n: &Noun) -> Paradigm {
    let l = n.lemma.as_str();
    let mut pp = masculine(&Noun { lemma: cut(l, 1), cls: Cls::MH, an: true, flags: Vec::new(), ..n.clone() });
    pp[cell_idx("nom.sg")] = vec![form(l, n.p.min(0.99), n.flags.clone())];
    if l.ends_with("ько") {
        pp[cell_idx("voc.sg")] = vec![form(cut(l, 1) + "у", 0.6, sv(&["voc"]))];
    }
    pp
}

fn masculine(n: &Noun) -> Paradigm {
    if n.cls == Cls::MO {
        return masculine_o(n);
    }
    let mut pp = blank();
    let l = n.lemma.as_str();
    let ob = oblique(n);
    let soft = matches!(n.cls, Cls::MS | Cls::MY);
    let mixed = n.cls == Cls::MM;
    let y = n.cls == Cls::MY;
    let stem = ob.stem.clone();
    let mut flags: Vec<String> = n.flags.iter().filter(|f| *f != "animacy-guess").cloned().collect();
    flags.extend(ob.flags.iter().cloned());
    let base = n.p * ob.p;
    let last = last_s(&stem);
    let velar_end = !soft && !mixed && velar(&last).is_some();
    macro_rules! add {
        ($c:expr, $f:expr) => { push(&mut pp, base, &flags, $c, $f, 1.0, &[]) };
        ($c:expr, $f:expr, $p:expr) => { push(&mut pp, base, &flags, $c, $f, $p, &[]) };
        ($c:expr, $f:expr, $p:expr, $x:expr) => { push(&mut pp, base, &flags, $c, $f, $p, $x) };
    }
    add!("nom.sg", l.to_string());
    let (g_a, g_u) = (if soft { "я" } else { "а" }, if soft { "ю" } else { "у" });
    if G_U.contains(l) {
        add!("gen.sg", format!("{stem}{g_u}"), 0.98, &["gen-u"]);
        add!("gen.sg", format!("{stem}{g_a}"), 0.98);
    } else if G_A.contains(l) || n.an {
        add!("gen.sg", format!("{stem}{g_a}"), 0.98);
    } else {
        add!("gen.sg", format!("{stem}{g_a}"), 0.72, &["gen-a-u"]);
        add!("gen.sg", format!("{stem}{g_u}"), 0.72, &["gen-a-u"]);
    }
    let d_e = if y { "єві" } else if soft || mixed { "еві" } else { "ові" };
    let d_u = if soft { "ю" } else { "у" };
    if n.an {
        add!("dat.sg", format!("{stem}{d_e}"), 0.97);
        add!("dat.sg", format!("{stem}{d_u}"), 0.97);
    } else {
        add!("dat.sg", format!("{stem}{d_u}"), 0.95);
        add!("dat.sg", format!("{stem}{d_e}"), 0.95);
    }
    let src = if n.an { "gen.sg" } else { "nom.sg" };
    let copy = pp[cell_idx(src)].clone();
    pp[cell_idx("acc.sg")].extend(copy);
    add!("ins.sg", format!("{stem}{}", if y { "єм" } else if soft || mixed { "ем" } else { "ом" }));
    let l_i = if y { "ї" } else { "і" };
    if velar_end {
        if n.an {
            add!("loc.sg", format!("{stem}{d_e}"), 0.88);
            add!("loc.sg", format!("{stem}у"), 0.88);
        } else {
            add!("loc.sg", format!("{stem}у"), 0.85);
            add!("loc.sg", format!("{}{}і", cut(&stem, 1), velar(&last).unwrap_or(&last)), 0.85);
        }
    } else if n.an {
        add!("loc.sg", format!("{stem}{d_e}"), 0.92);
        add!("loc.sg", format!("{stem}{l_i}"), 0.92);
    } else {
        add!("loc.sg", format!("{stem}{l_i}"), 0.95);
        add!("loc.sg", format!("{stem}{d_u}"), 0.75);
    }
    if soft {
        add!("voc.sg", format!("{stem}ю"), 0.6, &["voc"]);
    } else if mixed {
        add!("voc.sg", format!("{stem}у"), 0.6, &["voc"]);
    } else {
        let st = match voc_alt(&last) { Some(v) => cut(&stem, 1) + v, None => stem.clone() };
        add!("voc.sg", format!("{st}е"), 0.6, &["voc"]);
    }
    let p_i = if soft || mixed { "і" } else { "и" };
    add!("nom.pl", format!("{stem}{}", if y { "ї" } else { p_i }), 0.97);
    if GEN_EJ.contains(l) {
        add!("gen.pl", format!("{stem}ей"), 0.95);
        add!("gen.pl", format!("{stem}ів"), 0.6);
    } else {
        add!("gen.pl", format!("{stem}{}", if y { "їв" } else { "ів" }), 0.96);
    }
    add!("dat.pl", format!("{stem}{}", if soft { "ям" } else { "ам" }));
    add!("ins.pl", format!("{stem}{}", if soft { "ями" } else { "ами" }));
    add!("loc.pl", format!("{stem}{}", if soft { "ях" } else { "ах" }));
    let src = if n.an { "gen.pl" } else { "nom.pl" };
    let copy = pp[cell_idx(src)].clone();
    pp[cell_idx("acc.pl")].extend(copy);
    let copy: Vec<Form> = pp[cell_idx("nom.pl")].iter().map(|f| Form { p: f.p * 0.8, ..f.clone() }).collect();
    pp[cell_idx("voc.pl")].extend(copy);
    // знахідний залежить від одушевленості; коли її лише вгадано, він менш певний
    if n.flags.iter().any(|f| f == "animacy-guess") {
        for c in ["acc.sg", "acc.pl"] {
            for f in pp[cell_idx(c)].iter_mut() {
                f.p *= 0.8;
                f.flags.push(s("animacy-guess"));
            }
        }
    }
    pp
}

/// Нульове закінчення родового множини: між збігом приголосних вставляється голосний (вікн → вікон).
fn zero_gen(stem: &str) -> String {
    let ch: Vec<char> = stem.chars().collect();
    let k = ch.len();
    if k >= 2 && "кнлрмтц".contains(ch[k - 1]) && is_cons(Some(ch[k - 2])) {
        let head: String = ch[..k - 1].iter().collect();
        format!("{head}{}{}", if "кт".contains(ch[k - 1]) { "о" } else { "е" }, ch[k - 1])
    } else {
        stem.to_string()
    }
}

/// Родовий множини м'якої відміни на -я: пісн → пісень, земл → земель.
fn soft_gen(stem: &str) -> String {
    let ch: Vec<char> = stem.chars().collect();
    let k = ch.len();
    if k >= 2 && "лнрм".contains(ch[k - 1]) && is_cons(Some(ch[k - 2])) {
        let head: String = ch[..k - 1].iter().collect();
        format!("{head}е{}ь", ch[k - 1])
    } else {
        format!("{stem}ь")
    }
}

fn neuter(n: &Noun) -> Paradigm {
    let mut pp = blank();
    let l = n.lemma.as_str();
    let base = n.p;
    macro_rules! add {
        ($c:expr, $f:expr) => { push(&mut pp, base, &n.flags, $c, $f, 1.0, &[]) };
        ($c:expr, $f:expr, $p:expr) => { push(&mut pp, base, &n.flags, $c, $f, $p, &[]) };
        ($c:expr, $f:expr, $p:expr, $x:expr) => { push(&mut pp, base, &n.flags, $c, $f, $p, $x) };
    }
    if n.cls == Cls::NYa {
        let stem = cut(l, 1);
        let apos = stem.ends_with('’');
        add!("nom.sg", l.to_string());
        add!("gen.sg", l.to_string());
        add!("dat.sg", format!("{stem}ю"));
        add!("acc.sg", l.to_string());
        add!("ins.sg", format!("{stem}ям"));
        add!("loc.sg", format!("{stem}{}", if apos { "ї" } else { "і" }));
        add!("voc.sg", l.to_string());
        let r = &["rare-plural"];
        add!("nom.pl", l.to_string(), 0.6, r);
        add!("gen.pl", format!("{stem}ь"), 0.5, r);
        add!("dat.pl", format!("{stem}ям"), 0.6, r);
        add!("acc.pl", l.to_string(), 0.6, r);
        add!("ins.pl", format!("{stem}ями"), 0.6, r);
        add!("loc.pl", format!("{stem}ях"), 0.6, r);
        add!("voc.pl", l.to_string(), 0.5, r);
        return pp;
    }
    let stem = cut(l, 1);
    let soft = n.cls == Cls::NS;
    let ctx = soft && !in_hush(last_ch(&stem));
    let (a_or_ya, u_or_yu) = (if ctx { "я" } else { "а" }, if ctx { "ю" } else { "у" });
    add!("nom.sg", l.to_string());
    add!("gen.sg", format!("{stem}{a_or_ya}"));
    add!("dat.sg", format!("{stem}{u_or_yu}"));
    add!("acc.sg", l.to_string());
    add!("ins.sg", format!("{stem}{}", if soft { "ем" } else { "ом" }));
    let lc = last_s(&stem);
    if !soft && velar(&lc).is_some() {
        add!("loc.sg", format!("{stem}у"), 0.95);
        add!("loc.sg", format!("{}{}і", cut(&stem, 1), velar(&lc).unwrap()), 0.9);
    } else {
        add!("loc.sg", format!("{stem}і"));
        if !soft {
            add!("loc.sg", format!("{stem}у"), 0.7);
        }
    }
    add!("voc.sg", l.to_string());
    add!("nom.pl", format!("{stem}{a_or_ya}"));
    if let Some(gp) = gen_pl(l) {
        add!("gen.pl", gp.to_string(), 0.95, &["gen-pl-listed"]);
    } else if ctx {
        add!("gen.pl", format!("{stem}ів"), 0.6, &["gen-pl?"]);
    } else {
        add!("gen.pl", zero_gen(&stem), 0.6, &["gen-pl?"]);
    }
    add!("dat.pl", format!("{stem}{}", if ctx { "ям" } else { "ам" }));
    add!("acc.pl", format!("{stem}{a_or_ya}"));
    add!("ins.pl", format!("{stem}{}", if ctx { "ями" } else { "ами" }));
    add!("loc.pl", format!("{stem}{}", if ctx { "ях" } else { "ах" }));
    add!("voc.pl", format!("{stem}{a_or_ya}"), 0.8);
    pp
}

fn feminine(n: &Noun) -> Paradigm {
    let mut pp = blank();
    let l = n.lemma.as_str();
    macro_rules! add {
        ($c:expr, $f:expr) => { push(&mut pp, n.p, &n.flags, $c, $f, 1.0, &[]) };
        ($c:expr, $f:expr, $p:expr) => { push(&mut pp, n.p, &n.flags, $c, $f, $p, &[]) };
        ($c:expr, $f:expr, $p:expr, $x:expr) => { push(&mut pp, n.p, &n.flags, $c, $f, $p, $x) };
    }
    if n.cls == Cls::F3 {
        let ob = oblique(n);
        let stem = ob.stem.clone();
        let has_soft = l.ends_with('ь');
        let hush = in_hush(last_ch(&stem));
        let mut fl = n.flags.clone();
        fl.extend(ob.flags.iter().cloned());
        let base = n.p * ob.p;
        macro_rules! a {
            ($c:expr, $f:expr) => { push(&mut pp, base, &fl, $c, $f, 1.0, &[]) };
            ($c:expr, $f:expr, $p:expr) => { push(&mut pp, base, &fl, $c, $f, $p, &[]) };
        }
        a!("nom.sg", l.to_string());
        a!("gen.sg", format!("{stem}і"));
        a!("dat.sg", format!("{stem}і"));
        a!("acc.sg", l.to_string());
        a!("loc.sg", format!("{stem}і"));
        // останній приголосний подвоюється після голосного; після губного й р стоїть апостроф
        let own = if has_soft { cut(l, 1) } else { l.to_string() };
        let (lc, prev) = (last_ch(&own), nth_from_end(&own, 1));
        let ins = if lc.is_some_and(|c| "бпвмфр".contains(c)) && is_vowel(prev) {
            format!("{own}’ю")
        } else if is_vowel(prev) && lc.is_some_and(|c| "дтзслнжчшц".contains(c)) {
            format!("{own}{}ю", lc.unwrap())
        } else {
            format!("{own}ю")
        };
        a!("ins.sg", ins, 0.97);
        a!("voc.sg", l.to_string(), 0.6);
        a!("nom.pl", format!("{stem}і"));
        a!("gen.pl", format!("{stem}ей"), 0.95);
        let soft = has_soft && !hush;
        a!("dat.pl", format!("{stem}{}", if soft { "ям" } else { "ам" }));
        a!("acc.pl", format!("{stem}і"));
        a!("ins.pl", format!("{stem}{}", if soft { "ями" } else { "ами" }));
        a!("loc.pl", format!("{stem}{}", if soft { "ях" } else { "ах" }));
        a!("voc.pl", format!("{stem}і"), 0.8);
        return pp;
    }
    if n.cls == Cls::FI {
        let st = cut(l, 2);
        add!("nom.sg", l.to_string());
        add!("gen.sg", format!("{st}ії"));
        add!("dat.sg", format!("{st}ії"));
        add!("acc.sg", format!("{st}ію"));
        add!("ins.sg", format!("{st}ією"));
        add!("loc.sg", format!("{st}ії"));
        add!("voc.sg", format!("{st}іє"), 0.6, &["voc"]);
        add!("nom.pl", format!("{st}ії"));
        add!("gen.pl", format!("{st}ій"));
        add!("dat.pl", format!("{st}іям"));
        add!("acc.pl", format!("{st}ії"));
        add!("ins.pl", format!("{st}іями"));
        add!("loc.pl", format!("{st}іях"));
        add!("voc.pl", format!("{st}ії"), 0.8);
        return pp;
    }
    if n.cls == Cls::FY {
        let st = cut(l, 1);
        add!("nom.sg", l.to_string());
        add!("gen.sg", format!("{st}ї"));
        add!("dat.sg", format!("{st}ї"));
        add!("acc.sg", format!("{st}ю"));
        add!("ins.sg", format!("{st}єю"));
        add!("loc.sg", format!("{st}ї"));
        add!("voc.sg", format!("{st}є"), 0.6, &["voc"]);
        let r = &["rare-plural"];
        add!("nom.pl", format!("{st}ї"), 0.5, r);
        add!("gen.pl", gen_pl(l).map(String::from).unwrap_or(format!("{st}їв")), 0.4, r);
        add!("dat.pl", format!("{st}ям"), 0.5, r);
        add!("acc.pl", format!("{st}ї"), 0.5, r);
        add!("ins.pl", format!("{st}ями"), 0.5, r);
        add!("loc.pl", format!("{st}ях"), 0.5, r);
        add!("voc.pl", format!("{st}ї"), 0.4, r);
        return pp;
    }
    let stem = cut(l, 1);
    let last = last_s(&stem);
    let soft = n.cls == Cls::FS;
    let mixed = n.cls == Cls::FM;
    let dl = if !soft && !mixed && velar(&last).is_some() { format!("{}{}і", cut(&stem, 1), velar(&last).unwrap()) } else { format!("{stem}і") };
    let sm = soft || mixed;
    add!("nom.sg", l.to_string());
    add!("gen.sg", format!("{stem}{}", if sm { "і" } else { "и" }));
    add!("dat.sg", dl.clone());
    add!("acc.sg", format!("{stem}{}", if soft { "ю" } else { "у" }));
    add!("ins.sg", format!("{stem}{}", if sm { "ею" } else { "ою" }));
    add!("loc.sg", dl);
    add!("voc.sg", format!("{stem}{}", if sm { "е" } else { "о" }), 0.6, &["voc"]);
    add!("nom.pl", format!("{stem}{}", if sm { "і" } else { "и" }));
    if let Some(gp) = gen_pl(l) {
        add!("gen.pl", gp.to_string(), 0.95, &["gen-pl-listed"]);
    } else if soft {
        add!("gen.pl", soft_gen(&stem), 0.7, &["gen-pl?"]);
    } else {
        add!("gen.pl", zero_gen(&stem), 0.75, &["gen-pl?"]);
    }
    add!("dat.pl", format!("{stem}{}", if soft { "ям" } else { "ам" }));
    if n.an {
        let copy = pp[cell_idx("gen.pl")].clone();
        pp[cell_idx("acc.pl")].extend(copy);
    } else {
        add!("acc.pl", format!("{stem}{}", if sm { "і" } else { "и" }));
    }
    add!("ins.pl", format!("{stem}{}", if soft { "ями" } else { "ами" }));
    add!("loc.pl", format!("{stem}{}", if soft { "ях" } else { "ах" }));
    add!("voc.pl", format!("{stem}{}", if sm { "і" } else { "и" }), 0.8);
    pp
}

fn noun_paradigm(n: &Noun, dict: Option<&dyn MorphDict>) -> Paradigm {
    let mut pp;
    if n.cls == Cls::Exc {
        let e = exc(&n.lemma).unwrap();
        let l = n.lemma.as_str();
        pp = match e.g {
            Gender::N => neuter(&Noun { cls: if l.ends_with('я') { Cls::NYa } else if l.ends_with('о') { Cls::NH } else { Cls::NS }, ..n.clone() }),
            Gender::F => feminine(&Noun { cls: if l.ends_with('а') { Cls::FH } else if l.ends_with('я') { Cls::FS } else { Cls::F3 }, ..n.clone() }),
            Gender::M => masculine(&Noun { cls: if l.ends_with('ь') { Cls::MS } else { Cls::MH }, ..n.clone() }),
        };
        for (c, f) in &e.forms {
            pp[*c] = f.iter().map(|x| form(x.clone(), 0.98, sv(&["listed"]))).collect();
        }
    } else if n.cls == Cls::Indecl {
        pp = blank();
        for c in 0..NCELLS {
            pp[c] = vec![form(n.lemma.clone(), 0.95, sv(&["indeclinable"]))];
        }
    } else if n.cls.is_m() {
        pp = masculine(n);
    } else if n.cls.is_n() {
        pp = neuter(n);
    } else {
        pp = feminine(n);
    }
    if MASS.contains(n.lemma.as_str()) {
        for c in (1..NCELLS).step_by(2) {
            for f in pp[c].iter_mut() {
                f.p *= 0.3;
                f.flags.push(s("mass-noun"));
            }
        }
    }
    if let Some(lex) = dict.and_then(|d| d.lexeme(&n.lemma)) {
        for c in 0..NCELLS {
            if let Some(f) = lex.get(&c).filter(|f| !f.is_empty()) {
                pp[c] = f.iter().map(|x| form(uk_norm(x), 0.99, sv(&["dictionary"]))).collect();
            }
        }
    }
    pp
}

/* ---------- прикметники ---------- */

#[derive(Clone, Debug)]
struct Adj {
    soft: bool,
    stem: String,
    /// Стоїть у множині й в однині (перед іменником, що має лише множину).
    plural: bool,
    /// < 1, коли слово прийнято за прикметник лише за місцем і закінченням.
    p: Option<f64>,
}
fn parse_adj(lemma: &str) -> Adj {
    Adj { soft: lemma.ends_with("ій"), stem: cut(lemma, 2), plural: false, p: None }
}
fn soft_pl(stem: &str) -> bool {
    ["нижн", "верхн", "давн", "дальн", "пізн", "ранн", "середн", "крайн", "син", "трет"].contains(&stem)
}
fn adj_stem(stem: &str) -> bool {
    ["ев", "єв", "ов", "н", "ськ", "цьк", "зьк", "ичн", "чн", "лив", "ист", "аст", "ян", "ик", "ок", "ш"].iter().any(|e| stem.ends_with(e))
}

/// Закінчення в порядку nom gen dat acc ins loc voc; `=` — знахідний (називний або родовий одушевленого).
fn adj_table(soft: bool, k: &str) -> &'static str {
    match (soft, k) {
        (false, "m") => "ий ого ому = им ому|ім ий",
        (false, "f") => "а ої ій у ою ій а",
        (false, "n") => "е ого ому = им ому|ім е",
        (false, _) => "і их им = ими их і",
        (true, "m") => "ій ього ьому = ім ьому|ім ій",
        (true, "f") => "я ьої ій ю ьою ій я",
        (true, "n") => "є ього ьому = ім ьому|ім є",
        (true, _) => "і іх ім = іми іх і",
    }
}

/// Парадигма прикметника в погодженні з іменником заданого роду й одушевленості.
fn adj_paradigm(a: &Adj, g: Gender, an: bool) -> Paradigm {
    let mut pp = blank();
    let gk = match g { Gender::M => "m", Gender::F => "f", Gender::N => "n" };
    let sg: Vec<&str> = adj_table(a.soft, if a.plural { "p" } else { gk }).split(' ').collect();
    let pl: Vec<&str> = adj_table(a.soft, "p").split(' ').collect();
    for (i, case) in UK_CASES.iter().enumerate() {
        for (num, table) in [("sg", &sg), ("pl", &pl)] {
            let cell = cell_idx(&format!("{case}.{num}"));
            let e = table[i];
            if e == "=" {
                let use_gen = an && ((num == "sg" && g == Gender::M) || num == "pl");
                let from = cell_idx(&format!("{}.{num}", if use_gen { "gen" } else { "nom" }));
                let copy = pp[from].clone();
                pp[cell].extend(copy);
            } else {
                for x in e.split('|') {
                    let guess = a.p.is_some_and(|p| p < 1.0);
                    pp[cell].push(form(format!("{}{x}", a.stem), 0.99 * a.p.unwrap_or(1.0), if guess { sv(&["adj-guess"]) } else { Vec::new() }));
                }
            }
        }
    }
    pp
}

/* ---------- фрази ---------- */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Adj,
    Noun,
    Frozen,
}
#[derive(Clone, Debug)]
struct Word {
    text: String,
    sep: String,
    kind: Kind,
    adj: Option<Adj>,
    noun: Option<Noun>,
    agree: bool,
}
struct Parsed {
    words: Vec<Word>,
    head: Option<usize>,
    flags: Vec<String>,
}

static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([\p{L}\p{N}]+(?:['’ʼ`]\p{L}+)*)([^\p{L}\p{N}]*)").unwrap());

#[derive(Clone, Copy, PartialEq, Eq)]
enum Casing {
    Upper,
    First,
    Lower,
}
fn is_letter(c: char) -> bool {
    c.to_lowercase().collect::<String>() != c.to_uppercase().collect::<String>()
}
fn casing(w: &str) -> Casing {
    let letters: Vec<char> = w.chars().filter(|c| is_letter(*c)).collect();
    let is_up = |c: &char| c.to_uppercase().collect::<String>() == c.to_string();
    if letters.len() > 1 && letters.iter().all(is_up) {
        return Casing::Upper;
    }
    if !letters.is_empty() && is_up(&letters[0]) { Casing::First } else { Casing::Lower }
}
fn cap(x: &str) -> String {
    let mut it = x.chars();
    match it.next() {
        Some(c) => c.to_uppercase().collect::<String>() + it.as_str(),
        None => String::new(),
    }
}

fn tokens(text: &str) -> Vec<(String, String)> {
    TOKEN.captures_iter(text).map(|m| (m[1].to_string(), m.get(2).map_or("", |x| x.as_str()).to_string())).collect()
}

fn parse_phrase(phrase: &str, dict: Option<&dyn MorphDict>) -> Parsed {
    let mut words: Vec<Word> = Vec::new();
    for (text, sep) in tokens(phrase) {
        let low = uk_norm(&text);
        let w = |kind, adj, noun| Word { text: text.clone(), sep: sep.clone(), kind, adj, noun, agree: false };
        if text.chars().any(|c| c.is_ascii_alphanumeric()) || (js_len(&text) > 1 && casing(&text) == Casing::Upper) || FROZEN.contains(low.as_str()) {
            words.push(w(Kind::Frozen, None, None));
        } else if js_len(&low) >= 4 && !NOUN_IJ.contains(low.as_str()) && (low.ends_with("ий") || low.ends_with("ній") || SOFT_ADJ.contains(low.as_str())) {
            words.push(w(Kind::Adj, Some(parse_adj(&low)), None));
        } else {
            words.push(w(Kind::Noun, None, Some(parse_noun(&low, dict))));
        }
    }
    // залізна вежа, велике місто: прикметник у погодженні з іменником закінчується на -а/-я або -е/-є, а іменник за ним має цей рід
    for i in 0..words.len().saturating_sub(1) {
        if words[i].kind != Kind::Noun || words[i + 1].kind != Kind::Noun || !crate::js::trim(&words[i].sep).is_empty() {
            continue;
        }
        let low = uk_norm(&words[i].text);
        let last = last_ch(&low);
        let stem = cut(&low, 1);
        let nx = words[i + 1].noun.as_ref().unwrap();
        let ng = nx.g;
        let agrees = (matches!(last, Some('а') | Some('я')) && ng == Gender::F) || (matches!(last, Some('е') | Some('є')) && ng == Gender::N);
        // залізні двері, чорні ворота: прикметник множини перед іменником, що має лише множину
        let plural = !agrees && last == Some('і') && nx.plural;
        let ok_stem = js_len(&stem) >= 3 && is_cons(last_ch(&stem));
        if agrees && ok_stem {
            let w = &mut words[i];
            w.kind = Kind::Adj;
            w.noun = None;
            w.adj = Some(Adj { soft: matches!(last, Some('я') | Some('є')), stem: stem.clone(), plural: false, p: Some(if adj_stem(&stem) { 1.0 } else { 0.9 }) });
        } else if plural && ok_stem {
            let w = &mut words[i];
            w.kind = Kind::Adj;
            w.noun = None;
            w.adj = Some(Adj { soft: soft_pl(&stem), stem: stem.clone(), plural: true, p: Some(1.0) });
        }
    }
    let mut flags: Vec<String> = Vec::new();
    let mut head = words.iter().position(|w| w.kind == Kind::Noun).or_else(|| words.iter().position(|w| w.kind == Kind::Adj));
    for (i, w) in words.iter_mut().enumerate() {
        if (w.kind == Kind::Adj && head.is_some_and(|h| i < h)) || Some(i) == head {
            w.agree = true;
        }
    }
    // дефіс між двома іменниками робить одне слово, що відмінюється обома частинами (меч-кладенець)
    if let Some(h) = head {
        for i in h + 1..words.len() {
            let (pk, pa, ps) = (words[i - 1].kind, words[i - 1].agree, crate::js::trim(&words[i - 1].sep).to_string());
            if words[i].kind == Kind::Noun && pa && pk == Kind::Noun && ps == "-" {
                words[i].agree = true;
                flags.push(s("compound"));
            }
        }
    }
    // перша частина на кшталт жар-, напів- лишається як є
    if let Some(h) = head {
        if words[h].kind == Kind::Noun && COMB.contains(uk_norm(&words[h].text).as_str()) && crate::js::trim(&words[h].sep) == "-" && words.get(h + 1).is_some_and(|w| w.kind == Kind::Noun) {
            words[h].agree = false;
            words[h].kind = Kind::Frozen;
            words[h + 1].agree = true;
            head = Some(h + 1);
            flags.push(s("prefix-compound"));
        }
    }
    Parsed { words, head, flags }
}

fn js_len(x: &str) -> usize {
    crate::js::len16(x)
}

/// Парадигма кожного слова, що відмінюється; прикметники беруть рід і одушевленість головного іменника.
fn word_paradigms(ph: &Parsed, dict: Option<&dyn MorphDict>) -> Vec<Option<Paradigm>> {
    let h = ph.head.and_then(|h| ph.words[h].noun.as_ref());
    ph.words
        .iter()
        .map(|w| {
            if !w.agree {
                None
            } else if w.kind == Kind::Noun {
                Some(noun_paradigm(w.noun.as_ref().unwrap(), dict))
            } else {
                Some(adj_paradigm(w.adj.as_ref().unwrap(), h.map_or(Gender::M, |h| h.g), h.is_some_and(|h| h.an)))
            }
        })
        .collect()
}

fn case_prior(c: &str) -> f64 {
    match c { "nom" => 1.0, "acc" => 0.95, "gen" => 0.95, "dat" => 0.9, "ins" => 0.95, "loc" => 0.9, _ => 0.25 }
}
fn cell_prior(c: Cell) -> f64 {
    case_prior(cell_case(c)) * if c % 2 == 1 { 0.85 } else { 1.0 }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Alt {
    pub text: String,
    pub conf: Conf,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Retarget {
    /// Новий термін у відмінку й числі спостережуваного тексту.
    pub text: String,
    pub conf: Conf,
    /// Клітинки, якими може бути спостережуваний текст.
    pub cells: Vec<String>,
    /// Інші результати: форма підходить до кількох клітинок, що дають різні нові форми.
    pub alts: Vec<Alt>,
    pub ambiguous: bool,
}

/// Форми всієї фрази в кожній клітинці (варіанти за перевагою); None для фрази без іменника й прикметника.
pub fn uk_forms(phrase: &str, dict: Option<&dyn MorphDict>) -> Option<Vec<Vec<String>>> {
    let ph = parse_phrase(phrase, dict);
    ph.head?;
    let pars = word_paradigms(&ph, dict);
    let mut out: Vec<Vec<String>> = vec![Vec::new(); NCELLS];
    for c in 0..NCELLS {
        let n = pars.iter().map(|p| p.as_ref().map_or(1, |p| p[c].len())).max().unwrap_or(1).max(1);
        for v in 0..n {
            let mut t = String::new();
            for (i, w) in ph.words.iter().enumerate() {
                let f = pars[i].as_ref().map(|p| &p[c]).filter(|f| !f.is_empty());
                t += &match f {
                    Some(f) => f.get(v).unwrap_or(&f[0]).form.clone(),
                    None => w.text.clone(),
                };
                t += &w.sep;
            }
            out[c].push(crate::js::trim(&t).to_string());
        }
    }
    Some(out)
}

/// Усі форми, які може мати слово фрази, по набору на слово, малими літерами з одним видом апострофа.
pub fn uk_word_forms(phrase: &str, dict: Option<&dyn MorphDict>) -> Option<Vec<HashSet<String>>> {
    let ph = parse_phrase(phrase, dict);
    ph.head?;
    let pars = word_paradigms(&ph, dict);
    Some(
        ph.words
            .iter()
            .zip(pars)
            .map(|(w, par)| {
                let mut set = HashSet::new();
                match par {
                    None => {
                        set.insert(uk_norm(&w.text));
                    }
                    Some(par) => par.iter().flatten().for_each(|f| {
                        set.insert(f.form.clone());
                    }),
                }
                set
            })
            .collect(),
    )
}

#[derive(Default)]
pub struct RetargetOpts<'a> {
    pub prev: Option<&'a str>,
    pub dict: Option<&'a dyn MorphDict>,
}

struct Built {
    text: String,
    p: f64,
    fl: Vec<String>,
}

/// Новий термін у тому ж відмінку й числі, в якому старий стоїть у `observed`. None, коли `observed` — не форма старого терміна
/// або слів не стільки, скільки в старому терміні.
pub fn uk_retarget(old_phrase: &str, new_phrase: &str, observed: &str, opts: &RetargetOpts) -> Option<Retarget> {
    let dict = opts.dict;
    let old_p = parse_phrase(old_phrase, dict);
    let new_p = parse_phrase(new_phrase, dict);
    let obs = tokens(observed);
    if old_p.words.is_empty() || new_p.words.is_empty() || obs.len() != old_p.words.len() || old_p.head.is_none() || new_p.head.is_none() {
        return None;
    }
    let old_pars = word_paradigms(&old_p, dict);
    let mut cells: Vec<Cell> = (0..NCELLS).collect();
    let mut flags: Vec<String> = Vec::new();
    let mut cap_score = 1.0;
    let mut variant: HashMap<Cell, usize> = HashMap::new();
    for (i, w) in old_p.words.iter().enumerate() {
        let o = uk_norm(&obs[i].0);
        let Some(par) = &old_pars[i] else {
            if uk_norm(&w.text) != o {
                cap_score = 0.5;
                flags.push(s("frozen-differs"));
            }
            continue;
        };
        cells.retain(|&c| {
            let vi = par[c].iter().position(|f| f.form == o);
            if let Some(vi) = vi {
                variant.entry(c).or_insert(vi);
            }
            vi.is_some()
        });
        if cells.is_empty() {
            return None;
        }
    }
    // Чоловіче ім'я, якого немає в списках, може бути одушевленим: «Остапа» після «бачив» — знахідний, після «біля» — родовий.
    // Обидва прочитання лишаються (і рядок не відмічається).
    let oh0 = old_p.words[old_p.head.unwrap()].noun.as_ref();
    if oh0.is_some_and(|n| n.g == Gender::M && n.flags.iter().any(|f| f == "animacy-guess")) && {
        let t = &old_p.words[old_p.head.unwrap()].text;
        let mut it = t.chars();
        it.next().is_some_and(|c| c.is_uppercase()) && it.next().is_some_and(|c| c.is_lowercase())
    } {
        let (gs, as_, gp, ap) = (cell_idx("gen.sg"), cell_idx("acc.sg"), cell_idx("gen.pl"), cell_idx("acc.pl"));
        if cells.contains(&gs) && !cells.contains(&as_) {
            cells.push(as_);
        }
        if cells.contains(&gp) && !cells.contains(&ap) {
            cells.push(ap);
        }
    }
    let need = opts.prev.filter(|p| !p.is_empty()).and_then(|p| prep(&uk_norm(p)));
    // давальний-місцевий стоїть лише після прийменника: без нього він лишається варіантом, але звичайний відмінок іде першим
    let mut prior: Box<dyn Fn(Cell) -> f64> = if need.is_some() { Box::new(cell_prior) } else { Box::new(|c| cell_prior(c) * if cell_case(c) == "loc" { 0.78 } else { 1.0 }) };
    if let Some(need) = need {
        if cells.iter().any(|&c| need.contains(&cell_case(c))) {
            cells.retain(|&c| need.contains(&cell_case(c)));
        }
        let first = need[0];
        prior = Box::new(move |c| cell_prior(c) * if cell_case(c) == first { 1.0 } else { 0.5 });
    }
    let new_pars = word_paradigms(&new_p, dict);
    // інший рід чи число головного слова: слова навколо (дієслово, прикметник поза терміном) більше не погоджуються
    let oh = old_p.words[old_p.head.unwrap()].noun.as_ref();
    let nh = new_p.words[new_p.head.unwrap()].noun.as_ref();
    if let (Some(oh), Some(nh)) = (oh, nh) {
        if oh.g != nh.g || oh.plural != nh.plural {
            flags.push(s("gender-change"));
        }
    }
    // номер варіанта старої форми належить старому слову: переноситься лише на слово тієї самої відміни
    let same_class = matches!((oh, nh), (Some(a), Some(b)) if a.cls == b.cls);
    let seen0 = casing(&obs[0].0);
    let same_count = new_p.words.len() == obs.len();
    let obs_case: Vec<Casing> = obs.iter().map(|o| casing(&o.0)).collect();
    let seps: Vec<String> = if same_count { obs.iter().map(|o| o.1.clone()).collect() } else { new_p.words.iter().map(|w| w.sep.clone()).collect() };
    let typed = new_phrase.chars().find(|c| matches!(c, '\'' | 'ʼ' | '`' | '’'));
    let build = |cell: Cell| -> Option<Built> {
        let mut p = cap_score;
        let mut text = String::new();
        let mut fl = flags.clone();
        let k = if same_class { variant.get(&cell).copied().unwrap_or(0) } else { 0 };
        for (i, w) in new_p.words.iter().enumerate() {
            let par = &new_pars[i];
            let mut f_text = w.text.clone();
            if let Some(par) = par {
                let forms = &par[cell];
                if forms.is_empty() {
                    return None;
                }
                let f = &forms[k.min(forms.len() - 1)];
                f_text = f.form.clone();
                p *= f.p;
                fl.extend(f.flags.iter().cloned());
            }
            // регістр літер іде за текстом, що замінюється (мечем → клинком, Мечем → Клинком, МЕЧЕМ → КЛИНКОМ)
            let use_c = if seen0 == Casing::Upper { Casing::Upper } else if same_count { obs_case[i] } else if i == 0 { seen0 } else { casing(&w.text) };
            text += &match use_c {
                Casing::Upper => f_text.to_uppercase(),
                Casing::First => cap(&f_text),
                Casing::Lower => if par.is_some() { f_text } else { w.text.clone() },
            };
            if i < new_p.words.len() - 1 {
                text += &seps[i];
            }
        }
        if old_p.flags.iter().any(|f| f == "compound") || new_p.flags.iter().any(|f| f == "compound") {
            p *= 0.9;
            fl.push(s("compound"));
        }
        Some(Built { text: match typed { Some(t) => text.replace('’', &t.to_string()), None => text }, p, fl })
    };
    let mut results: Vec<(Cell, Built, f64)> = Vec::new();
    for &c in &cells {
        if let Some(r) = build(c) {
            results.push((c, r, prior(c)));
        }
    }
    results.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    let best = results.first()?;
    let (best_text, best_pr) = (best.1.text.clone(), best.2);
    let others: Vec<&(Cell, Built, f64)> = results.iter().filter(|x| x.1.text != best_text).collect();
    let ambiguous = others.iter().any(|x| x.2 >= 0.7 * best_pr);
    let conf = |p: f64, fl: &[String], amb: bool| -> Conf {
        let sc = (p * if amb { 0.6 } else { 1.0 } * 1000.0).round() / 1000.0;
        let mut all: Vec<String> = Vec::new();
        for f in fl.iter().cloned().chain(if amb { Some(s("ambiguous-case")) } else { None }) {
            if !all.contains(&f) {
                all.push(f);
            }
        }
        Conf { score: sc, level: level_of(sc), flags: all }
    };
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(best_text.clone());
    // кличний та інші малоймовірні клітинки не пропонуються як варіант
    let mut alts = Vec::new();
    for x in &others {
        if x.2 >= 0.35 * best_pr && seen.insert(x.1.text.clone()) {
            alts.push(Alt { text: x.1.text.clone(), conf: conf(x.1.p, &x.1.fl, false) });
        }
    }
    Some(Retarget { text: best_text, conf: conf(best.1.p, &best.1.fl, ambiguous), cells: results.iter().map(|x| cell_name(x.0)).collect(), alts, ambiguous })
}
