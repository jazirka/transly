//! Діалоги за будовою `.adlg` у вебі (`app.css`, `shell.css`, `theme.css`) — те, чим там відкривається кожне вікно (`dialog()` у `settings.ts`):
//! темна підложка на все вікно (чорне 50 %), блок завширшки `min(640, 92 % вікна)` по центру **під верхньою панеллю** (`inset: 40px 0 0 0; margin: auto`),
//! тло `#2b2d33`, рамка `#4a4d54`, радіус 12, тінь `0 24 70`; усередині відступи 16×18 і проміжок 10, заголовок `h2` 15 вагою 500 просто в тілі (шапки з лінією
//! і кнопки «✕» там немає), унизу `.acts`: лінія зверху, відступи 8 і 2, кнопки праворуч із проміжком 8, головна остання. Заввишки не більше «вікно − 64»
//! (40 верхня панель + 24); що не вміщається, листається, а рядок кнопок лишається внизу (`position: sticky`).
//! Модальні: поки діалог відкритий, решта вікна не реагує (у вебі застосунок за ним `inert`). Esc закриває.
//! Для викликачів лишився той самий ланцюжок, що був в `egui::Window`: `.open(&mut open).collapsible(false).resizable(false).default_width(..).show(ctx, |ui| …)`.
//! Діалог, що сам не викликав `dlg_footer`, отримує підвал із «Закрити» (у вебі такі вікна теж закриваються кнопкою внизу).

use super::*;

/// Ширина діалогу (`width: min(640px, 92vw)`); ширші за 640 (злиття гілок, оновлення за глосарієм) беруть свою.
pub(crate) const WIDTH: f32 = 640.0;
/// Висота верхньої панелі (`--tb-h`): діалог стоїть у частині вікна під нею.
const TB_H: f32 = 40.0;
/// Відступи форми `.adlg form{padding:16px 18px}`.
const PAD_X: f32 = 18.0;
const PAD_Y: f32 = 16.0;
/// Проміжок між блоками форми (`gap:10px`).
const GAP: f32 = 10.0;
/// Рядок кнопок: лінія 1 + відступ 8 + кнопки 28 + відступ 2.
const FOOT_H: f32 = 1.0 + 8.0 + 28.0 + 2.0;
/// Додатковий проміжок над рядком кнопок (`margin-top:6px`; разом із `gap` 16).
const FOOT_MT: f32 = 6.0;
const BG: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x33);

pub(crate) struct Dlg<'a> {
    title: String,
    open: Option<&'a mut bool>,
    width: f32,
}

/// Діалог із назвою; далі `.open(&mut bool)` дозволяє закрити його Esc, `.show(ctx, …)` малює.
pub(crate) fn dlg<'a>(title: impl Into<String>) -> Dlg<'a> {
    Dlg { title: title.into(), open: None, width: WIDTH }
}

fn flag(name: &str) -> egui::Id {
    egui::Id::new(("dlg-flag", name))
}

fn pin_of(ctx: &egui::Context) -> Option<Rect> {
    ctx.data(|d| d.get_temp::<Option<Rect>>(flag("pin"))).flatten()
}

impl<'a> Dlg<'a> {
    pub(crate) fn open(mut self, open: &'a mut bool) -> Self {
        self.open = Some(open);
        self
    }

    /// Назви налаштувань `egui::Window`, що лишились для сумісності: діалог не згортається й не розтягується, висоту визначає вміст.
    pub(crate) fn collapsible(self, _: bool) -> Self {
        self
    }

    pub(crate) fn resizable(self, _: bool) -> Self {
        self
    }

    pub(crate) fn default_height(self, _: f32) -> Self {
        self
    }

    /// Ширина: стандартна 640; діалог, що просив ширше (680, 720), лишається таким.
    pub(crate) fn default_width(mut self, w: f32) -> Self {
        if w > WIDTH {
            self.width = w;
        }
        self
    }

