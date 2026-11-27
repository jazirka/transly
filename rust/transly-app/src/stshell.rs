//! Вікно налаштувань як `.adlg.st-dlg` у вебі (`theme.css`, `projset.css`, `settings.ts`): блок `min(900, вікно − 24)` × `min(висота, вікно − 64)` по центру під верхньою
//! панеллю; ліворуч дерево сторінок (236, фон `--bg`, справа лінія), праворуч «крихти» (15/500, відступи 14×20×10) і сторінка, що листається (відступи 4×20×20,
//! проміжок 12), унизу рядок `.st-bar` (49: лінія, відступи 10×16, «Є незастосовані зміни» зліва, кнопки 28 праворуч). Вибрана сторінка дерева — кольору теми,
//! поки працюєш у дереві, і сіра, коли працюєш на сторінці (`nav.use`). Числа зняті з живого DOM (`rust/parity/web_settings.cjs`).
//! Дерево двох видів: з пошуком і групами, що складаються (загальні налаштування), і пласке з підписами груп (налаштування проєкту).

use super::*;
use std::collections::HashSet;

/// Ширина дерева разом із лінією справа.
pub(crate) const NAV_W: f32 = 236.0;
/// Рядок кнопок: лінія 1 + відступи 10 + кнопки 28 + 10.
pub(crate) const BAR_H: f32 = 49.0;
const CRUMB_H: f32 = 45.0;
const DLG_BG: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x33);

/// Група дерева: назва й сторінки (`id`, назва).
pub(crate) type Group = (&'static str, &'static [(&'static str, &'static str)]);

/// Що пам'ятає вікно: поточна сторінка, пошук, згорнуті групи, де зараз «робоче вікно» (дерево чи сторінка).
pub(crate) struct StNav {
    pub cur: &'static str,
    pub query: String,
    pub folded: HashSet<&'static str>,
    pub tree_use: bool,
}

impl StNav {
    pub(crate) fn new(cur: &'static str) -> Self {
        StNav { cur, query: String::new(), folded: HashSet::new(), tree_use: true }
    }
}

pub(crate) struct StShell<'a> {
    pub key: &'static str,
    /// Підпис вікна для читачів екрана й тестів («Налаштування проєкту»).
    pub aria: &'static str,
    /// Початок «крихт» перед назвою сторінки.
    pub crumb: String,
    pub height: f32,
    pub groups: &'a [Group],
    /// З пошуком і групами, що складаються; інакше пласке дерево з підписами груп.
    pub search: bool,
    pub dirty: bool,
    /// Esc уже раз натиснуто з незастосованими змінами: другий скасує їх.
    pub esc_armed: bool,
}

fn title_of(groups: &[Group], id: &str) -> &'static str {
    groups.iter().flat_map(|(_, p)| p.iter()).find(|(i, _)| *i == id).map_or("", |(_, t)| t)
}

/// Заливка й кільце вибраної сторінки в дереві: колір теми (30 % і 70 %), коли «робоче вікно» — дерево, інакше біле 15 % і 26 % — поверх фону дерева.
fn sel_colors(use_nav: bool) -> (Color32, Color32) {
    if use_nav {
        (theme::over(BG, accent(), 0.30), theme::over(BG, accent(), 0.70))
    } else {
        (theme::over(BG, Color32::WHITE, 0.15), theme::over(BG, Color32::WHITE, 0.26))
    }
}

