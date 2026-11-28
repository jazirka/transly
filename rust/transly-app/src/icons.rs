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
        "win-min" => ("<path d='M3.5 8.5h9'/>", false),
        "win-max" => ("<rect x='3.5' y='3.5' width='9' height='9' rx='1.2'/>", false),
        "win-restore" => ("<path d='M5.5 5.5v-.8a1.2 1.2 0 0 1 1.2-1.2h5.6a1.2 1.2 0 0 1 1.2 1.2v5.6a1.2 1.2 0 0 1-1.2 1.2h-.8'/><rect x='2.5' y='5.5' width='8' height='8' rx='1.2'/>", false),
        "win-close" => ("<path d='M3.5 3.5l9 9M12.5 3.5l-9 9'/>", false),
        "warn" => ("<path d='M8 2.5L14 13H2zM8 7v3M8 11.5v.2'/>", false),
        "refresh" => ("<path d='M13 6a5 5 0 0 0-9-1.5M3 2.5v2.5h2.5M3 10a5 5 0 0 0 9 1.5M13 13.5V11h-2.5'/>", false),
        "person" => ("<path d='M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.5 2.5-3.5 5-3.5s4.5 1 5 3.5'/>", false),
        "left" => ("<path d='M10 3.5L5.5 8l4.5 4.5'/>", false),
        "right" => ("<path d='M6 3.5L10.5 8 6 12.5'/>", false),
        "json" => ("<path d='M6 3H5a1 1 0 0 0-1 1v2.2a1 1 0 0 1-1 1 1 1 0 0 1 1 1V11a1 1 0 0 0 1 1h1M10 3h1a1 1 0 0 1 1 1v2.2a1 1 0 0 0 1 1 1 1 0 0 0-1 1V11a1 1 0 0 1-1 1h-1'/>", false),
        "plug" => ("<path d='M6 2.5v3M10 2.5v3M4.5 5.5h7V8a3.5 3.5 0 0 1-7 0zM8 11.5V14'/>", false),
        "globe" => ("<circle cx='8' cy='8' r='5.5'/><path d='M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11'/>", false),
        "server" => ("<rect x='2.5' y='3' width='11' height='4' rx='1'/><rect x='2.5' y='9' width='11' height='4' rx='1'/><path d='M5 5h.01M5 11h.01'/>", false),
        "palette" => ("<path d='M8 2.5a5.5 5.5 0 1 0 0 11c1 0 1.3-.7.9-1.3-.4-.7 0-1.6.9-1.6H11a2.5 2.5 0 0 0 2.5-2.5C13.5 4.7 11 2.5 8 2.5z'/><path d='M5 7.5h.01M7 5.2h.01M10 5.5h.01'/>", false),
        "sliders" => ("<path d='M3 5h6M12 5h1M3 11h2M8 11h5'/><circle cx='10.5' cy='5' r='1.5'/><circle cx='6.5' cy='11' r='1.5'/>", false),
        "wrap" => ("<path d='M3 4h10M3 8h7.5a2.2 2.2 0 0 1 0 4.4H8M9.6 10.6L8 12.4l1.6 1.8M3 12.5h2'/>", false),
        "db" => ("<ellipse cx='8' cy='4' rx='5' ry='1.8'/><path d='M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8'/>", false),
        "cloud" => ("<path d='M4.5 12.5a3 3 0 0 1-.4-5.9A4 4 0 0 1 11.7 6a3.3 3.3 0 0 1-.2 6.5z'/>", false),
        "check-sq" => ("<rect x='2.5' y='2.5' width='11' height='11' rx='2'/><path d='M5.5 8.2l1.8 1.8 3.2-3.6'/>", false),
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

/// Адреса й вміст піктограми: збираються один раз на назву (раніше кожне малювання виділяло рядок адреси й копію SVG, а на кадрі їх десятки).
fn asset(name: &str) -> (&'static str, egui::load::Bytes) {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    type Entry = (&'static str, Arc<[u8]>);
    static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    let mut m = CACHE.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    if let Some((uri, bytes)) = m.get(name) {
        return (uri, egui::load::Bytes::Shared(bytes.clone()));
    }
    let uri: &'static str = Box::leak(format!("bytes://icon-{name}.svg").into_boxed_str());
    let bytes: Arc<[u8]> = Arc::from(svg(name));
    m.insert(name.to_string(), (uri, bytes.clone()));
    (uri, egui::load::Bytes::Shared(bytes))
}

/// Малює піктограму в прямокутнику.
pub fn paint(ui: &egui::Ui, rect: Rect, name: &str, color: Color32) {
    let (uri, bytes) = asset(name);
    egui::Image::from_bytes(uri, bytes).tint(color).paint_at(ui, rect);
}

/// Те саме, повернуте на `angle` радіан навколо центру (згорнута тека: шеврон −90°).
pub fn paint_rot(ui: &egui::Ui, rect: Rect, name: &str, color: Color32, angle: f32) {
    let (uri, bytes) = asset(name);
    egui::Image::from_bytes(uri, bytes).tint(color).rotate(angle, Vec2::splat(0.5)).paint_at(ui, rect);
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
    let (uri, bytes) = asset(name);
    egui::Image::from_bytes(uri, bytes).tint(color).fit_to_exact_size(Vec2::splat(size))
}
