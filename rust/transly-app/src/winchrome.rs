//! Власний заголовок вікна (`app/src/ui/winctl.ts`, `shell.css` + `buttons.css`): системної смуги з кнопками Windows немає, верхня панель застосунку —
//! місце, за яке вікно тягнуть (подвійний клік розгортає), а на її правому краю три кнопки: «Згорнути», «Розгорнути» / «Відновити розмір» і «Закрити».
//! Розміри з кінцевого CSS (`buttons.css` іде останнім): кнопка 36×28 (закрити 40×28), радіус 8, проміжок між ними 2, по центру панелі заввишки 40;
//! наведення біле 10 %, натиск 16 %, «закрити» — `#c42b1c` / `#a82417` з білим значком; блок разом з полем займає 134 праворуч (`--wctl-w` 128 + 6).
//! Вибір «системний заголовок» запам'ятовується в `%LOCALAPPDATA%/Transly/chrome.json` і вмикається в «Вигляд»: так вікно без робочих кнопок не лишиться.

use super::*;
use egui::{CursorIcon, ResizeDirection, ViewportCommand};

/// Скільки місця праворуч лишається під кнопки вікна (`--wctl-w`): решта верхньої панелі не заходить на них.
pub(crate) const WCTL_W: f32 = 128.0;
const BTN_W: f32 = 36.0;
const CLOSE_W: f32 = 40.0;
const BTN_H: f32 = 28.0;
const GAP: f32 = 2.0;
/// Товщина країв, за які вікно розтягують, і кутів.
const EDGE: f32 = 5.0;
const CORNER: f32 = 12.0;
const INK: Color32 = Color32::from_rgb(0xc7, 0xca, 0xd1);
const CLOSE_HOVER: Color32 = Color32::from_rgb(0xc4, 0x2b, 0x1c);
const CLOSE_PRESS: Color32 = Color32::from_rgb(0xa8, 0x24, 0x17);

/// Чи обрано власний заголовок (за замовчуванням так).
pub(crate) fn own_chrome_chosen() -> bool {
    crate::state::local_file("chrome.json").and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).and_then(|v| v.get("system").and_then(|s| s.as_bool())).is_none_or(|system| !system)
}

fn save_choice(own: bool) {
    if let Some(p) = crate::state::local_file("chrome.json") {
        let _ = std::fs::create_dir_all(p.parent().unwrap_or(std::path::Path::new(".")));
        let _ = std::fs::write(p, serde_json::json!({ "system": !own }).to_string());
    }
}

/// Куди тягнути, коли вказівник у точці `p` на краю вікна `win`: `None` — не на краю.
pub(crate) fn edge_at(win: Rect, p: egui::Pos2) -> Option<ResizeDirection> {
    if !win.contains(p) {
        return None;
    }
    let (l, r, t, b) = (p.x - win.left(), win.right() - p.x, p.y - win.top(), win.bottom() - p.y);
    let (west, east, north, south) = (l < EDGE, r < EDGE, t < EDGE, b < EDGE);
    let (cw, ce, cn, cs) = (l < CORNER, r < CORNER, t < CORNER, b < CORNER);
    Some(match (west, east, north, south) {
        (_, _, true, _) if cw => ResizeDirection::NorthWest,
        (_, _, true, _) if ce => ResizeDirection::NorthEast,
        (_, _, _, true) if cw => ResizeDirection::SouthWest,
        (_, _, _, true) if ce => ResizeDirection::SouthEast,
        (true, _, _, _) if cn => ResizeDirection::NorthWest,
        (true, _, _, _) if cs => ResizeDirection::SouthWest,
        (_, true, _, _) if cn => ResizeDirection::NorthEast,
        (_, true, _, _) if cs => ResizeDirection::SouthEast,
        (true, ..) => ResizeDirection::West,
        (_, true, ..) => ResizeDirection::East,
        (_, _, true, _) => ResizeDirection::North,
        (_, _, _, true) => ResizeDirection::South,
        _ => return None,
    })
}

fn cursor_of(d: ResizeDirection) -> CursorIcon {
    match d {
        ResizeDirection::North => CursorIcon::ResizeNorth,
        ResizeDirection::South => CursorIcon::ResizeSouth,
        ResizeDirection::East => CursorIcon::ResizeEast,
        ResizeDirection::West => CursorIcon::ResizeWest,
        ResizeDirection::NorthEast => CursorIcon::ResizeNorthEast,
        ResizeDirection::NorthWest => CursorIcon::ResizeNorthWest,
        ResizeDirection::SouthEast => CursorIcon::ResizeSouthEast,
        ResizeDirection::SouthWest => CursorIcon::ResizeSouthWest,
    }
}