/// Рядок дерева заввишки 28: наведення біле 7 %, вибраний — заливка з кільцем.
fn nav_item(ui: &mut egui::Ui, text: &str, pad: f32, selected: bool, use_nav: bool, mark: &str) -> egui::Response {
    let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, selected, text));
    if selected {
        let (fill, ring) = sel_colors(use_nav);
        ui.painter().rect_filled(r, CornerRadius::same(R2), fill);
        ui.painter().rect_stroke(r, CornerRadius::same(R2), Stroke::new(1.0_f32, ring), StrokeKind::Inside);
    } else if resp.hovered() {
        ui.painter().rect_filled(r, CornerRadius::same(R2), theme::over(BG, Color32::WHITE, 0.07));
    }
    let col = if selected && use_nav { Color32::WHITE } else { TEXT };
    let g = ui.painter().layout_no_wrap(text.to_string(), ip(12.5), col);
    let at = pos2(r.left() + pad, r.center().y - g.size().y / 2.0);
    // знайдене пошуком слово підсвічується (`mark`)
    if !mark.is_empty() {
        if let Some(i) = text.to_lowercase().find(mark) {
            let pre = ui.painter().layout_no_wrap(text[..i].to_string(), ip(12.5), col).size().x;
            let hit = ui.painter().layout_no_wrap(text[i..i + mark.len()].to_string(), ip(12.5), col).size().x;
            let m = Rect::from_min_size(pos2(at.x + pre, at.y), vec2(hit, g.size().y));
            ui.painter().rect_filled(m, CornerRadius::same(2), theme::over(BG, WARN, 0.35));
        }
    }
    ui.painter().galley(at, g, col);
    resp
}

