//! `theme.ts`: колір акценту проєкту: один відтінок, узятий з назви проєкту (щоб проєкти відрізнялись один від одного) або обраний вручну;
//! усі похідні кольори виводяться з нього. Звичайні sRGB, не `oklch()`.
//!
//! Ролі: `--accent` лінії й фокус, `--accent-solid` одна головна дія з `--on-accent` на ній, `--use` + `--use-ring` те, що обрано у вікні,
//! де працюють; `--accent-soft` + `--accent-ring` + `--accent-text` відтінки й позначки; `--focus-glow` кільце клавіатури.
//! Кольори станів (чернетка, надіслано, вичитано, помилка) — не частина теми.

use indexmap::IndexMap;
use serde_json::Value;

/// Створений відтінок лишається серед холодних: червоний, жовтий і зелений належать станам і помилкам. Обраний вручну може бути будь-яким.
pub const HUE_FROM: u32 = 170;
pub const HUE_SPAN: u32 = 166;

fn hash(s: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for c in crate::js::trim(s).to_lowercase().chars() {
        h ^= c as u32;
        h = h.wrapping_mul(16_777_619);
    }
    h
}

/// Відтінок, який дає назва (градуси, HUE_FROM … HUE_FROM + HUE_SPAN - 1). Та сама назва завжди дає той самий відтінок.
pub fn hue_of_name(name: &str) -> u32 {
    HUE_FROM + hash(name) % HUE_SPAN
}

/// Відтінок у вжитку: обраний вручну, коли проєкт його має, інакше з назви.
pub fn theme_hue(name: &str, chosen: Option<&Value>) -> u32 {
    match chosen.and_then(Value::as_f64).filter(|v| v.is_finite() && *v >= 0.0 && *v < 360.0) {
        Some(v) => (v + 0.5).floor() as u32,
        None => hue_of_name(name),
    }
}

// OKLCH → sRGB (матриці Бйорна Оттоссона), насиченість знижується, поки колір не вміститься в sRGB.
fn lin2srgb(c: f64) -> f64 {
    if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

fn to_linear(l_: f64, c: f64, h_deg: f64) -> [f64; 3] {
    let h = h_deg * std::f64::consts::PI / 180.0;
    let (a, b) = (c * h.cos(), c * h.sin());
    let l = (l_ + 0.3963377774 * a + 0.2158037573 * b).powf(3.0);
    let m = (l_ - 0.1055613458 * a - 0.0638541728 * b).powf(3.0);
    let s = (l_ - 0.0894841775 * a - 1.291485548 * b).powf(3.0);
    [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
}

fn fits(v: &[f64; 3]) -> bool {
    v.iter().all(|c| *c >= -0.0005 && *c <= 1.0005)
}

pub fn oklch_rgb(l: f64, c: f64, h_deg: f64) -> [u8; 3] {
    let (mut lo, mut hi) = (0.0, c);
    let mut rgb = to_linear(l, c, h_deg);
    if !fits(&rgb) {
        for _ in 0..24 {
            let mid = (lo + hi) / 2.0;
            if fits(&to_linear(l, mid, h_deg)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        rgb = to_linear(l, lo, h_deg);
    }
    // Math.round: половина вгору
    rgb.map(|c| (lin2srgb(c.clamp(0.0, 1.0)).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8)
}

fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

fn rgba(c: [u8; 3], a: f64) -> String {
    format!("rgba({},{},{},{})", c[0], c[1], c[2], a)
}

/// Контраст WCAG двох кольорів `#rrggbb`.
pub fn contrast_of(a: &str, b: &str) -> f64 {
    let lum = |h: &str| -> f64 {
        let v: Vec<f64> = [1, 3, 5]
            .iter()
            .map(|i| u8::from_str_radix(&h[*i..*i + 2], 16).unwrap_or(0) as f64 / 255.0)
            .map(|c| if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) })
            .collect();
        0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    };
    let (la, lb) = (lum(a), lum(b));
    let (x, y) = if la >= lb { (la, lb) } else { (lb, la) };
    (x + 0.05) / (y + 0.05)
}

/// Заповнена головна дія: так яскрава, як дозволяє текст на ній (білому потрібно 4,5:1).
fn solid_of(hue: f64) -> [u8; 3] {
    let mut l = 0.56;
    while l > 0.3 {
        let rgb = oklch_rgb(l, 0.17, hue);
        if contrast_of(&hex(rgb), "#ffffff") >= 4.5 {
            return rgb;
        }
        l -= 0.01;
    }
    oklch_rgb(0.3, 0.17, hue)
}

/// Кожна змінна CSS теми для одного відтінку (в порядку оголошення).
pub fn theme_tokens(hue: u32) -> IndexMap<String, String> {
    let h = hue as f64;
    let line = oklch_rgb(0.72, 0.15, h);
    let solid = solid_of(h);
    let text = oklch_rgb(0.84, 0.1, h);
    let mut m = IndexMap::new();
    let mut put = |k: &str, v: String| {
        m.insert(k.to_string(), v);
    };
    put("--accent", hex(line));
    put("--accent-2", hex(line));
    put("--accent-rgb", format!("{},{},{}", line[0], line[1], line[2]));
    put("--accent-solid", hex(solid));
    put("--accent-hi", hex(oklch_rgb(0.62, 0.17, h)));
    put("--on-accent", "#ffffff".into());
    put("--accent-soft", rgba(line, 0.16));
    put("--accent-ring", rgba(line, 0.5));
    put("--use", rgba(line, 0.3));
    put("--use-ring", rgba(line, 0.7));
    put("--accent-text", hex(text));
    put("--focus-glow", rgba(line, 0.24));
    m
}
