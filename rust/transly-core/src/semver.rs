//! `ext/semver.ts`: невеликий набір для версій: досить, щоб порівнювати версії плагінів і API, без залежностей.

use regex::Regex;
use std::cmp::Ordering;
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre: String,
}

static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?([0-9]{1,9})(?:\.([0-9]{1,9}))?(?:\.([0-9]{1,9}))?(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$").unwrap());

/// Розбирає `1`, `1.2`, `1.2.3`, `1.2.3-beta.1` (початкове `v` і `+build` терпляться). None, коли це не версія.
pub fn parse_version(s: &str) -> Option<Version> {
    let m = VERSION.captures(crate::js::trim(s))?;
    let n = |i: usize| m.get(i).map_or(0, |g| g.as_str().parse().unwrap_or(0));
    Some(Version { major: n(1), minor: n(2), patch: n(3), pre: m.get(4).map_or(String::new(), |g| g.as_str().to_string()) })
}

fn is_num(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn cmp_pre(a: &str, b: &str) -> i32 {
    if a == b {
        return 0;
    }
    if a.is_empty() {
        return 1; // випуск новіший за власні пререлізи
    }
    if b.is_empty() {
        return -1;
    }
    let (x, y): (Vec<&str>, Vec<&str>) = (a.split('.').collect(), b.split('.').collect());
    for i in 0..x.len().max(y.len()) {
        let (Some(p), Some(q)) = (x.get(i), y.get(i)) else { return if x.get(i).is_none() { -1 } else { 1 } };
        let (pn, qn) = (is_num(p), is_num(q));
        if pn && qn {
            let (pv, qv): (f64, f64) = (p.parse().unwrap_or(0.0), q.parse().unwrap_or(0.0));
            if pv != qv {
                return if pv < qv { -1 } else { 1 };
            }
        } else if pn != qn {
            return if pn { -1 } else { 1 };
        } else if p != q {
            return if crate::js::cmp(p, q) == Ordering::Less { -1 } else { 1 };
        }
    }
    0
}

/// -1, 0 чи 1. Нерозбірні версії йдуть перед кожною справжньою.
pub fn compare_versions(a: &str, b: &str) -> i32 {
    let (x, y) = (parse_version(a), parse_version(b));
    let (Some(x), Some(y)) = (x, y) else { return if parse_version(a).is_some() { 1 } else if parse_version(b).is_some() { -1 } else { 0 } };
    for (p, q) in [(x.major, y.major), (x.minor, y.minor), (x.patch, y.patch)] {
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    cmp_pre(&x.pre, &y.pre)
}

fn upper(v: &Version, op: &str) -> Version {
    let mk = |major, minor, patch| Version { major, minor, patch, pre: String::new() };
    if op == "~" {
        mk(v.major, v.minor + 1, 0)
    } else if v.major > 0 {
        mk(v.major + 1, 0, 0)
    } else if v.minor > 0 {
        mk(0, v.minor + 1, 0)
    } else {
        mk(0, 0, v.patch + 1)
    }
}
fn text(v: &Version) -> String {
    format!("{}.{}.{}{}", v.major, v.minor, v.patch, if v.pre.is_empty() { String::new() } else { format!("-{}", v.pre) })
}

enum Cmp {
    Any,
    Wild { major: u64, minor: Option<u64> },
    Range { lo: String, hi: String },
    Ge(String),
    Gt(String),
    Le(String),
    Lt(String),
    Eq(String),
}

static OP_BODY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(>=|<=|>|<|=|\^|~)?\s*(.+)$").unwrap());
static WILD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?([0-9]+)(?:\.([0-9]+|[xX*]))?(?:\.([xX*]))?$").unwrap());
static OP_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(>=|<=|>|<|=|\^|~)$").unwrap());

/// Один порівняльник діапазону: `>=1.2.0`, `<2`, `=1.0.0`, `^1.2`, `~1.2.3`, `1.x`, `*`. None, коли не прочитати.
fn comparator(raw: &str) -> Option<Cmp> {
    let t = crate::js::trim(raw);
    if matches!(t, "" | "*" | "x" | "X") {
        return Some(Cmp::Any);
    }
    let m = OP_BODY.captures(t)?;
    let op = m.get(1).map_or("", |g| g.as_str());
    let body = &m[2];
    if let Some(w) = WILD.captures(body) {
        let w2 = w.get(2).map(|g| g.as_str());
        if op.is_empty() && (w2.is_none() || w2.is_some_and(|s| s.chars().any(|c| matches!(c, 'x' | 'X' | '*'))) || w.get(3).is_some()) {
            let major = w[1].parse().unwrap_or(0);
            let minor = w2.filter(|s| is_num(s)).map(|s| s.parse().unwrap_or(0));
            return Some(Cmp::Wild { major, minor });
        }
    }
    let base = parse_version(body)?;
    let lo = text(&base);
    Some(match op {
        "^" | "~" => Cmp::Range { hi: text(&upper(&base, op)), lo },
        ">=" => Cmp::Ge(lo),
        ">" => Cmp::Gt(lo),
        "<=" => Cmp::Le(lo),
        "<" => Cmp::Lt(lo),
        _ => Cmp::Eq(lo),
    })
}

fn holds(c: &Cmp, v: &str) -> bool {
    match c {
        Cmp::Any => true,
        Cmp::Wild { major, minor } => parse_version(v).is_some_and(|p| p.major == *major && minor.is_none_or(|m| p.minor == m)),
        Cmp::Range { lo, hi } => compare_versions(v, lo) >= 0 && compare_versions(v, hi) < 0,
        Cmp::Ge(lo) => compare_versions(v, lo) >= 0,
        Cmp::Gt(lo) => compare_versions(v, lo) > 0,
        Cmp::Le(lo) => compare_versions(v, lo) <= 0,
        Cmp::Lt(lo) => compare_versions(v, lo) < 0,
        Cmp::Eq(lo) => compare_versions(v, lo) == 0,
    }
}

fn tokens(alt: &str) -> Vec<&str> {
    crate::js::trim(alt).split(crate::js::is_space).filter(|s| !s.is_empty()).collect()
}

/// Чи діапазон записано у формі, яку розуміє `satisfies`.
pub fn valid_range(range: &str) -> bool {
    crate::js::trim(range).split("||").all(|alt| {
        let a = tokens(alt);
        a.iter().enumerate().all(|(i, c)| if OP_ONLY.is_match(c) { i + 1 < a.len() } else { comparator(c).is_some() }) || crate::js::trim(alt).is_empty()
    })
}

/// Чи `version` у `range`: порівняльники через пробіл — «усі», `||` — «або». Пререліз задовольняє діапазон, лише коли діапазон сам називає пререліз (як у npm).
pub fn satisfies(version: &str, range: &str) -> bool {
    let Some(v) = parse_version(version) else { return false };
    range.split("||").any(|alt| {
        let toks = tokens(alt);
        let mut parts: Vec<String> = Vec::new();
        let mut i = 0;
        while i < toks.len() {
            let t = toks[i];
            if OP_ONLY.is_match(t) && i + 1 < toks.len() {
                parts.push(format!("{t}{}", toks[i + 1]));
                i += 2;
            } else {
                parts.push(t.to_string());
                i += 1;
            }
        }
        if parts.is_empty() {
            parts.push("*".into());
        }
        let fns: Vec<Option<Cmp>> = parts.iter().map(|p| comparator(p)).collect();
        if fns.iter().any(|f| f.is_none()) {
            return false;
        }
        if !v.pre.is_empty() && !parts.iter().any(|p| p.contains('-')) {
            return false;
        }
        fns.iter().all(|f| holds(f.as_ref().unwrap(), version))
    })
}