impl StShell<'_> {
    /// Малює вікно. `page` малює вміст поточної сторінки; `bar` — кнопки рядка внизу (праворуч, справа наліво: головна першою). Повертає `true`, коли натиснуто Esc.
    pub(crate) fn show(self, ctx: &egui::Context, nav: &mut StNav, page: impl FnOnce(&mut egui::Ui, &'static str), bar: impl FnOnce(&mut egui::Ui)) -> bool {
        let screen = ctx.screen_rect();
        let w = 900.0_f32.min(screen.width() - 24.0).max(320.0);
        let h = self.height.min(screen.height() - 40.0 - 24.0).max(240.0);
        let frame = egui::Frame::new()
            .fill(DLG_BG)
            .stroke(Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)))
            .corner_radius(CornerRadius::same(12))
            .shadow(egui::epaint::Shadow { offset: [0, 24], blur: 70, spread: 0, color: Color32::from_black_alpha(153) })
            .inner_margin(egui::Margin::ZERO);
        let id = egui::Id::new(("st-dlg", self.key));
        let area = egui::Modal::default_area(id).anchor(Align2::CENTER_CENTER, vec2(0.0, 20.0));
        let mut sel = nav.cur;
        let mut query = std::mem::take(&mut nav.query);
        let mut use_nav = nav.tree_use;
        let mut folded = std::mem::take(&mut nav.folded);
        let resp = egui::Modal::new(id).area(area).backdrop_color(Color32::from_black_alpha(128)).frame(frame).show(ctx, |ui| {
            ui.set_min_size(vec2(w - 2.0, h - 2.0));
            ui.set_max_size(vec2(w - 2.0, h - 2.0));
            let full = ui.max_rect();
            let main_h = h - 2.0 - BAR_H;
            let nav_r = Rect::from_min_size(full.min, vec2(NAV_W - 1.0, main_h));
            let main_r = Rect::from_min_size(pos2(full.left() + NAV_W, full.top()), vec2(w - 2.0 - NAV_W, main_h));
            let bar_r = Rect::from_min_size(pos2(full.left(), full.top() + main_h), vec2(w - 2.0, BAR_H));
            // тло дерева й сторінки темніше за вікно; лінія між ними; верхні кути закруглені як у вікна
            ui.painter().rect_filled(nav_r, CornerRadius { nw: 11, ne: 0, sw: 0, se: 0 }, BG);
            ui.painter().rect_filled(main_r, CornerRadius { nw: 0, ne: 11, sw: 0, se: 0 }, BG);
            ui.painter().vline(nav_r.right() + 0.5, nav_r.y_range(), Stroke::new(1.0_f32, LINE));
            // рядок кнопок: лінія зверху
            ui.painter().hline(bar_r.x_range(), bar_r.top() + 0.5, Stroke::new(1.0_f32, LINE));

            // ---- дерево ----
            let mut n = ui.new_child(egui::UiBuilder::new().max_rect(nav_r).layout(egui::Layout::top_down(egui::Align::Min)));
            n.set_clip_rect(nav_r);
            let mut tree_top = nav_r.top();
            let mark = query.trim().to_lowercase();
            if self.search {
                let sb = Rect::from_min_size(pos2(nav_r.left() + 10.0, nav_r.top() + 10.0), vec2(NAV_W - 1.0 - 20.0, 30.0));
                n.painter().rect(sb, CornerRadius::same(R2), BG, Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                icons::paint(&n, Rect::from_center_size(pos2(sb.left() + 10.0 + 7.0, sb.center().y), vec2(14.0, 14.0)), "search", MUTE);
                let tr = Rect::from_min_max(pos2(sb.left() + 10.0 + 14.0 + 8.0, sb.top()), pos2(sb.right() - 10.0, sb.bottom()));
                let mut sui = n.new_child(egui::UiBuilder::new().max_rect(tr).layout(egui::Layout::left_to_right(egui::Align::Center)));
                let te = sui.add(egui::TextEdit::singleline(&mut query).frame(false).hint_text("Пошук налаштувань").desired_width(tr.width()).margin(egui::Margin::ZERO).font(ip(12.5)));
                te.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::TextEdit, true, "Пошук налаштувань"));
                if te.has_focus() {
                    n.painter().rect_stroke(sb, CornerRadius::same(R2), Stroke::new(1.0_f32, accent()), StrokeKind::Inside);
                }
                if te.gained_focus() || te.changed() {
                    use_nav = true;
                }
                tree_top = sb.bottom() + 10.0;
            }
            let tree_r = Rect::from_min_max(pos2(nav_r.left() + 8.0, tree_top + 2.0), pos2(nav_r.right() - 8.0, nav_r.bottom() - 10.0));
            let mut tui = n.new_child(egui::UiBuilder::new().max_rect(tree_r).layout(egui::Layout::top_down(egui::Align::Min)));
            tui.set_clip_rect(tree_r.expand2(vec2(8.0, 0.0)));
            let mark_ref = mark.as_str();
            egui::ScrollArea::vertical().id_salt(("st-tree", self.key)).auto_shrink([false, false]).show(&mut tui, |ui| {
                ui.set_width(tree_r.width());
                ui.spacing_mut().item_spacing.y = 1.0;
                let mut first = true;
                for (gname, pages) in self.groups {
                    let hits: Vec<&(&str, &str)> = pages.iter().filter(|(_, t)| mark_ref.is_empty() || t.to_lowercase().contains(mark_ref)).collect();
                    if hits.is_empty() {
                        continue;
                    }
                    if self.search {
                        // заголовок групи: стрілка 10, назва 12,5 вагою 600, відступи 9×8×4, клік складає групу
                        let (r, gr) = ui.allocate_exact_size(vec2(ui.available_width(), 30.5), Sense::click());
                        gr.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, *gname));
                        if gr.hovered() {
                            ui.painter().rect_filled(r, CornerRadius::same(R2), theme::over(BG, Color32::WHITE, 0.07));
                        }
                        let shut = folded.contains(gname) && mark_ref.is_empty();
                        let c = pos2(r.left() + 8.0 + 5.0, r.top() + 9.0 + 8.75);
                        let cr = Rect::from_center_size(c, vec2(10.0, 10.0));
                        icons::paint_rot(ui, cr, "caret", MUTE, if shut { -std::f32::consts::FRAC_PI_2 } else { 0.0 });
                        let g = ui.painter().layout_no_wrap((*gname).to_string(), ipw(12.5, 600), TEXT);
                        ui.painter().galley(pos2(r.left() + 8.0 + 10.0 + 6.0, r.top() + 9.0), g, TEXT);
                        if gr.clicked() && mark_ref.is_empty() && !folded.remove(gname) {
                            folded.insert(gname);
                        }
                        if shut {
                            continue;
                        }
                    } else {
                        // плаский підпис групи 12, приглушений, заввишки 16,8; перший має відступ зверху 4
                        if first {
                            ui.add_space(3.0);
                        }
                        let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 16.8), Sense::hover());
                        let g = ui.painter().layout_no_wrap((*gname).to_string(), ip(12.0), MUTE);
                        ui.painter().galley(pos2(r.left(), r.top() + (16.8 - g.size().y) / 2.0), g, MUTE);
                        let _ = first;
                    }
                    first = false;
                    for (pid, ptitle) in hits {
                        let on = *pid == sel;
                        let r = nav_item(ui, ptitle, if self.search { 26.0 } else { 10.0 }, on, use_nav, mark_ref);
                        if r.clicked() {
                            sel = pid;
                            use_nav = true;
                        }
                    }
                }
            });
            // пошук залишив поточну сторінку без збігу: перейти до першого збігу
            if !mark.is_empty() && !self.groups.iter().flat_map(|(_, p)| p.iter()).any(|(i, t)| *i == sel && t.to_lowercase().contains(&mark)) {
                if let Some((i, _)) = self.groups.iter().flat_map(|(_, p)| p.iter()).find(|(_, t)| t.to_lowercase().contains(&mark)) {
                    sel = i;
                }
            }

            // ---- сторінка ----
            let mut m = ui.new_child(egui::UiBuilder::new().max_rect(main_r).layout(egui::Layout::top_down(egui::Align::Min)));
            m.set_clip_rect(main_r);
            let crumb = Rect::from_min_size(main_r.min, vec2(main_r.width(), CRUMB_H));
            {
                // «Проєкт › Загальні»: 15/500, відступи 14×20×10, стрілка між частинами
                let mut x = crumb.left() + 20.0;
                let y = crumb.top() + 14.0 + 10.5;
                let parts = [self.crumb.clone(), title_of(self.groups, sel).to_string()];
                for (k, p) in parts.iter().enumerate() {
                    if p.is_empty() {
                        continue;
                    }
                    if k > 0 && !parts[0].is_empty() {
                        icons::paint(&m, Rect::from_center_size(pos2(x + 8.0 + 5.0, y), vec2(10.0, 10.0)), "right", MUTE);
                        x += 8.0 + 10.0 + 8.0;
                    }
                    let g = m.painter().layout_no_wrap(p.clone(), ipw(15.0, 500), TEXT);
                    let sz = g.size();
                    m.painter().galley(pos2(x, y - sz.y / 2.0), g, TEXT);
                    if k == 1 {
                        // підпис вікна для читачів екрана й тестів: «Налаштування проєкту»
                        let r = m.interact(Rect::from_min_size(pos2(crumb.left() + 20.0, y - sz.y / 2.0), vec2(x + sz.x - crumb.left() - 20.0, sz.y)), m.id().with("crumb"), Sense::hover());
                        r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, self.aria));
                    }
                    x += sz.x;
                }
            }
            let content_r = Rect::from_min_max(pos2(main_r.left() + 20.0, main_r.top() + CRUMB_H + 4.0), pos2(main_r.right() - 20.0, main_r.bottom()));
            let mut cui = m.new_child(egui::UiBuilder::new().max_rect(content_r).layout(egui::Layout::top_down(egui::Align::Min)));
            cui.set_clip_rect(Rect::from_min_max(pos2(main_r.left(), content_r.top()), main_r.max));
            // клік на сторінці переводить «робоче вікно» на неї
            let page_hit = ui.input(|i| i.pointer.primary_pressed() && i.pointer.interact_pos().is_some_and(|p| main_r.contains(p)));
            if page_hit {
                use_nav = false;
            }
            egui::ScrollArea::vertical().id_salt(("st-page", self.key, sel)).auto_shrink([false, false]).show(&mut cui, |ui| {
                ui.set_width(content_r.width());
                ui.spacing_mut().item_spacing = vec2(12.0, 12.0);
                page(ui, sel);
                ui.add_space(20.0);
            });

            // ---- рядок кнопок ----
            let mut b = ui.new_child(egui::UiBuilder::new().max_rect(bar_r.shrink2(vec2(16.0, 10.0))).layout(egui::Layout::right_to_left(egui::Align::Center)));
            b.spacing_mut().item_spacing.x = 8.0;
            bar(&mut b);
            if self.dirty {
                let g = ui.painter().layout_no_wrap(if self.esc_armed { "Є незастосовані зміни: Esc ще раз скасує їх" } else { "Є незастосовані зміни" }.to_string(), ip(12.0), WARN);
                ui.painter().galley(pos2(bar_r.left() + 16.0, bar_r.center().y - g.size().y / 2.0), g, WARN);
            }
        });
        nav.cur = sel;
        nav.query = query;
        nav.folded = folded;
        nav.tree_use = use_nav;
        resp.is_top_modal && !resp.any_popup_open && ctx.input(|i| i.key_pressed(egui::Key::Escape))
    }
}

