//! Піктограми старого інтерфейсу (`SVG` у `app/src/ui/app.ts`): контури 16×16, штрих 1,5. Малюються білими й фарбуються `tint`.

use eframe::egui::{self, Color32, Rect, Sense, Vec2};

/// (назва, вміст SVG); `fill` — піктограма заповнена, а не контурна.
fn body(name: &str) -> (&'static str, bool) {
    match name {
        "menu" => ("<path d='M2.5 4.5h11M2.5 8h11M2.5 11.5h11'/>", false),
        "files" => ("<path d='M2 4.5h4l1.2 1.5H14V12.5H2z'/>", false),
        "rows" => ("<path d='M3 4h10M3 8h10M3 12h10'/>", false),
        "both" => ("<rect x='2.5' y='2.5' width='11' height='11' rx='1.5'/><path d='M2.5 8h11'/>", false),
        "table" => ("<path d='M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9'/>", false),
        "edit" => ("<path d='M2.5 3.5h11v9h-11zM6 3.5v9M6 8h7.5'/>", false),
        "scene" => ("<rect x='2.5' y='3' width='11' height='6' rx='1.5'/><rect x='2.5' y='11' width='7' height='2.5' rx='1'/>", false),
        "book" => ("<path d='M3.5 2.5h8a1 1 0 0 1 1 1v10H4.5a1 1 0 0 1-1-1z'/><path d='M6 5.5h4'/>", false),
        "bell" => ("<path d='M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3'/>", false),
        "keys" => ("<rect x='1.5' y='3.5' width='13' height='9' rx='1.8'/><path d='M4.2 6.5h.01M6.7 6.5h.01M9.3 6.5h.01M11.8 6.5h.01M4.5 9.5h7'/>", false),
        "play" => ("<path d='M4.5 2.5l9 5.5-9 5.5z'/>", true),
        "caret" => ("<path d='M3.5 6l4.5 4.5L12.5 6'/>", false),
        "branch" => ("<circle cx='4.5' cy='3.5' r='1.6'/><circle cx='4.5' cy='12.5' r='1.6'/><circle cx='11.5' cy='6' r='1.6'/><path d='M4.5 5.1v5.8M11.5 7.6c0 2.4-3 2.4-7 3.3'/>", false),
        "build" => ("<path d='M2.5 9l2-4.5h7L13.5 9v3h-11z'/><circle cx='5.5' cy='12' r='1'/><circle cx='10.5' cy='12' r='1'/>", false),
        "game" => ("<rect x='2' y='3' width='12' height='8.5' rx='1.5'/><path d='M6.7 5.4l3 1.85-3 1.85z'/><path d='M5.5 13.5h5'/>", false),
        "file" => ("<path d='M2.5 5h11v8h-11z'/><path d='M2.5 5l1.5-2h8l1.5 2M6.5 8h3'/>", false),
        "flag" => ("<path d='M4 14V2.5M4 3h8.5l-2.2 2.6 2.2 2.6H4'/>", false),
        "search" => ("<circle cx='7' cy='7' r='4.5'/><path d='M10.5 10.5L14 14'/>", false),
        "cmt" => ("<path d='M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z'/>", false),
        "history" => ("<path d='M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3h3M8 5v3.2l2 1.3'/>", false),
        "link" => ("<path d='M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1'/>", false),
        "trash" => ("<path d='M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M7 7v4M9 7v4'/>", false),
        "send" => ("<path d='M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z'/>", false),
        "dots" => ("<path d='M8 3.5h.01M8 8h.01M8 12.5h.01'/>", false),
        "minus" => ("<path d='M3 8h10'/>", false),
        "close" => ("<path d='M4 4l8 8M12 4l-8 8'/>", false),
        "restore" => ("<path d='M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8'/>", false),
        "pencil" => ("<path d='M10.5 2.5l3 3L5.5 13.5l-3.5.5.5-3.5z'/>", false),
        "cmp" => ("<path d='M5 3L2 6l3 3M2 6h8M11 13l3-3-3-3M14 10H6'/>", false),
        "before" => ("<path d='M8 4.5V8l2.5 1.5M2.5 8A5.5 5.5 0 1 0 4 4.2M2.5 2.5v2.8h2.8'/>", false),
        "check" => ("<path d='M3 8.5l3.2 3.2L13 4.8'/>", false),
        "warn" => ("<path d='M8 2.5L14 13H2zM8 7v3M8 11.5v.2'/>", false),
        "refresh" => ("<path d='M13 6a5 5 0 0 0-9-1.5M3 2.5v2.5h2.5M3 10a5 5 0 0 0 9 1.5M13 13.5V11h-2.5'/>", false),
        "person" => ("<path d='M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.5 2.5-3.5 5-3.5s4.5 1 5 3.5'/>", false),
        "left" => ("<path d='M10 3.5L5.5 8l4.5 4.5'/>", false),
        "right" => ("<path d='M6 3.5L10.5 8 6 12.5'/>", false),
        "json" => ("<path d='M6 3H5a1 1 0 0 0-1 1v2.2a1 1 0 0 1-1 1 1 1 0 0 1 1 1V11a1 1 0 0 0 1 1h1M10 3h1a1 1 0 0 1 1 1v2.2a1 1 0 0 0 1 1 1 1 0 0 0-1 1V11a1 1 0 0 1-1 1h-1'/>", false),
        _ => ("", false),
    }
}

