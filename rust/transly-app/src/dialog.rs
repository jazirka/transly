//! Діалоги за будовою `.dlg` у вебі (`theme.css`): темна підложка на все вікно (чорне 50 %), блок по центру завширшки 640 (не ширше вікна без 24), тло `#2b2d33`,
//! рамка `#4a4d54`, радіус 12, тінь; шапка (відступи 12×16, назва зліва 15 вагою 500, кругла кнопка «✕» 30 і лінія знизу), тіло (відступи 14×16, що не вміщається, листається),
//! підвал (`dlg_footer`: лінія зверху, кнопки праворуч із проміжком 8, головна остання). Модальні: поки діалог відкритий, решта вікна не реагує (як у вебі, де верхня панель тьмяніє).
//! Для викликачів лишився той самий ланцюжок, що був в `egui::Window`: `.open(&mut open).collapsible(false).resizable(false).default_width(..).show(ctx, |ui| …)`.

use super::*;

/// Ширина діалогу (`width: min(640px, 100%)`); ширші за 640 (злиття гілок, оновлення за глосарієм) беруть свою.
const WIDTH: f32 = 640.0;
const HEAD_PAD_Y: f32 = 12.0;
const CLOSE: f32 = 30.0;

pub(crate) struct Dlg<'a> {
    title: String,
    open: Option<&'a mut bool>,
    width: f32,
}

/// Діалог із назвою; далі `.open(&mut bool)` додає «✕», `.show(ctx, …)` малює.
pub(crate) fn dlg<'a>(title: impl Into<String>) -> Dlg<'a> {
    Dlg { title: title.into(), open: None, width: WIDTH }
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
        let w = width.min(screen.width() - 24.0).max(280.0);
        let max_h = screen.height() * 0.88;
        let frame = egui::Frame::new()
            .fill(Color32::from_rgb(0x2b, 0x2d, 0x33))
            .stroke(Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)))
            .corner_radius(CornerRadius::same(12))
            .shadow(egui::epaint::Shadow { offset: [0, 24], blur: 70, spread: 0, color: Color32::from_black_alpha(153) })
            .inner_margin(egui::Margin::ZERO);
        let mut close = false;
        // ширина за змістом: діалог не вужчий за 640, а якщо вміст ширший (рядок кнопок, таблиця), шапка й підвал беруть його ширину з попереднього кадру
        let need_key = egui::Id::new(("dlg-need", &title));
        let need = ctx.data(|d| d.get_temp::<f32>(need_key)).unwrap_or(0.0);
        let wi = (w - 2.0).max(need).min(screen.width() - 26.0);
        let mut measured = 0.0_f32;
        let resp = egui::Modal::new(egui::Id::new(("dlg", &title))).backdrop_color(Color32::from_black_alpha(128)).frame(frame).show(ctx, |ui| {
            ui.set_min_width(wi);
            // область діалогу в egui «пам'ятає» розмір попереднього кадру й обмежує по ньому, скільки лишилось місця: даємо їй висоту до 88 % вікна, інакше тіло не росло б
            ui.set_max_height(max_h);
            ui.spacing_mut().item_spacing.y = 10.0;
            // шапка: відступи 12×16, назва 15 вагою 500, «✕» 30 праворуч, лінія знизу
            let head_h = HEAD_PAD_Y * 2.0 + CLOSE;
            let (head, _) = ui.allocate_exact_size(vec2(wi, head_h + 1.0), Sense::hover());
            let g = ui.painter().layout_no_wrap(title.clone(), ipw(15.0, 500), TEXT);
            let at = pos2(head.left() + 16.0, head.top() + HEAD_PAD_Y + (CLOSE - g.size().y) / 2.0);
            let tr = ui.interact(Rect::from_min_size(at, g.size()), ui.id().with("dlg-title"), Sense::hover());
            tr.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, title.clone()));
            ui.painter().galley(at, g, TEXT);
            ui.painter().hline(head.x_range(), head.bottom() - 0.5, Stroke::new(1.0_f32, LINE));
            if open.is_some() {
                let x = Rect::from_min_size(pos2(head.right() - 16.0 - CLOSE, head.top() + HEAD_PAD_Y), vec2(CLOSE, CLOSE));
                let xr = ui.interact(x, ui.id().with("dlg-close"), Sense::click());
                xr.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Закрити"));
                if xr.hovered() {
                    ui.painter().circle_filled(x.center(), CLOSE / 2.0, Color32::from_white_alpha(26));
                }
                icons::paint(ui, Rect::from_center_size(x.center(), vec2(16.0, 16.0)), "close", if xr.hovered() { TEXT } else { MUTE });
                if xr.clicked() {
                    close = true;
                }
            }
            // тіло: відступи 14×16; висока вставка листається
            egui::ScrollArea::vertical().auto_shrink([false, true]).max_height((max_h - head_h - 1.0).max(120.0)).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin { left: 16, right: 16, top: 14, bottom: 14 }).show(ui, |ui| {
                    ui.set_min_width(w - 2.0 - 32.0);
                    ui.set_max_width(wi - 32.0);
                    add(ui);
                    measured = ui.min_rect().width() + 32.0;
                });
            });
        });
        if (measured - need).abs() > 0.5 {
            ctx.data_mut(|d| d.insert_temp(need_key, measured));
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

/// Підвал діалогу (`.dlg-f`): лінія зверху, кнопки праворуч із проміжком 8. Кнопки додаються справа наліво: головна першою, «Закрити» за нею, так на екрані
/// «Закрити» стоїть ліворуч від головної, як у вебі.
pub(crate) fn dlg_footer(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    ui.add_space(4.0);
    // лінія йде від краю до краю діалогу (поля тіла 16 з кожного боку), але місця понад вміст не займає
    let (line, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
    ui.painter().hline((line.left() - 16.0)..=(line.right() + 16.0), line.center().y, Stroke::new(1.0_f32, LINE));
    ui.add_space(12.0);
    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        ui.spacing_mut().item_spacing.x = 8.0;
        add(ui);
    });
}
