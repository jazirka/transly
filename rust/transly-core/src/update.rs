//! `update.ts`: яка це збірка застосунку і як зрозуміти, що випуск новіший. Чиста логіка: мережа — справа інтерфейсу.

use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Android,
    Windows,
    Mac,
    Linux,
}

impl Platform {
    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Android => "android",
            Platform::Windows => "windows",
            Platform::Mac => "mac",
            Platform::Linux => "linux",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReleaseAsset {
    pub name: String,
    pub url: String,
    pub size: f64,
    pub digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReleaseInfo {
    pub sha: String,
    pub published: String,
    pub assets: Vec<ReleaseAsset>,
}

/// Тег випуску, під яким опубліковано інсталятори кожної платформи (див. робочі процеси CI).
pub fn release_tag(p: Platform) -> &'static str {
    match p {
        Platform::Android => "android-latest",
        _ => "desktop-latest",
    }
}

/// Платформа цієї збірки: застосунок Android чи настільний застосунок на цій ОС; None у браузері.
pub fn platform_of(is_android_app: bool, is_desktop_app: bool, user_agent: &str) -> Option<Platform> {
    if is_android_app {
        return Some(Platform::Android);
    }
    if !is_desktop_app {
        return None;
    }
    let ua = user_agent.to_lowercase();
    Some(if ua.contains("windows") {
        Platform::Windows
    } else if ua.contains("mac") {
        Platform::Mac
    } else {
        Platform::Linux
    })
}

/// `Number(v) || 0` для розміру (від'ємні й дробові лишаються як є, NaN і 0 стають 0).
fn js_number(v: Option<&Value>) -> f64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => {
            let t = crate::js::trim(s);
            if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) }
        }
        Some(Value::Bool(true)) => 1.0,
        _ => 0.0,
    };
    if n.is_finite() { n } else { 0.0 }
}

/// JSON випуску GitHub → те, що потрібне перевірці оновлень.
pub fn parse_release(json: &Value) -> Option<ReleaseInfo> {
    let sha = json.get("target_commitish")?.as_str()?.to_string();
    let assets = json
        .get("assets")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|x| x.get("name").is_some_and(Value::is_string) && x.get("url").is_some_and(Value::is_string))
                .map(|x| ReleaseAsset {
                    name: x["name"].as_str().unwrap().to_string(),
                    url: x["url"].as_str().unwrap().to_string(),
                    size: js_number(x.get("size")),
                    digest: x.get("digest").and_then(Value::as_str).map(String::from),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(ReleaseInfo { sha, published: json.get("published_at").and_then(Value::as_str).unwrap_or("").to_string(), assets })
}

/// Інсталятор для цієї платформи.
pub fn pick_asset(platform: Platform, assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    let by = |f: &dyn Fn(&str) -> bool| assets.iter().find(|a| f(&a.name.to_lowercase()));
    match platform {
        Platform::Android => by(&|n| n.ends_with(".apk")),
        Platform::Windows => by(&|n| n.ends_with(".exe")).or_else(|| by(&|n| n.ends_with(".msi"))),
        Platform::Mac => by(&|n| n.ends_with(".dmg")),
        Platform::Linux => by(&|n| n.ends_with(".appimage")).or_else(|| by(&|n| n.ends_with(".deb"))),
    }
}

/// `Date.parse` для ISO 8601 (`2026-11-24T10:00:00Z`) у мілісекунди; None, коли не розібрано.
fn parse_time(s: &str) -> Option<f64> {
    let s = s.trim();
    let (date, rest) = s.split_once('T').unwrap_or((s, ""));
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next().map_or(Some(1), |x| x.parse().ok())?;
    let d: i64 = it.next().map_or(Some(1), |x| x.parse().ok())?;
    if it.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let (mut hh, mut mm, mut ss, mut ms, mut off) = (0i64, 0i64, 0i64, 0i64, 0i64);
    if !rest.is_empty() {
        let (clock, zone) = match rest.find(['Z', 'z', '+', '-']) {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let mut c = clock.split(':');
        hh = c.next()?.parse().ok()?;
        mm = c.next().map_or(Some(0), |x| x.parse().ok())?;
        if let Some(sec) = c.next() {
            let (whole, frac) = sec.split_once('.').unwrap_or((sec, ""));
            ss = whole.parse().ok()?;
            if !frac.is_empty() {
                let f = format!("{frac:0<3}");
                ms = f[..3].parse().ok()?;
            }
        }
        if let Some(sign) = zone.chars().next().filter(|c| *c == '+' || *c == '-') {
            let z = zone[1..].replace(':', "");
            if z.len() != 4 {
                return None;
            }
            let (zh, zm): (i64, i64) = (z[..2].parse().ok()?, z[2..].parse().ok()?);
            off = (zh * 60 + zm) * if sign == '+' { 1 } else { -1 };
        }
    }
    // дні від 1970-01-01
    let (yy, m3) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * m3 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((((days * 24 + hh) * 60 + mm - off) * 60 + ss) as f64 * 1000.0 + ms as f64)
}

/// Випуск новіший, коли зібраний з іншого коміта І опублікований після того, як зроблено цю збірку (повторний запуск старої збірки
/// не повинен пропонувати зниження). Локальна («dev») збірка ніколи не питає. Час необов'язковий: без нього порівнюється лише коміт.
pub fn update_available(build_id: &str, release_sha: &str, release_published: &str, built_at: &str) -> bool {
    if build_id == "dev" || release_sha.is_empty() || release_sha.starts_with(build_id) || build_id.starts_with(release_sha) {
        return false;
    }
    match (parse_time(release_published), parse_time(built_at)) {
        (Some(rel), Some(mine)) => rel > mine,
        _ => true,
    }
}

/// Два id однієї збірки: повний коміт і його коротка форма — та сама збірка; локальна («dev») нічия.
pub fn same_build(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && a != "dev" && b != "dev" && (a.starts_with(b) || b.starts_with(a))
}