// ---- будівельні блоки сторінок (`.st-sub`, `.hint`, `.grid`, `.achk`, `.acts.l`, `.st-warn`) ----

/// Підсказка під полем (`.hint`: 12, приглушена).
pub(crate) fn hint(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text).size(12.0).color(MUTE));
}

/// Підрозділ сторінки (`.st-sub`): заголовок 13/600, проміжок 8, знизу лінія й відступ 12 (крім останнього).
pub(crate) fn sub(ui: &mut egui::Ui, title: &str, last: bool, add: impl FnOnce(&mut egui::Ui)) {
    ui.scope(|ui| {
        ui.spacing_mut().item_spacing.y = 8.0;
        ui.label(RichText::new(title).font(ipw(13.0, 600)).color(TEXT));
        add(ui);
        if !last {
            ui.add_space(4.0);
            let (l, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
            ui.painter().hline(l.x_range(), l.center().y, Stroke::new(1.0_f32, LINE));
        }
    });
}

/// Рядок сітки `.grid` (1,4fr / 1fr, проміжок 12): підпис ліворуч, поле праворуч заввишки 30.
pub(crate) fn grid_row(ui: &mut egui::Ui, label: &str, add: impl FnOnce(&mut egui::Ui)) {
    let w = ui.available_width();
    let c1 = (w - 12.0) * 1.4 / 2.4;
    let c2 = w - 12.0 - c1;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 12.0;
        ui.allocate_ui_with_layout(vec2(c1, 30.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
            ui.set_width(c1);
            ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Wrap);
            ui.label(RichText::new(label).size(12.5).color(TEXT));
        });
        ui.allocate_ui_with_layout(vec2(c2, 30.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
            ui.set_width(c2);
            add(ui);
        });
    });
}

