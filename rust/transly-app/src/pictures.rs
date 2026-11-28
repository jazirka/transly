//! Картинки гри (іконка, обличчя, ворог, картинка) рядка: розділ «Картинки» у правій колонці, мініатюра в таблиці й повноекранний перегляд зі збільшенням.
//! За макетами власника (4 + 6 + 7 + 9): постійне місце справа, мініатюри з бейджем і рамкою кольору за типом (лице — фіолетова, іконка — жовта, ворог — червона,
//! картинка — синя), велике прев'ю на шахівниці, «×2» на місці й «⤢» на весь екран. Обведення одне: плитка має лише свою рамку кольору типу (активна товща),
//! прев'ю — без власної рамки (її дає картка розділу). Масштаб без згладжування (текстури `NEAREST`), для піксельної графіки — цілими кратними.

use super::*;
use crate::layout::empty_note;
use state::Pic;

/// Стан повноекранного перегляду: яка картинка рядка, масштаб (0 — вмістити), фон (0 шахівниця, 1 темний, 2 світлий).
#[derive(Clone, Copy, Debug)]
pub(crate) struct PicView {
    pub idx: usize,
    pub zoom: f32,
    pub bg: u8,
}

const TEX_BG: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x33);
const TEX_BG2: Color32 = Color32::from_rgb(0x34, 0x36, 0x3c);

/// Колір рамки й бейджа за типом картинки.
fn kind_color(p: &Pic) -> Color32 {
    match p {
        Pic::Icon { .. } => WARN,
        Pic::Face { .. } => VIOLET,
        Pic::Enemy { .. } => BAD,
        Pic::Picture { .. } => INFO,
    }
}

fn kind_name(p: &Pic) -> &'static str {
    match p {
        Pic::Icon { .. } => "Іконка",
        Pic::Face { .. } => "Лице",
        Pic::Enemy { .. } => "Ворог",
        Pic::Picture { .. } => "Картинка",
    }
}

/// Підпис: «Іконка 5 · Меч», «Лице · Actor1 · 0», «Ворог · Слиз», «Картинка · titles1».
fn pic_title(p: &Pic) -> String {
    match p {
        Pic::Icon { n, label } => if label.is_empty() { format!("Іконка {n}") } else { format!("Іконка {n} · {label}") },
        Pic::Face { name, index, .. } => format!("Лице · {name} · {index}"),
        Pic::Enemy { name, label } => format!("Ворог · {}", if label.is_empty() { name } else { label }),
        Pic::Picture { name, .. } => format!("Картинка · {name}"),
    }
}

/// Шахівниця під прозорістю: клітинки 10, світліші на `TEX_BG2`.
pub(crate) fn paint_checker(painter: &egui::Painter, rect: Rect, cell: f32) {
    painter.rect_filled(rect, CornerRadius::same(6), TEX_BG);
    let p = painter.with_clip_rect(rect);
    let (nx, ny) = ((rect.width() / cell).ceil() as i32, (rect.height() / cell).ceil() as i32);
    for y in 0..ny {
        for x in 0..nx {
            if (x + y) % 2 == 1 {
                p.rect_filled(Rect::from_min_size(rect.min + vec2(x as f32 * cell, y as f32 * cell), vec2(cell, cell)), CornerRadius::ZERO, TEX_BG2);
            }
        }
    }
}

/// Масштаб, щоб картинка `size` вмістилась у `boxs`: збільшення цілими кратними (піксель лишається квадратним), зменшення дробове.
fn fit_scale(size: egui::Vec2, boxs: egui::Vec2) -> f32 {
    let k = (boxs.x / size.x.max(1.0)).min(boxs.y / size.y.max(1.0));
    if k >= 1.0 { k.floor().max(1.0) } else { k.max(0.01) }
}