/// SVG піктограми білим кольором (колір дає `tint`).
fn svg(name: &str) -> Vec<u8> {
    // стрілки з веба мають власні полотна й товщину штриха: caret — 10×10 (штрих 1,6), chev дерева — 8×8 (штрих 1,5); на 16-піксельному полотні вони тонші й тьмяні
    let own = match name {
        "caret" => Some((10, "1.6", "M2 3.6L5 6.6l3-3")),
        "chev" => Some((8, "1.5", "M1.5 2.5L4 5.2l2.5-2.7")),
        _ => None,
    };
    if let Some((vb, sw, d)) = own {
        return format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {vb} {vb}' width='64' height='64' fill='none' stroke='white' stroke-width='{sw}' stroke-linecap='round' stroke-linejoin='round'><path d='{d}'/></svg>").into_bytes();
    }
    let (b, fill) = body(name);
    let style = if fill { "fill='white' stroke='none'" } else { "fill='none' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'" };
    format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' width='64' height='64' {style}>{b}</svg>").into_bytes()
}

/// Малює піктограму в прямокутнику.
pub fn paint(ui: &egui::Ui, rect: Rect, name: &str, color: Color32) {
    egui::Image::from_bytes(format!("bytes://icon-{name}.svg"), svg(name)).tint(color).paint_at(ui, rect);
}

/// Те саме, повернуте на `angle` радіан навколо центру (згорнута тека: шеврон −90°).
pub fn paint_rot(ui: &egui::Ui, rect: Rect, name: &str, color: Color32, angle: f32) {
    egui::Image::from_bytes(format!("bytes://icon-{name}.svg"), svg(name)).tint(color).rotate(angle, Vec2::splat(0.5)).paint_at(ui, rect);
}

/// Квадратна кнопка з піктограмою (як `tb-ic` у старому застосунку).
pub fn button(ui: &mut egui::Ui, name: &str, tip: &str, on: bool, color: Color32) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(28.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, tip));
    if on {
        ui.painter().rect_filled(rect, egui::CornerRadius::same(8), crate::theme::over_ground_at(rect.center(), 0.15));
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, egui::CornerRadius::same(8), crate::theme::over_ground_at(rect.center(), 0.07));
    }
    paint(ui, Rect::from_center_size(rect.center(), Vec2::splat(16.0)), name, if on { Color32::WHITE } else { color });
    resp.on_hover_text(tip)
}

/// Зображення піктограми (для `Button::image`).
pub fn image(name: &str, color: Color32, size: f32) -> egui::Image<'static> {
    egui::Image::from_bytes(format!("bytes://icon-{name}.svg"), svg(name)).tint(color).fit_to_exact_size(Vec2::splat(size))
}