/// Ряд кнопок `.acts.l`: ліворуч, проміжок 8.
pub(crate) fn acts(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 8.0;
        add(ui);
    });
}

/// Смуга-попередження `.st-warn`: значок 22 («!»), жирний перший рядок і текст; `bad` — червона, інакше жовта.
pub(crate) fn warn_banner(ui: &mut egui::Ui, bad: bool, head: &str, text: &str) {
    // непрозорі кольори (прозорі різні бекенди змішують по-різному): заливка 13–14 % і кільце 60 % поверх фону сторінки
    let (bg, ring, dot) = if bad { (theme::over(BG, BAD, 0.13), theme::over(BG, BAD, 0.60), BAD) } else { (theme::over(BG, WARN, 0.14), theme::over(BG, WARN, 0.60), WARN) };
    let w = ui.available_width();
    let hg = ui.painter().layout(head.to_string(), ipw(12.5, 700), Color32::WHITE, w - 28.0 - 22.0 - 12.0 - 3.0);
    let tg = ui.painter().layout(text.to_string(), ip(12.5), TEXT, w - 28.0 - 22.0 - 12.0 - 3.0);
    let h = 12.0 + hg.size().y + tg.size().y + 12.0;
    let (r, _) = ui.allocate_exact_size(vec2(w, h.max(46.0)), Sense::hover());
    ui.painter().rect(r, CornerRadius::same(R3), bg, Stroke::new(1.0_f32, ring), StrokeKind::Inside);
    ui.painter().rect_filled(Rect::from_min_size(r.min + vec2(1.0, R3 as f32 / 2.0), vec2(3.0, r.height() - R3 as f32)), CornerRadius::ZERO, dot);
    let c = pos2(r.left() + 14.0 + 11.0, r.top() + 12.0 + 11.0);
    ui.painter().circle_filled(c, 11.0, dot);
    ui.painter().text(c, Align2::CENTER_CENTER, "!", ipw(14.0, 800), Color32::from_rgb(0x1b, 0x1c, 0x1f));
    let x = r.left() + 14.0 + 22.0 + 12.0;
    ui.painter().galley(pos2(x, r.top() + 12.0), hg.clone(), Color32::WHITE);
    ui.painter().galley(pos2(x, r.top() + 12.0 + hg.size().y), tg, TEXT);
}

