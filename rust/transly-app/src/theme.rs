//! Кольори й розміри старого інтерфейсу (`app/src/ui/theme.css`, `mockup/workspace.html`), перенесені як є.

#![allow(dead_code)] // палітра повна: частину кольорів використають наступні екрани

use eframe::egui::{self, Color32, CornerRadius, FontFamily, FontId, Stroke, TextStyle};

pub const BG: Color32 = Color32::from_rgb(0x1e, 0x1f, 0x22);
pub const PANEL: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x30);
pub const PANEL2: Color32 = Color32::from_rgb(0x26, 0x28, 0x2b);
pub const LINE: Color32 = Color32::from_rgb(0x39, 0x3b, 0x40);
pub const LINE_SOFT: Color32 = Color32::from_rgb(0x2a, 0x2c, 0x30);
pub const TEXT: Color32 = Color32::from_rgb(0xdf, 0xe1, 0xe5);
pub const SRC_TEXT: Color32 = Color32::from_rgb(0xc8, 0xcc, 0xd3);
pub const MUTE: Color32 = Color32::from_rgb(0xa9, 0xae, 0xb6);
pub const DIM: Color32 = Color32::from_rgb(0x8f, 0x95, 0x9d);
pub const OK: Color32 = Color32::from_rgb(0x5f, 0xb8, 0x65);
pub const WARN: Color32 = Color32::from_rgb(0xe5, 0xa0, 0x4b);
pub const BAD: Color32 = Color32::from_rgb(0xf7, 0x54, 0x64);
pub const INFO: Color32 = Color32::from_rgb(0x56, 0xa8, 0xf5);
pub const VIOLET: Color32 = Color32::from_rgb(0xb5, 0x89, 0xd6);
pub const BTN: Color32 = Color32::from_rgb(0x34, 0x36, 0x3a);
pub const BTN_HOVER: Color32 = Color32::from_rgb(0x3d, 0x40, 0x46);
pub const GHOST_HOVER: Color32 = Color32::from_rgb(0x39, 0x3b, 0x40);
pub const ZEBRA: Color32 = Color32::from_rgb(0x20, 0x22, 0x25);
pub const ROW_HOVER: Color32 = Color32::from_rgb(0x26, 0x28, 0x2c);
pub const TRACK: Color32 = Color32::from_rgb(0x3d, 0x40, 0x45);
pub const FILTERS_BG: Color32 = Color32::from_rgb(0x22, 0x24, 0x27);
pub const TREE_HOVER: Color32 = Color32::from_rgb(0x34, 0x36, 0x3a);
pub const INPUT_BG: Color32 = Color32::from_rgb(0x17, 0x18, 0x1a);

/// Колір акценту береться з теми проєкту (відтінок від назви гри, `transly_core::theme`): як у старому застосунку.
#[derive(Clone, Copy)]
struct Palette {
    accent: Color32,
    solid: Color32,
    hi: Color32,
    text: Color32,
    ring: Color32,
    chip: Color32,
    sel: Color32,
    hue: u32,
}

fn hex_color(s: &str) -> Color32 {
    let v = u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0x8b72e8);
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

fn over(base: Color32, top: Color32, a: f32) -> Color32 {
    let m = |b: u8, t: u8| (b as f32 * (1.0 - a) + t as f32 * a).round() as u8;
    Color32::from_rgb(m(base.r(), top.r()), m(base.g(), top.g()), m(base.b(), top.b()))
}

fn palette_of(hue: u32) -> Palette {
    let tk = transly_core::theme::theme_tokens(hue);
    let g = |k: &str| hex_color(tk.get(k).map_or("#8b72e8", |s| s.as_str()));
    let accent = g("--accent");
    Palette { accent, solid: g("--accent-solid"), hi: g("--accent-hi"), text: g("--accent-text"), ring: over(BG, accent, 0.5), chip: over(BG, accent, 0.16), sel: over(BG, accent, 0.30), hue }
}

static PAL: std::sync::RwLock<Option<Palette>> = std::sync::RwLock::new(None);

fn pal() -> Palette {
    if let Some(p) = *PAL.read().unwrap() {
        return p;
    }
    let p = palette_of(transly_core::theme::theme_hue("Transly", None));
    *PAL.write().unwrap() = Some(p);
    p
}

/// Відтінок теми проєкту; повертає true, коли він змінився (тоді стиль треба застосувати знову).
pub fn set_hue(hue: u32) -> bool {
    if pal().hue == hue {
        return false;
    }
    *PAL.write().unwrap() = Some(palette_of(hue));
    true
}

pub fn accent() -> Color32 {
    pal().accent
}
/// Заповнена головна дія (кнопка «Надіслати»): така яскрава, як дозволяє білий текст на ній.
pub fn accent_solid() -> Color32 {
    pal().solid
}
pub fn accent_hover() -> Color32 {
    pal().hi
}
pub fn accent_text() -> Color32 {
    pal().text
}
pub fn accent_ring() -> Color32 {
    pal().ring
}
pub fn chip_on() -> Color32 {
    pal().chip
}
/// Вибраний рядок у вікні, де працюєш (відтінок теми).
pub fn sel_use() -> Color32 {
    pal().sel
}
/// Вибраний рядок у вікні, де зараз не працюєш: нейтральний сірий.
pub fn sel_soft() -> Color32 {
    over(BG, Color32::WHITE, 0.15)
}