    pub(crate) fn show(self, ctx: &egui::Context, add: impl FnOnce(&mut egui::Ui)) {
        let Dlg { title, open, width } = self;
        let screen = ctx.screen_rect();
        // `width: min(640px, 92vw)` і `max-width: calc(100% - 24px)`
        let w = width.min(screen.width() * 0.92).min(screen.width() - 24.0).max(280.0);
        // `max-height: calc(100% - 64px)`: 40 верхня панель і 12 + 12 поля
        let max_h = (screen.height() - TB_H - 24.0).max(160.0);
        let frame = egui::Frame::new()
            .fill(BG)
            .stroke(Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)))
            .corner_radius(CornerRadius::same(12))
            .shadow(egui::epaint::Shadow { offset: [0, 24], blur: 70, spread: 0, color: Color32::from_black_alpha(153) })
            .inner_margin(egui::Margin::ZERO);
        let mut close = false;
        let id = egui::Id::new(("dlg", &title));
        // ширина за змістом: діалог не вужчий за 640, а якщо вміст ширший (рядок кнопок, таблиця), підвал бере його ширину з попереднього кадру
        let need_key = egui::Id::new(("dlg-need", &title));
        let need = ctx.data(|d| d.get_temp::<f32>(need_key)).unwrap_or(0.0);
        let wi = (w - 2.0).max(need).min(screen.width() - 26.0);
        // що було в попередньому кадрі: висота тіла без підвалу (чи вміститься все), де стояв діалог (куди «приклеїти» підвал)
        let body_key = egui::Id::new(("dlg-body", &title));
        let body_h = ctx.data(|d| d.get_temp::<f32>(body_key)).unwrap_or(0.0);
        let last = ctx.memory(|m| m.area_rect(id));
        let natural = 1.0 + PAD_Y + body_h + GAP + FOOT_MT + FOOT_H + PAD_Y + 1.0;
        let pinned = natural > max_h;
        let mut measured = (0.0_f32, 0.0_f32);
        let area = egui::Modal::default_area(id).anchor(Align2::CENTER_CENTER, vec2(0.0, TB_H / 2.0));
        let resp = egui::Modal::new(id).area(area).backdrop_color(Color32::from_black_alpha(128)).frame(frame).show(ctx, |ui| {
            ui.set_min_width(wi);
            // область діалогу в egui «пам'ятає» розмір попереднього кадру й обмежує по ньому, скільки лишилось місця: даємо їй повну висоту, інакше тіло не росло б
            ui.set_max_height(max_h);
            ctx.data_mut(|d| {
                d.insert_temp(flag("called"), false);
                let pin = match (pinned, last) {
                    (true, Some(r)) => Some(Rect::from_min_max(pos2(r.left() + 1.0, r.bottom() - 1.0 - FOOT_H), pos2(r.right() - 1.0, r.bottom() - 1.0))),
                    (true, None) => Some(Rect::from_min_size(pos2(screen.center().x - wi / 2.0, screen.bottom() - 13.0 - FOOT_H), vec2(wi, FOOT_H))),
                    _ => None,
                };
                d.insert_temp::<Option<Rect>>(flag("pin"), pin);
            });
            ui.spacing_mut().item_spacing.y = 0.0;
            let view_h = if pinned { max_h - 2.0 - FOOT_H } else { max_h - 2.0 };
            egui::ScrollArea::vertical().auto_shrink([false, true]).max_height(view_h).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin { left: PAD_X as i8, right: PAD_X as i8, top: PAD_Y as i8, bottom: PAD_Y as i8 }).show(ui, |ui| {
                    ui.set_min_width(w - 2.0 - 2.0 * PAD_X);
                    ui.set_max_width(wi - 2.0 * PAD_X);
                    ui.spacing_mut().item_spacing.y = GAP;
                    // `h2` 15 вагою 500, рядок 21
                    let g = ui.painter().layout_no_wrap(title.clone(), ipw(15.0, 500), TEXT);
                    let (head, _) = ui.allocate_exact_size(vec2(ui.available_width(), 21.0), Sense::hover());
                    let at = pos2(head.left(), head.center().y - g.size().y / 2.0);
                    let tr = ui.interact(Rect::from_min_size(at, g.size()), ui.id().with("dlg-title"), Sense::hover());
                    tr.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, title.clone()));
                    ui.painter().galley(at, g, TEXT);
                    let top = ui.cursor().top();
                    add(ui);
                    if !ctx.data(|d| d.get_temp::<bool>(flag("called"))).unwrap_or(false) {
                        dlg_footer(ui, |ui| {
                            if plain_button(ui, "Закрити").clicked() {
                                close = true;
                            }
                        });
                    }
                    let foot = if pin_of(ctx).is_some() { 0.0 } else { GAP + FOOT_MT + FOOT_H };
                    measured = (ui.min_rect().width() + 2.0 * PAD_X, (ui.min_rect().bottom() - top - foot).max(0.0) + 21.0 + GAP);
                });
            });
            if pinned {
                // місце під приклеєний рядок кнопок: його малює `dlg_footer` поверх цього місця
                ui.allocate_exact_size(vec2(wi, FOOT_H), Sense::hover());
            }
        });
        // запам'ятати виміри; перемалювати лише тоді, коли від них залежить вигляд цього кадру (ширина, чи приклеювати підвал)
        let natural_now = 1.0 + PAD_Y + measured.1 + GAP + FOOT_MT + FOOT_H + PAD_Y + 1.0;
        ctx.data_mut(|d| {
            d.insert_temp(need_key, measured.0);
            d.insert_temp(body_key, measured.1);
        });
        if (measured.0 - need).abs() > 0.5 || (natural_now > max_h) != pinned {
            ctx.request_repaint();
        }
        // Esc закриває, коли відкритого випадного списку немає; клік по підложці — ні (набране не губиться)
        if resp.is_top_modal && !resp.any_popup_open && ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            close = true;
        }
        if close {
            if let Some(o) = open {
                *o = false;
            }
        }
    }
}