/// Кнопка рядка внизу `.st-bar .btn`: 28 заввишки, відступи по 18 (ширина за текстом).
pub(crate) fn bar_button(ui: &mut egui::Ui, text: &str, primary: bool, enabled: bool) -> egui::Response {
    let g = ui.painter().layout_no_wrap(text.to_string(), ip(12.5), TEXT);
    let w = g.size().x + 36.0 + 2.0;
    let b = if primary {
        egui::Button::new(RichText::new(text).color(Color32::WHITE)).fill(accent_solid()).stroke(Stroke::new(1.0_f32, accent_hover()))
    } else {
        egui::Button::new(RichText::new(text).color(if enabled { TEXT } else { DIM }))
    };
    ui.add_enabled(enabled, b.min_size(vec2(w, 28.0)))
}

/// Поле вводу `.adlg .grid input`: заввишки 30, відступи 8, фон `--bg`, рамка `--line`, радіус 8.
pub(crate) fn input(ui: &mut egui::Ui, text: &mut String, hint: &str, width: f32) -> egui::Response {
    ui.scope(|ui| {
        ui.visuals_mut().extreme_bg_color = BG;
        let w = if width > 0.0 { width } else { ui.available_width() };
        ui.add(egui::TextEdit::singleline(text).hint_text(hint).desired_width(w).min_size(vec2(w, 30.0)).vertical_align(egui::Align::Center).margin(egui::Margin::symmetric(8, 0)).font(ip(12.5)))
    })
    .inner
}

/// Прапорець `.achk`: квадрат 14 кольору теми з пташкою, підпис через 8. Повертає відповідь, `changed()` — коли перемкнули.
pub(crate) fn check(ui: &mut egui::Ui, on: &mut bool, label: &str) -> egui::Response {
    let g = ui.painter().layout(label.to_string(), ip(12.5), TEXT, ui.available_width() - 14.0 - 8.0);
    let (r, mut resp) = ui.allocate_exact_size(vec2(ui.available_width().min(14.0 + 8.0 + g.size().x), g.size().y.max(21.0)), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, *on, label));
    if resp.clicked() {
        *on = !*on;
        resp.mark_changed();
    }
    layout::paint_check(ui, pos2(r.left() + 7.0, r.center().y), *on, resp.hovered());
    ui.painter().galley(pos2(r.left() + 22.0, r.center().y - g.size().y / 2.0), g, TEXT);
    resp
}

/// Перемикач-радіо: коло 16; вибране — кольору теми з білою точкою. Повертає відповідь; `clicked()` — коли вибрано.
pub(crate) fn radio(ui: &mut egui::Ui, current: &mut String, value: &str, label: &str, sub: Option<RichText>, enabled: bool) -> egui::Response {
    let on = current == value;
    let g = ui.painter().layout(label.to_string(), ip(12.5), if enabled { TEXT } else { DIM }, ui.available_width() - 24.0);
    let sg = sub.map(|t| ui.painter().layout_job(egui::text::LayoutJob::simple(t.text().to_string(), ip(12.0), MUTE, ui.available_width() - 24.0)));
    let h = g.size().y + sg.as_ref().map_or(0.0, |s| s.size().y);
    let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width().min(24.0 + g.size().x.max(sg.as_ref().map_or(0.0, |s| s.size().x))), h.max(21.0)), if enabled { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::RadioButton, enabled, on, label));
    let c = pos2(r.left() + 8.0, r.top() + 10.5);
    if on {
        ui.painter().circle_filled(c, 8.0, accent_solid());
        ui.painter().circle_filled(c, 3.2, Color32::WHITE);
    } else {
        ui.painter().circle(c, 7.5, BG, Stroke::new(1.0_f32, if resp.hovered() { TEXT } else { DIM }));
    }
    ui.painter().galley(pos2(r.left() + 24.0, r.top()), g.clone(), TEXT);
    if let Some(sg) = sg {
        ui.painter().galley(pos2(r.left() + 24.0, r.top() + g.size().y), sg, MUTE);
    }
    if enabled && resp.clicked() {
        *current = value.to_string();
    }
    resp
}