/// Малює текстуру в `rect` по центру, вмістивши без згладжування.
fn paint_tex(painter: &egui::Painter, rect: Rect, t: &egui::TextureHandle) {
    let sz = t.size_vec2();
    let k = fit_scale(sz, rect.size());
    let r = Rect::from_center_size(rect.center(), sz * k);
    painter.image(t.id(), r, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
}

/// Мініатюра в таблиці (вона ж прапорець вибору рядка): темна квадратна плитка з єдиною рамкою кольору типу.
pub(crate) fn paint_table_thumb(ui: &egui::Ui, rect: Rect, t: &egui::TextureHandle, color: Color32) {
    ui.painter().rect(rect, CornerRadius::same(5), Color32::from_rgb(0x17, 0x18, 0x1a), Stroke::new(1.5_f32, color), StrokeKind::Inside);
    paint_tex(&ui.painter().with_clip_rect(rect.shrink(2.0)), rect.shrink(3.0), t);
}

impl App {
    /// Картинки вибраного рядка, що вдалося завантажити (картинка може бути відсутня в теці гри).
    pub(crate) fn current_pics(&mut self, ctx: &egui::Context) -> Vec<(Pic, egui::TextureHandle)> {
        let (Some(f), Some(r)) = (self.st.file, self.st.row) else { return Vec::new() };
        self.pics_with_textures(ctx, f, r)
    }

    pub(crate) fn pics_with_textures(&mut self, ctx: &egui::Context, f: usize, r: usize) -> Vec<(Pic, egui::TextureHandle)> {
        self.st.pics_of(f, r).into_iter().filter_map(|p| self.pic_texture(ctx, &p).map(|t| (p, t))).collect()
    }

    pub(crate) fn pic_kind_color(p: &Pic) -> Color32 {
        kind_color(p)
    }

    /// Розділ «Картинки» вмикається сам (раз за сеанс на файл), коли вибрано рядок із картинками, щоб їх було видно без пошуку кнопки.
    pub(crate) fn auto_pictures(&mut self, ctx: &egui::Context, mi: usize) {
        if self.right_secs[mi][3] {
            return;
        }
        let (Some(f), Some(r)) = (self.st.file, self.st.row) else { return };
        if self.pics_auto.contains(&(f, mi)) || self.st.pics_of(f, r).is_empty() {
            return;
        }
        if !self.pics_with_textures(ctx, f, r).is_empty() {
            self.pics_auto.insert((f, mi));
            self.right_secs[mi][3] = true;
        }
    }

    /// Кнопки заголовка розділу: «×2» (збільшити на місці) і «⤢» (на весь екран).
    pub(crate) fn pictures_header_buttons(&mut self, ui: &mut egui::Ui, h: Rect) {
        let has = !self.current_pics(&ui.ctx().clone()).is_empty();
        let open = {
            let c = pos2(h.right() - 20.0 - 28.0, h.center().y);
            let r = layout_mini(ui, c, "expand", "pic-expand", has);
            r.on_hover_text("На весь екран (Enter)").clicked()
        };
        let r = Rect::from_center_size(pos2(h.right() - 20.0 - 56.0, h.center().y), vec2(24.0, 24.0));
        let resp = ui.interact(r, ui.id().with("pic-inline"), if has { Sense::click() } else { Sense::hover() });
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, has, if self.pic_inline { "Повернути розмір картинки" } else { "Збільшити картинку на місці" }));
        if has && resp.hovered() {
            ui.painter().rect_filled(r, CornerRadius::same(8), GHOST_HOVER);
        }
        ui.painter().text(r.center(), Align2::CENTER_CENTER, if self.pic_inline { "×1" } else { "×2" }, ipw(11.0, 600), if has { if resp.hovered() { TEXT } else { MUTE } } else { DIM });
        if has && resp.on_hover_text(if self.pic_inline { "Повернути розмір" } else { "Збільшити на місці" }).clicked() {
            self.pic_inline = !self.pic_inline;
        }
        if open && has {
            self.pic_view = Some(PicView { idx: self.pic_sel, zoom: 0.0, bg: 0 });
        }
    }

    /// Тіло розділу «Картинки»: прев'ю на шахівниці (без власної рамки), підпис з типом, назвою й розміром, плитки-мініатюри.
    pub(crate) fn pictures_body(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        if self.st.row.is_none() {
            empty_note(ui, "Оберіть рядок");
            return;
        }
        let items = self.current_pics(&ctx);
        if items.is_empty() {
            empty_note(ui, "У цього рядка немає картинок");
            return;
        }
        if self.pic_sel >= items.len() {
            self.pic_sel = 0;
        }
        let sel = self.pic_sel;
        let mut pick: Option<usize> = None;
        let mut open = false;
        egui::ScrollArea::vertical().id_salt("picscroll").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin::same(10)).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 8.0;
                let w = ui.available_width();
                let (pr, presp) = ui.allocate_exact_size(vec2(w, if self.pic_inline { 208.0 } else { 136.0 }), Sense::click());
                presp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Відкрити картинку на весь екран"));
                paint_checker(ui.painter(), pr, 10.0);
                let (p, t) = &items[sel];
                paint_tex(&ui.painter().with_clip_rect(pr), pr.shrink(6.0), t);
                let sz = t.size_vec2();
                let sg = ui.painter().layout_no_wrap(format!("{}×{}", sz.x as u32, sz.y as u32), mp(10.5), MUTE);
                let br = Rect::from_min_size(pos2(pr.left() + 6.0, pr.bottom() - sg.size().y - 8.0), sg.size() + vec2(10.0, 3.0));
                ui.painter().rect_filled(br, CornerRadius::same(4), Color32::from_rgba_unmultiplied(20, 21, 23, 205));
                ui.painter().galley(br.min + vec2(5.0, 1.5), sg, MUTE);
                if presp.on_hover_cursor(egui::CursorIcon::ZoomIn).clicked() {
                    open = true;
                }
                ui.label(RichText::new(pic_title(p)).font(ipw(12.0, 500)).color(TEXT));
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = vec2(6.0, 6.0);
                    for (i, (p, t)) in items.iter().enumerate() {
                        let sz = t.size_vec2();
                        let wide = sz.x > sz.y * 1.3;
                        let (r, resp) = ui.allocate_exact_size(vec2(if wide { 66.0 } else { 44.0 }, 44.0), Sense::click());
                        resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, i == sel, format!("Показати: {}", pic_title(p))));
                        let col = kind_color(p);
                        // плитка: шахівниця, одна рамка кольору типу (активна товща), бейдж типу в куті
                        paint_checker(ui.painter(), r, 8.0);
                        paint_tex(&ui.painter().with_clip_rect(r), r.shrink(5.0), t);
                        ui.painter().rect_stroke(r, CornerRadius::same(6), Stroke::new(if i == sel { 2.5_f32 } else { 1.5_f32 }, col), StrokeKind::Inside);
                        let bg = ui.painter().layout_no_wrap(kind_name(p).to_uppercase(), ipw(8.0, 700), Color32::from_rgb(0x12, 0x13, 0x0f));
                        let bb = Rect::from_min_size(r.min + vec2(1.0, 1.0), bg.size() + vec2(7.0, 1.0));
                        ui.painter().rect_filled(bb, CornerRadius { nw: 5, ne: 0, sw: 0, se: 5 }, col);
                        ui.painter().galley(bb.min + vec2(3.5, 0.5), bg, Color32::PLACEHOLDER);
                        if resp.clicked() {
                            pick = Some(i);
                        }
                    }
                });
            });
        });
        if let Some(i) = pick {
            self.pic_sel = i;
        }
        if open {
            self.pic_view = Some(PicView { idx: self.pic_sel, zoom: 0.0, bg: 0 });
        }
    }

    /// Розділ «Картинки» у «Редагуванні»: плитки по три в ряд (шахівниця, картинка, кольоровий бейдж типу в куті), підказка внизу; клік відкриває на весь екран.
    pub(crate) fn pictures_grid(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        if self.st.row.is_none() {
            empty_note(ui, "Оберіть рядок");
            return;
        }
        let items = self.current_pics(&ctx);
        if items.is_empty() {
            empty_note(ui, "У цього рядка немає картинок");
            return;
        }
        let mut open: Option<usize> = None;
        egui::ScrollArea::vertical().id_salt("picgrid").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(8.0, 8.0);
                let gap = 8.0_f32;
                let w = ((ui.available_width() - 2.0 * gap) / 3.0).floor();
                let h = (w * 0.86).round();
                for chunk in items.chunks(3).enumerate() {
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = gap;
                        for (j, (p, t)) in chunk.1.iter().enumerate() {
                            let i = chunk.0 * 3 + j;
                            let (r, resp) = ui.allocate_exact_size(vec2(w, h), Sense::click());
                            resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Відкрити: {}", pic_title(p))));
                            let resp = resp.on_hover_text(pic_title(p)).on_hover_cursor(egui::CursorIcon::PointingHand);
                            paint_checker(ui.painter(), r, 8.0);
                            paint_tex(&ui.painter().with_clip_rect(r), r.shrink2(vec2(6.0, 8.0)).translate(vec2(0.0, 4.0)), t);
                            ui.painter().rect_stroke(r, CornerRadius::same(6), Stroke::new(1.0_f32, if resp.hovered() { kind_color(p) } else { LINE }), StrokeKind::Inside);
                            let col = kind_color(p);
                            let bg = ui.painter().layout_no_wrap(kind_name(p).to_uppercase(), ipw(9.0, 700), Color32::from_rgb(0x12, 0x13, 0x0f));
                            let bb = Rect::from_min_size(r.min + vec2(1.0, 1.0), bg.size() + vec2(10.0, 4.0));
                            ui.painter().rect_filled(bb, CornerRadius { nw: 5, ne: 0, sw: 0, se: 6 }, col);
                            ui.painter().galley(bb.min + vec2(5.0, 2.0), bg, Color32::PLACEHOLDER);
                            if resp.clicked() {
                                open = Some(i);
                            }
                        }
                    });
                }
                ui.add_space(4.0);
                ui.label(RichText::new("Клік по плитці відкриває велике прев’ю.").font(ip(12.0)).color(MUTE));
            });
        });
        if let Some(i) = open {
            self.pic_sel = i;
            self.pic_view = Some(PicView { idx: i, zoom: 0.0, bg: 0 });
        }
    }

    /// Повноекранний перегляд: стрілки й ←/→ листають картинки рядка, «+», «−», колесо, ×1 ×2 ×4 ×8 міняють масштаб, «Вмістити», фон, Esc закриває.
    pub(crate) fn pic_viewer(&mut self, ctx: &egui::Context) {
        let Some(mut v) = self.pic_view else { return };
        let items = self.current_pics(ctx);
        if items.is_empty() {
            self.pic_view = None;
            return;
        }
        v.idx = v.idx.min(items.len() - 1);
        let screen = ctx.screen_rect();
        let (mut close, mut step) = (false, 0i32);
        let mut zoom_to: Option<f32> = None;
        // колесо міняє масштаб, а не прокручує: забираємо його до області прокручування
        let wheel = ctx.input_mut(|i| std::mem::take(&mut i.smooth_scroll_delta).y);
        let stage_h = screen.height() - 46.0 - 46.0;
        let stage_w = screen.width();
        let (t_idx, tex) = (v.idx, items[v.idx].1.clone());
        let sz = tex.size_vec2();
        let fit = fit_scale(sz, vec2(stage_w - 40.0, stage_h - 40.0));
        let k = if v.zoom <= 0.0 { fit } else { v.zoom };
        let id = egui::Id::new("pic-viewer");
        let area = egui::Modal::default_area(id).anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0));
        let stage_col = if v.bg == 2 { Color32::from_rgb(0xe9, 0xec, 0xf1) } else { Color32::from_rgb(0x0f, 0x10, 0x12) };
        let resp = egui::Modal::new(id).area(area).backdrop_color(Color32::from_rgb(0x0b, 0x0c, 0x0e)).frame(egui::Frame::NONE).show(ctx, |ui| {
            dialog::dialog_style(ui);
            ui.set_min_size(screen.size());
            ui.set_max_size(screen.size());
            let full = ui.max_rect();
            let top = Rect::from_min_size(full.min, vec2(full.width(), 46.0));
            let foot = Rect::from_min_max(pos2(full.left(), full.bottom() - 46.0), full.max);
            let stage = Rect::from_min_max(pos2(full.left(), top.bottom()), pos2(full.right(), foot.top()));
            ui.painter().rect_filled(top, CornerRadius::ZERO, Color32::from_rgb(0x0b, 0x0c, 0x0e));
            ui.painter().hline(top.x_range(), top.bottom() - 0.5, Stroke::new(1.0_f32, LINE));
            ui.painter().rect_filled(stage, CornerRadius::ZERO, stage_col);
            ui.painter().rect_filled(foot, CornerRadius::ZERO, Color32::from_rgb(0x0b, 0x0c, 0x0e));
            ui.painter().hline(foot.x_range(), foot.top() + 0.5, Stroke::new(1.0_f32, LINE));
            // зображення (за потреби з прокручуванням, якщо більше за сцену)
            let img = sz * k;
            let mut sui = ui.new_child(egui::UiBuilder::new().max_rect(stage));
            sui.set_clip_rect(stage);
            egui::ScrollArea::both().id_salt("picstage").auto_shrink([false; 2]).show(&mut sui, |ui| {
                let content = vec2(img.x.max(stage.width()), img.y.max(stage.height()));
                let (rect, _) = ui.allocate_exact_size(content, Sense::hover());
                let ir = Rect::from_center_size(rect.center(), img);
                if v.bg == 0 {
                    paint_checker(ui.painter(), ir, 16.0);
                }
                ui.painter().image(tex.id(), ir, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
            });
            // верхня смуга: назва, розмір, фон, закрити (ліворуч від кнопок вікна)
            let right_edge = full.right() - winchrome::WCTL_W - 12.0;
            let title = pic_title(&items[t_idx].0);
            ui.painter().text(pos2(top.left() + 16.0, top.center().y), Align2::LEFT_CENTER, &title, ipw(13.0, 500), TEXT);
            let tw = ui.painter().layout_no_wrap(title, ipw(13.0, 500), TEXT).size().x;
            ui.painter().text(pos2(top.left() + 16.0 + tw + 12.0, top.center().y), Align2::LEFT_CENTER, format!("{}×{} px · ×{} · {} з {}", sz.x as u32, sz.y as u32, (k * 100.0).round() / 100.0, t_idx + 1, items.len()), mp(11.0), MUTE);
            let mut x = right_edge;
            let btn = |ui: &mut egui::Ui, x: &mut f32, label: &str, on: bool| -> egui::Response {
                let g = ui.painter().layout_no_wrap(label.to_string(), ip(12.0), TEXT);
                let w = g.size().x + 20.0;
                *x -= w;
                let r = Rect::from_min_size(pos2(*x, top.center().y - 12.0), vec2(w, 24.0));
                let resp = ui.interact(r, ui.id().with(("pvb", label)), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, on, label));
                let fill = if on { theme::over(Color32::from_rgb(0x0b, 0x0c, 0x0e), accent(), 0.25) } else if resp.hovered() { Color32::from_white_alpha(18) } else { Color32::TRANSPARENT };
                ui.painter().rect(r, CornerRadius::same(8), fill, Stroke::new(1.0_f32, if on { accent() } else { Color32::from_rgb(0x4a, 0x4d, 0x54) }), StrokeKind::Inside);
                ui.painter().galley(pos2(r.left() + 10.0, r.center().y - g.size().y / 2.0), g, TEXT);
                *x -= 6.0;
                resp
            };
            if btn(ui, &mut x, "Закрити (Esc)", false).clicked() {
                close = true;
            }
            x -= 12.0;
            for (b, label) in [(2u8, "Світлий"), (1, "Темний"), (0, "Шахівниця")] {
                if btn(ui, &mut x, label, v.bg == b).clicked() {
                    v.bg = b;
                }
            }
            // стрілки з боків
            if items.len() > 1 {
                for (dir, lx, lab) in [(-1, stage.left() + 14.0, "Попередня картинка"), (1, stage.right() - 54.0, "Наступна картинка")] {
                    let r = Rect::from_min_size(pos2(lx, stage.center().y - 28.0), vec2(40.0, 56.0));
                    let resp = ui.interact(r, ui.id().with(("pva", dir)), Sense::click());
                    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, lab));
                    ui.painter().rect(r, CornerRadius::same(10), if resp.hovered() { Color32::from_rgba_unmultiplied(40, 42, 46, 235) } else { Color32::from_rgba_unmultiplied(20, 21, 23, 215) }, Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)), StrokeKind::Inside);
                    icons::paint(ui, Rect::from_center_size(r.center(), vec2(18.0, 18.0)), if dir < 0 { "left" } else { "right" }, TEXT);
                    if resp.clicked() {
                        step = dir;
                    }
                }
            }
            // нижня смуга: −, %, +, ×1 ×2 ×4 ×8, Вмістити
            let mut fx = foot.center().x - 210.0;
            let fb = |ui: &mut egui::Ui, fx: &mut f32, label: &str, on: bool| -> egui::Response {
                let g = ui.painter().layout_no_wrap(label.to_string(), ip(12.0), TEXT);
                let w = (g.size().x + 20.0).max(30.0);
                let r = Rect::from_min_size(pos2(*fx, foot.center().y - 12.0), vec2(w, 24.0));
                *fx += w + 6.0;
                let resp = ui.interact(r, ui.id().with(("pvf", label)), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, on, label));
                let fill = if on { theme::over(Color32::from_rgb(0x0b, 0x0c, 0x0e), accent(), 0.25) } else if resp.hovered() { Color32::from_white_alpha(18) } else { Color32::TRANSPARENT };
                ui.painter().rect(r, CornerRadius::same(8), fill, Stroke::new(1.0_f32, if on { accent() } else { Color32::from_rgb(0x4a, 0x4d, 0x54) }), StrokeKind::Inside);
                ui.painter().galley(pos2(r.center().x - g.size().x / 2.0, r.center().y - g.size().y / 2.0), g, TEXT);
                resp
            };
            if fb(ui, &mut fx, "−", false).clicked() {
                zoom_to = Some((k / 1.5).max(0.1));
            }
            let pct = ui.painter().layout_no_wrap(format!("{}%", (k * 100.0).round()), mp(12.0), MUTE);
            ui.painter().galley(pos2(fx + 4.0, foot.center().y - pct.size().y / 2.0), pct, MUTE);
            fx += 64.0;
            if fb(ui, &mut fx, "+", false).clicked() {
                zoom_to = Some((k * 1.5).min(64.0));
            }
            fx += 8.0;
            for z in [1.0_f32, 2.0, 4.0, 8.0] {
                if fb(ui, &mut fx, &format!("×{z}"), (v.zoom - z).abs() < 0.001).clicked() {
                    zoom_to = Some(z);
                }
            }
            fx += 8.0;
            if fb(ui, &mut fx, "Вмістити", v.zoom <= 0.0).clicked() {
                zoom_to = Some(0.0);
            }
        });
        // клавіші й колесо
        let (esc, left, right, plus, minus, zero) = ctx.input_mut(|i| {
            (
                i.consume_key(egui::Modifiers::NONE, egui::Key::Escape),
                i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowLeft),
                i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowRight),
                i.consume_key(egui::Modifiers::NONE, egui::Key::Plus) || i.consume_key(egui::Modifiers::NONE, egui::Key::Equals),
                i.consume_key(egui::Modifiers::NONE, egui::Key::Minus),
                i.consume_key(egui::Modifiers::NONE, egui::Key::Num0),
            )
        });
        if resp.is_top_modal && esc {
            close = true;
        }
        if left {
            step = -1;
        } else if right {
            step = 1;
        }
        if plus {
            zoom_to = Some((k * 1.5).min(64.0));
        } else if minus {
            zoom_to = Some((k / 1.5).max(0.1));
        } else if zero {
            zoom_to = Some(0.0);
        }
        if wheel.abs() > 0.5 && ctx.input(|i| i.pointer.hover_pos()).is_some_and(|p| p.y > 46.0 && p.y < screen.bottom() - 46.0) {
            zoom_to = Some(if wheel > 0.0 { (k * 1.15).min(64.0) } else { (k / 1.15).max(0.1) });
        }
        if let Some(z) = zoom_to {
            v.zoom = z;
        }
        if step != 0 {
            v.idx = (v.idx as i32 + step).rem_euclid(items.len() as i32) as usize;
            v.zoom = 0.0;
            self.pic_sel = v.idx;
        }
        self.pic_view = if close { None } else { Some(v) };
    }
}

/// Мініатюрна кнопка-значок заголовка (24×24): неактивна, коли нічого відкривати.
fn layout_mini(ui: &mut egui::Ui, center: egui::Pos2, name: &str, id: &str, enabled: bool) -> egui::Response {
    let r = Rect::from_center_size(center, vec2(24.0, 24.0));
    let resp = ui.interact(r, ui.id().with(id), if enabled { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, enabled, "Картинки на весь екран"));
    if enabled && resp.hovered() {
        ui.painter().rect_filled(r, CornerRadius::same(8), GHOST_HOVER);
    }
    icons::paint(ui, Rect::from_center_size(center, vec2(14.0, 14.0)), name, if !enabled { DIM } else if resp.hovered() { TEXT } else { MUTE });
    resp
}