impl App {
    /// Смуга для перетягування вікна по всій верхній панелі (під її кнопками) і три кнопки справа. Викликається першою, щоб решта панелі лежала поверх.
    pub(crate) fn window_controls(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        let screen = ctx.screen_rect();
        let maximized = ctx.input(|i| i.viewport().maximized).unwrap_or(false);
        let bar = Rect::from_min_max(screen.min, pos2(screen.right() - WCTL_W, screen.top() + 40.0));
        let drag = ui.interact(bar, ui.id().with("window-drag"), Sense::click_and_drag());
        if drag.drag_started_by(egui::PointerButton::Primary) {
            ctx.send_viewport_cmd(ViewportCommand::StartDrag);
        }
        if drag.double_clicked() {
            ctx.send_viewport_cmd(ViewportCommand::Maximized(!maximized));
        }
        let top = screen.top() + (40.0 - BTN_H) / 2.0;
        let close = Rect::from_min_size(pos2(screen.right() - CLOSE_W, top), vec2(CLOSE_W, BTN_H));
        let max = Rect::from_min_size(pos2(close.left() - GAP - BTN_W, top), vec2(BTN_W, BTN_H));
        let min = Rect::from_min_size(pos2(max.left() - GAP - BTN_W, top), vec2(BTN_W, BTN_H));
        let max_label = if maximized { "Відновити розмір вікна" } else { "Розгорнути вікно" };
        let max_icon = if maximized { "win-restore" } else { "win-max" };
        let items = [(min, "win-min", "Згорнути вікно", "Згорнути"), (max, max_icon, max_label, if maximized { "Відновити розмір" } else { "Розгорнути" }), (close, "win-close", "Закрити вікно", "Закрити")];
        for (i, (r, icon, label, tip)) in items.into_iter().enumerate() {
            let resp = ui.interact(r, ui.id().with(("winctl", i)), Sense::click());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, label));
            let is_close = i == 2;
            let (hot, down) = (resp.hovered(), resp.is_pointer_button_down_on());
            if hot || down {
                let fill = match (is_close, down) {
                    (true, true) => CLOSE_PRESS,
                    (true, false) => CLOSE_HOVER,
                    (false, true) => theme::over_ground_at(r.center(), 0.16),
                    (false, false) => theme::over_ground_at(r.center(), 0.10),
                };
                ui.painter().rect_filled(r, CornerRadius::same(8), fill);
            }
            icons::paint(ui, Rect::from_center_size(r.center(), vec2(16.0, 16.0)), icon, if hot || down { Color32::WHITE } else { INK });
            if resp.on_hover_text(tip).clicked() {
                ctx.send_viewport_cmd(match i {
                    0 => ViewportCommand::Minimized(true),
                    1 => ViewportCommand::Maximized(!maximized),
                    _ => ViewportCommand::Close,
                });
            }
        }
    }

    /// Краї вікна без системної рамки: вказівник на краю міняє вигляд, натиск починає розтягування (`BeginResize`). У розгорнутому вікні країв нема.
    pub(crate) fn window_edges(&mut self, ctx: &egui::Context) {
        if ctx.input(|i| i.viewport().maximized.unwrap_or(false) || i.viewport().fullscreen.unwrap_or(false)) {
            return;
        }
        let Some(p) = ctx.input(|i| i.pointer.hover_pos()) else { return };
        let Some(dir) = edge_at(ctx.screen_rect(), p) else { return };
        ctx.set_cursor_icon(cursor_of(dir));
        if ctx.input(|i| i.pointer.primary_pressed()) {
            ctx.send_viewport_cmd(ViewportCommand::BeginResize(dir));
        }
    }

    /// «Вигляд → Системний / Власний заголовок вікна»: перемикає смугу заголовка одразу й запам'ятовує вибір.
    pub(crate) fn toggle_chrome(&mut self, ctx: &egui::Context) {
        self.chrome_own = !self.chrome_own;
        save_choice(self.chrome_own);
        ctx.send_viewport_cmd(ViewportCommand::Decorations(!self.chrome_own));
    }
}