/// Рядок кнопок діалогу (`.acts`): лінія зверху, кнопки праворуч із проміжком 8. Кнопки додаються справа наліво: головна першою, «Закрити» за нею, так на екрані
/// «Закрити» стоїть ліворуч від головної, як у вебі. Якщо діалог не вміщається у вікно, рядок стоїть унизу вікна діалогу, а тіло листається (`position: sticky`).
pub(crate) fn dlg_footer(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    let ctx = ui.ctx().clone();
    ctx.data_mut(|d| d.insert_temp(flag("called"), true));
    let line = Stroke::new(1.0_f32, LINE);
    if let Some(r) = pin_of(&ctx) {
        // приклеєний: окремий вузол у вікні діалогу (поза областю прокручування); тло закриває те, що пролистується під ним
        let mut c = ui.new_child(egui::UiBuilder::new().max_rect(r).layout(egui::Layout::top_down(egui::Align::Min)));
        c.set_clip_rect(r);
        c.painter().rect_filled(r, CornerRadius { nw: 0, ne: 0, sw: 11, se: 11 }, BG);
        c.painter().hline(r.x_range(), r.top() + 0.5, line);
        let row = Rect::from_min_size(pos2(r.left() + PAD_X, r.top() + 1.0 + 8.0), vec2(r.width() - 2.0 * PAD_X, 28.0));
        c.allocate_new_ui(egui::UiBuilder::new().max_rect(row).layout(egui::Layout::right_to_left(egui::Align::Center)), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            add(ui);
        });
        return;
    }
    ui.scope(|ui| {
        ui.spacing_mut().item_spacing.y = 0.0;
        ui.add_space(FOOT_MT);
        // лінія йде від краю до краю діалогу (поля тіла 18 з кожного боку)
        let (l, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
        ui.painter().hline((l.left() - PAD_X)..=(l.right() + PAD_X), l.center().y, line);
        ui.add_space(8.0);
        ui.allocate_ui_with_layout(vec2(ui.available_width(), 28.0), egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            add(ui);
        });
        ui.add_space(2.0);
    });
}