/// Біле з прозорістю `a` поверх тла оболонки (стани наведення й вибору: `--hv` і `--on-bg` у вебі).
pub fn over_ground(a: f32) -> Color32 {
    over(GROUND, Color32::WHITE, a)
}

/// Тло оболонки між картками: трохи світліше за картки.
pub const GROUND: Color32 = Color32::from_rgb(0x25, 0x27, 0x2a);

pub const R1: u8 = 4;
pub const R2: u8 = 8;
pub const R3: u8 = 12;

/// Вбудовані шрифти (SIL OFL, тексти ліцензій лежать поруч): Inter — інтерфейс, JetBrains Mono — ключі й числа.
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert("Inter".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/Inter.ttf"))));
    fonts.font_data.insert("JetBrainsMono".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/JetBrainsMono.ttf"))));
    fonts.font_data.insert("Inter-Medium".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/Inter-Medium.ttf"))));
    fonts.font_data.insert("Inter-SemiBold".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/Inter-SemiBold.ttf"))));
    // перші в черзі; типові лишаються запасними (символи, яких немає в Inter)
    fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "Inter".into());
    fonts.families.entry(FontFamily::Monospace).or_default().insert(0, "JetBrainsMono".into());
    // ваги 500 і 600 (у вебі вони в іменах, заголовках, лічильниках); знаків, яких у підмножині немає, дошукується звичайний Inter
    let proportional = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    for (name, face) in [("InterMedium", "Inter-Medium"), ("InterSemiBold", "Inter-SemiBold")] {
        let mut chain = vec![face.to_string()];
        chain.extend(proportional.iter().cloned());
        fonts.families.insert(FontFamily::Name(name.into()), chain);
    }
    ctx.set_fonts(fonts);
}

thread_local! {
    /// Чи вже прив'язані до шрифтів сімейства ваг (egui застосовує нові шрифти з наступного проходу; у застосунку вони стоять до першого кадру).
    static WEIGHTS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// На початку кадру: з'ясовує, чи можна малювати ваги 500/600 (інакше `ipw` повертає звичайний шрифт, а не панікує).
pub fn sync_weights(ctx: &egui::Context) {
    let ok = ctx.fonts(|f| f.families().contains(&FontFamily::Name("InterSemiBold".into())));
    WEIGHTS.with(|w| w.set(ok));
}

pub fn weights_ready() -> bool {
    WEIGHTS.with(std::cell::Cell::get)
}

pub fn apply(ctx: &egui::Context) {
    install_fonts(ctx);
    egui_extras::install_image_loaders(ctx);
    apply_style(ctx);
}

/// Кольори й розміри; викликається знову, коли тема проєкту змінила акцент.
pub fn apply_style(ctx: &egui::Context) {
    let mut v = egui::Visuals::dark();
    v.panel_fill = GROUND;
    v.window_fill = PANEL;
    v.extreme_bg_color = BG;
    v.faint_bg_color = ZEBRA;
    v.override_text_color = Some(TEXT);
    v.selection.bg_fill = sel_use();
    v.selection.stroke = Stroke::new(1.0_f32, accent());
    v.hyperlink_color = Color32::from_rgb(0x8f, 0xb2, 0xf7);
    let r = CornerRadius::same(R2);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = r;
    }
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, LINE);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, TEXT);
    v.widgets.inactive.bg_fill = BTN;
    v.widgets.inactive.weak_bg_fill = BTN;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, LINE);
    v.widgets.hovered.bg_fill = BTN_HOVER;
    v.widgets.hovered.weak_bg_fill = BTN_HOVER;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, LINE);
    v.widgets.active.bg_fill = BTN_HOVER;
    v.widgets.active.weak_bg_fill = BTN_HOVER;
    ctx.set_visuals(v);
    let mut st = (*ctx.style()).clone();
    st.spacing.item_spacing = egui::vec2(8.0, 6.0);
    st.spacing.button_padding = egui::vec2(11.0, 4.0);
    st.text_styles.insert(TextStyle::Body, FontId::new(12.5, FontFamily::Proportional));
    st.text_styles.insert(TextStyle::Button, FontId::new(12.5, FontFamily::Proportional));
    st.text_styles.insert(TextStyle::Small, FontId::new(11.0, FontFamily::Proportional));
    st.text_styles.insert(TextStyle::Monospace, FontId::new(11.0, FontFamily::Monospace));
    ctx.set_style(st);
}

/// Виділений пункт списку (суцільний колір: біле 15 % на тлі картки).
pub const SEL_GRAY_UI: Color32 = Color32::from_rgb(64, 64, 67);
