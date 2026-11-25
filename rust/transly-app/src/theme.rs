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
pub const MUTE: Color32 = Color32::from_rgb(0x86, 0x8a, 0x91);
pub const DIM: Color32 = Color32::from_rgb(0x5f, 0x63, 0x69);
pub const ACCENT: Color32 = Color32::from_rgb(0x8b, 0x72, 0xe8);
pub const ACCENT_HOVER: Color32 = Color32::from_rgb(0x9a, 0x85, 0xee);
pub const SEL: Color32 = Color32::from_rgb(0x3a, 0x31, 0x70);
pub const SEL_SOFT: Color32 = Color32::from_rgb(0x2a, 0x25, 0x48);
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
pub const TRACK: Color32 = Color32::from_rgb(0x3a, 0x3d, 0x42);
pub const CHIP_ON: Color32 = Color32::from_rgb(0x2f, 0x2a, 0x58);
pub const CHIP_ON_LINE: Color32 = Color32::from_rgb(0x5a, 0x4a, 0x9a);
pub const CHIP_ON_TEXT: Color32 = Color32::from_rgb(0xd9, 0xd0, 0xff);
pub const FILTERS_BG: Color32 = Color32::from_rgb(0x22, 0x24, 0x27);
pub const TREE_HOVER: Color32 = Color32::from_rgb(0x34, 0x36, 0x3a);
pub const INPUT_BG: Color32 = Color32::from_rgb(0x17, 0x18, 0x1a);

pub const R1: u8 = 4;
pub const R2: u8 = 8;
pub const R3: u8 = 12;

/// Вбудовані шрифти (SIL OFL, тексти ліцензій лежать поруч): Inter — інтерфейс, JetBrains Mono — ключі й числа.
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert("Inter".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/Inter.ttf"))));
    fonts.font_data.insert("JetBrainsMono".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/JetBrainsMono.ttf"))));
    // перші в черзі; типові лишаються запасними (символи, яких немає в Inter)
    fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "Inter".into());
    fonts.families.entry(FontFamily::Monospace).or_default().insert(0, "JetBrainsMono".into());
    ctx.set_fonts(fonts);
}

pub fn apply(ctx: &egui::Context) {
    install_fonts(ctx);
    let mut v = egui::Visuals::dark();
    v.panel_fill = PANEL;
    v.window_fill = PANEL;
    v.extreme_bg_color = BG;
    v.faint_bg_color = ZEBRA;
    v.override_text_color = Some(TEXT);
    v.selection.bg_fill = SEL;
    v.selection.stroke = Stroke::new(1.0_f32, ACCENT);
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