/// Повзунок відтінку `.theme-set input[type=range]`: доріжка 10 з веселкою, повзунок 18 (біле коло в кільці фону й кільце кольору теми). `0..=359`.
pub(crate) fn hue_slider(ui: &mut egui::Ui, hue: &mut f32) -> egui::Response {
    let w = ui.available_width();
    let (r, mut resp) = ui.allocate_exact_size(vec2(w, 18.0), Sense::click_and_drag());
    let (x0, x1) = (r.left() + 9.0, r.right() - 9.0);
    if let Some(p) = resp.interact_pointer_pos().filter(|_| resp.dragged() || resp.clicked()) {
        let v = ((p.x - x0) / (x1 - x0)).clamp(0.0, 1.0) * 359.0;
        if (v - *hue).abs() > 0.4 {
            *hue = v.round();
            resp.mark_changed();
        }
    }
    let stops = [(0xf0, 0x82, 0x8a), (0xe8, 0xa2, 0x4a), (0xb8, 0xb8, 0x4a), (0x58, 0xc4, 0x7a), (0x3f, 0xc4, 0xb8), (0x4f, 0xa8, 0xf0), (0x8e, 0x86, 0xf8), (0xc5, 0x8a, 0xe0), (0xf0, 0x82, 0x8a)];
    let (ty0, ty1) = (r.center().y - 5.0, r.center().y + 5.0);
    let mut mesh = egui::Mesh::default();
    for (i, (rr, gg, bb)) in stops.iter().enumerate() {
        let x = r.left() + (r.width() * i as f32 / (stops.len() - 1) as f32);
        let c = Color32::from_rgb(*rr, *gg, *bb);
        mesh.colored_vertex(pos2(x, ty0), c);
        mesh.colored_vertex(pos2(x, ty1), c);
        if i > 0 {
            let k = (i * 2) as u32;
            mesh.add_triangle(k - 2, k - 1, k);
            mesh.add_triangle(k - 1, k + 1, k);
        }
    }
    // закруглення країв доріжки (радіус 5): маскуємо кути тлом сторінки
    ui.painter().add(egui::Shape::mesh(mesh));
    for (x, left) in [(r.left(), true), (r.right(), false)] {
        let corner = Rect::from_min_max(pos2(if left { x } else { x - 5.0 }, ty0), pos2(if left { x + 5.0 } else { x }, ty1));
        ui.painter().rect_filled(corner, CornerRadius::ZERO, BG);
        ui.painter().circle_filled(pos2(if left { x + 5.0 } else { x - 5.0 }, r.center().y), 5.0, Color32::from_rgb(0xf0, 0x82, 0x8a));
    }
    let tx = x0 + (*hue / 359.0) * (x1 - x0);
    let c = pos2(tx, r.center().y);
    ui.painter().circle_filled(c, 11.0, accent());
    ui.painter().circle_filled(c, 9.0, BG);
    ui.painter().circle_filled(c, 6.0, Color32::WHITE);
    resp
}

/// Числове поле як `.adlg .grid input`: заввишки 30, фон `--bg`, рамка `--line`.
pub(crate) fn number(ui: &mut egui::Ui, dv: egui::DragValue<'_>, width: f32) -> egui::Response {
    ui.scope(|ui| {
        let w = &mut ui.visuals_mut().widgets;
        for st in [&mut w.inactive, &mut w.hovered, &mut w.active] {
            st.weak_bg_fill = BG;
            st.bg_fill = BG;
            st.bg_stroke = Stroke::new(1.0_f32, LINE);
            st.corner_radius = CornerRadius::same(R2);
        }
        ui.add_sized(vec2(width, 30.0), dv)
    })
    .inner
}
