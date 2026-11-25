//! Оболонка за виміряними розмірами старого застосунку (знімки й computed style справжнього `app/` у браузері): розміри в пунктах = CSS-пікселі.
//! Верх 40, смужка значків 34, картки з заокругленням 12 і рамкою «біле 16 %», проміжки 6; дерево й список рядків 300, центр —
//! решта, права колонка 350 зі смужкою значків 34; таблиця: рядки 34, шапка 26; редагування: поле перекладу з нижньою панеллю.

use super::*;
use state::Pic;

const CARD_R: u8 = 12;
/// Виділення (біле 15 % на тлі картки) і рамка картки (біле 16 %) суцільними кольорами: без прозорості, щоб рендер у тестах і у вікні збігався.
const SEL_GRAY: Color32 = Color32::from_rgb(64, 64, 67);
const CARD_LINE: Color32 = Color32::from_rgb(66, 67, 70);
const ROW_H: f32 = 34.0;

/// Картка оболонки з відступами зліва й справа (проміжок між картками 6).
pub(crate) fn card_lr(left: i8, right: i8) -> egui::Frame {
    egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, CARD_LINE)).corner_radius(CornerRadius::same(CARD_R)).outer_margin(egui::Margin { left, right, top: 0, bottom: 6 }).inner_margin(egui::Margin::ZERO)
}

/// Заокруглення верху картки (всередині рамки: 11).
pub(crate) fn card_top() -> CornerRadius {
    CornerRadius { nw: CARD_R - 1, ne: CARD_R - 1, sw: 0, se: 0 }
}

/// Тонка кнопка-піктограма 24×24 (⋮, —, ✕): повертає відповідь.
fn mini_icon(ui: &mut egui::Ui, center: egui::Pos2, name: &str, id: &str) -> egui::Response {
    let r = Rect::from_center_size(center, vec2(24.0, 24.0));
    let resp = ui.interact(r, ui.id().with(id), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(r, CornerRadius::same(8), GHOST_HOVER);
    }
    icons::paint(ui, Rect::from_center_size(center, vec2(14.0, 14.0)), name, if resp.hovered() { TEXT } else { MUTE });
    resp
}

/// Заголовок картки (`.ph`): великі літери 12 і, за потреби, підпис (назва файлу). Кнопок у ньому немає: ⋮ і «—» зі знімка нічого не робили.
fn card_head(ui: &mut egui::Ui, title: &str, sub: Option<&str>) {
    let (h, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
    ui.painter().rect_filled(h, card_top(), PANEL);
    ui.painter().hline(h.x_range(), h.bottom(), Stroke::new(1.0_f32, LINE));
    let g = ui.painter().layout_no_wrap(title.to_uppercase(), ip(12.0), MUTE);
    let tw = g.size().x;
    ui.painter().galley(pos2(h.left() + 10.0, h.center().y - g.size().y / 2.0), g, MUTE);
    if let Some(s) = sub {
        ui.painter().text(pos2(h.left() + 10.0 + tw + 10.0, h.center().y), Align2::LEFT_CENTER, s, ip(12.0), TEXT);
    }
}

/// Прапорець 14×14 (як у старому): рамка, при відміченні заливка кольору теми й пташка.
fn paint_check(ui: &egui::Ui, c: egui::Pos2, on: bool, hover: bool) {
    let r = Rect::from_center_size(c, vec2(14.0, 14.0));
    ui.painter().rect_filled(r, CornerRadius::same(4), if on { accent_solid() } else { BG });
    ui.painter().rect_stroke(r, CornerRadius::same(4), Stroke::new(1.0_f32, if on { accent_solid() } else if hover { TEXT } else { MUTE }), StrokeKind::Inside);
    if on {
        let p = Stroke::new(1.6_f32, Color32::WHITE);
        ui.painter().line_segment([pos2(c.x - 3.5, c.y), pos2(c.x - 1.0, c.y + 2.8)], p);
        ui.painter().line_segment([pos2(c.x - 1.0, c.y + 2.8), pos2(c.x + 3.8, c.y - 3.0)], p);
    }
}

/// Ліва колонка 306 (картка 300 + проміжок 6): картку малюємо самі, бо рамка панелі egui додає до ширини поля й рамку й обрізає її праворуч.
fn left_card(ctx: &egui::Context, id: &'static str, add: impl FnOnce(&mut egui::Ui)) {
    egui::SidePanel::left(id).exact_width(306.0).resizable(false).show_separator_line(false).frame(egui::Frame::new()).show(ctx, |ui| {
        let full = ui.max_rect();
        let rect = Rect::from_min_max(pos2(full.left() + 6.0, full.top()), pos2(full.right(), full.bottom() - 6.0));
        let mut cui = ui.new_child(egui::UiBuilder::new().max_rect(rect));
        card_lr(0, 0).outer_margin(egui::Margin::ZERO).show(&mut cui, |ui| {
            ui.set_min_height(rect.height() - 2.0);
            ui.set_max_height(rect.height() - 2.0);
            add(ui);
        });
    });
}

impl App {
    // ------------------------------------------------------------------ смужка значків
    pub(crate) fn strip(&mut self, ctx: &egui::Context) {
        let edit = self.focus && !self.scene_mode;
        egui::SidePanel::left("strip").exact_width(34.0).resizable(false).show_separator_line(false).frame(egui::Frame::new().fill(GROUND)).show(ctx, |ui| {
            let groups: Vec<Vec<(usize, &str, &str)>> = if self.scene_mode {
                vec![vec![(0, "files", "Файли гри")], vec![(2, "scene", "Сцени файлу")], vec![(3, "book", "Пов’язане з рядком")]]
            } else if edit {
                vec![vec![(0, "files", "Файли гри")], vec![(1, "rows", "Рядки файлу"), (2, "scene", "Сцени файлу")], vec![(3, "book", "Пов’язане з рядком")]]
            } else {
                vec![vec![(0, "files", "Файли гри")], vec![(3, "book", "Пов’язане з рядком")]]
            };
            let mut y = ui.max_rect().top() + 8.0;
            let x = ui.max_rect().left() + 6.0;
            for (gi, g) in groups.iter().enumerate() {
                if gi > 0 {
                    ui.painter().hline((x + 5.0)..=(x + 23.0), y + 3.0, Stroke::new(1.0_f32, LINE));
                    y += 7.0;
                }
                for (idx, ic, tip) in g {
                    let r = Rect::from_min_size(pos2(x, y), vec2(28.0, 28.0));
                    let resp = ui.interact(r, ui.id().with(("strip", *idx)), Sense::click());
                    let on = *idx == self.rail || (!edit && !self.scene_mode && *idx == 0 && self.rail != 3);
                    let tint = over_color(SEL_GRAY, accent_solid(), 0.12);
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Панель: {tip}")));
                    if on {
                        ui.painter().rect_filled(r, CornerRadius::same(8), tint);
                    } else if resp.hovered() {
                        ui.painter().rect_filled(r, CornerRadius::same(8), GHOST_HOVER);
                    }
                    icons::paint(ui, Rect::from_center_size(r.center(), vec2(17.0, 17.0)), ic, if on { Color32::WHITE } else { MUTE });
                    if resp.on_hover_text(*tip).clicked() {
                        self.rail = *idx;
                    }
                    y += 34.0;
                }
            }
        });
    }

    // ------------------------------------------------------------------ ліва панель
    /// Ліва картка в таблиці: файли (за замовчуванням) чи «Пов’язане»; у «Редагуванні» — рядки (див. `rows_panel`).
    pub(crate) fn left_panel(&mut self, ctx: &egui::Context) {
        left_card(ctx, "tree", |ui| {
            let (title, sub) = match self.rail {
                3 => ("Пов’язане", None),
                _ => ("Файли гри", None),
            };
            card_head(ui, title, sub);
            if self.rail == 3 {
                self.related_body(ui, true);
                return;
            }
            self.tree_body(ui);
        });
    }

    fn tree_body(&mut self, ui: &mut egui::Ui) {
        let prog = self.st.file_progress();
        let names = self.st.file_names();
        let kind = |n: &str| -> usize {
            let b = n.rsplit('/').next().unwrap_or(n);
            if !b.to_lowercase().ends_with(".json") {
                2
            } else if b.starts_with("Map") && b.len() > 8 && b[3..b.len() - 5].chars().all(|c| c.is_ascii_digit()) {
                1
            } else {
                0
            }
        };
        let folders = [("data", 0usize), ("maps", 1), ("Тексти", 2)];
        let has_data = (0..names.len()).any(|i| kind(&names[i]) == 0);
        egui::ScrollArea::vertical().id_salt("treescroll").auto_shrink([false; 2]).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            ui.add_space(4.0);
            for (title, k) in folders {
                // як у старому: мапи лежать усередині data
                let inset = if k == 1 && has_data { 20.0 } else { 6.0 };
                let members: Vec<usize> = (0..names.len()).filter(|i| kind(&names[*i]) == k).collect();
                if members.is_empty() {
                    continue;
                }
                let open = !self.tree_closed.contains(&k);
                let w = ui.available_width() - 2.0 * inset;
                let (hr, hresp) = ui.allocate_exact_size(vec2(w + 2.0 * inset, 24.0), Sense::click());
                let hr = hr.shrink2(vec2(inset, 0.0));
                hresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Тека {title}")));
                if hresp.hovered() {
                    ui.painter().rect_filled(hr, CornerRadius::same(8), GHOST_HOVER);
                }
                icons::paint(ui, Rect::from_center_size(pos2(hr.left() + 10.0, hr.center().y), vec2(11.0, 11.0)), "caret", MUTE);
                // стрілка вправо, коли згорнуто: поверх малюємо повернуту — достатньо двох станів значка
                if !open {
                    ui.painter().rect_filled(Rect::from_center_size(pos2(hr.left() + 10.0, hr.center().y), vec2(12.0, 12.0)), CornerRadius::ZERO, if hresp.hovered() { GHOST_HOVER } else { BG });
                    icons::paint(ui, Rect::from_center_size(pos2(hr.left() + 10.0, hr.center().y), vec2(11.0, 11.0)), "right", MUTE);
                }
                ui.painter().text(pos2(hr.left() + 26.0, hr.center().y), Align2::LEFT_CENTER, title, ip(12.5), TEXT);
                if hresp.clicked() {
                    if open {
                        self.tree_closed.insert(k);
                    } else {
                        self.tree_closed.remove(&k);
                    }
                }
                if !open {
                    continue;
                }
                for i in members {
                    let name = &names[i];
                    let stem = name.trim_end_matches(".json").to_string();
                    let (rect, resp) = ui.allocate_exact_size(vec2(w + 2.0 * inset, 24.0), Sense::click());
                    let rect = rect.shrink2(vec2(inset, 0.0));
                    let cur = self.st.file == Some(i);
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, cur, name.clone()));
                    if cur {
                        ui.painter().rect_filled(rect, CornerRadius::same(8), SEL_GRAY);
                    } else if resp.hovered() {
                        ui.painter().rect_filled(rect, CornerRadius::same(8), GHOST_HOVER);
                    }
                    let (label, bg, fg, bw) = match k {
                        1 => ("MAP", Color32::from_rgb(0x1f, 0x3a, 0x2c), OK, 28.0),
                        2 => ("Aa", Color32::from_rgb(0x2a, 0x2f, 0x4a), INFO, 22.0),
                        _ => ("{}", Color32::from_rgb(0x3b, 0x35, 0x24), Color32::from_rgb(0xe5, 0xc0, 0x6a), 22.0),
                    };
                    let badge = Rect::from_min_size(pos2(rect.left() + 20.0, rect.center().y - 8.0), vec2(bw, 16.0));
                    ui.painter().rect_filled(badge, CornerRadius::same(R1), bg);
                    ui.painter().text(badge.center(), Align2::CENTER_CENTER, label, mp(if k == 1 { 9.0 } else { 12.0 }), fg);
                    let (total, done) = prog.get(i).copied().unwrap_or((0, 0));
                    let pct = (done * 100).checked_div(total).unwrap_or(0);
                    let bar = Rect::from_min_size(pos2(rect.right() - 8.0 - 26.0, rect.center().y - 2.0), vec2(26.0, 4.0));
                    let name_right = if done > 0 || cur || total > 0 {
                        ui.painter().rect_filled(bar, CornerRadius::same(4), Color32::from_rgb(0x3d, 0x40, 0x45));
                        if pct > 0 {
                            ui.painter().rect_filled(Rect::from_min_size(bar.min, vec2(bar.width() * pct as f32 / 100.0, 4.0)), CornerRadius::same(4), if pct == 100 { OK } else { accent() });
                        }
                        let g = ui.painter().layout_no_wrap(format!("{pct}%"), mp(12.0), if pct == 100 { OK } else { MUTE });
                        let gw = g.size().x;
                        ui.painter().galley(pos2(bar.left() - 6.0 - gw, rect.center().y - g.size().y / 2.0), g, MUTE);
                        bar.left() - 6.0 - gw - 6.0
                    } else {
                        rect.right() - 8.0
                    };
                    let clip = Rect::from_min_max(pos2(badge.right() + 6.0, rect.top()), pos2(name_right, rect.bottom()));
                    let painter = ui.painter().with_clip_rect(clip);
                    match self.st.map_title(i) {
                        Some(t) => {
                            let tw = ui.painter().layout_no_wrap(t.clone(), ip(12.5), TEXT).size().x;
                            painter.text(pos2(clip.left(), rect.center().y), Align2::LEFT_CENTER, t, ip(12.5), TEXT);
                            painter.text(pos2(clip.left() + tw + 8.0, rect.center().y), Align2::LEFT_CENTER, &stem, ip(12.0), MUTE);
                        }
                        None => {
                            painter.text(pos2(clip.left(), rect.center().y), Align2::LEFT_CENTER, &stem, ip(12.5), TEXT);
                        }
                    }
                    if resp.clicked() {
                        self.st.file = Some(i);
                        self.st.row = None;
                        self.draft_for = None;
                        self.cell_edit = None;
                    }
                }
            }
        });
    }

    // ------------------------------------------------------------------ права колонка
    /// Права колонка: розділи «Активність», «Пов’язане», «Обговорення» на рівних частинах і смужка значків, що їх вмикають.
    pub(crate) fn right_panel(&mut self, ctx: &egui::Context) {
        let edit = self.focus && !self.scene_mode;
        let mi = usize::from(edit);
        egui::SidePanel::right("rightcol").exact_width(396.0).resizable(false).show_separator_line(false).frame(egui::Frame::new()).show(ctx, |ui| {
            let full = ui.max_rect();
            // смужка значків
            let rx = full.right() - 34.0;
            let tips = [("history", "Активність у рядку: хто, коли й що змінював"), ("link", "Пов’язане: терміни, пам’ять, однакові рядки"), ("cmt", "Обговорення рядка")];
            for (i, (ic, tip)) in tips.iter().enumerate() {
                let r = Rect::from_min_size(pos2(rx, full.top() + 8.0 + i as f32 * 34.0), vec2(28.0, 28.0));
                let resp = ui.interact(r, ui.id().with(("rrail", i)), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, self.right_secs[mi][i], format!("Права панель: {tip}")));
                let on = self.right_secs[mi][i];
                if on {
                    let fill = if edit { over_color(GROUND, accent(), 0.38) } else { SEL_GRAY };
                    ui.painter().rect_filled(r, CornerRadius::same(8), fill);
                    if edit {
                        ui.painter().rect_stroke(r, CornerRadius::same(8), Stroke::new(1.0_f32, accent_ring()), StrokeKind::Inside);
                    }
                } else if resp.hovered() {
                    ui.painter().rect_filled(r, CornerRadius::same(8), GHOST_HOVER);
                }
                icons::paint(ui, Rect::from_center_size(r.center(), vec2(17.0, 17.0)), ic, if on { TEXT } else { MUTE });
                if resp.on_hover_text(*tip).clicked() {
                    self.right_secs[mi][i] = !self.right_secs[mi][i];
                }
            }
            let on: Vec<usize> = (0..3).filter(|i| self.right_secs[mi][*i]).collect();
            if on.is_empty() {
                return;
            }
            let area = Rect::from_min_max(pos2(full.left() + 6.0, full.top()), pos2(rx - 6.0, full.bottom() - 6.0));
            let gap = 6.0;
            let each = (area.height() - gap * (on.len() as f32 - 1.0)) / on.len() as f32;
            for (n, sec) in on.iter().enumerate() {
                let rect = Rect::from_min_size(pos2(area.left(), area.top() + n as f32 * (each + gap)), vec2(area.width(), each));
                let mut cui = ui.new_child(egui::UiBuilder::new().max_rect(rect));
                card_lr(0, 0).outer_margin(egui::Margin::ZERO).show(&mut cui, |ui| {
                    ui.set_min_height(each - 2.0);
                    ui.set_max_height(each - 2.0);
                    let title = ["Активність", "Пов’язане", "Обговорення"][*sec];
                    let (h, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
                    ui.painter().rect_filled(h, card_top(), PANEL);
                    ui.painter().hline(h.x_range(), h.bottom(), Stroke::new(1.0_f32, LINE));
                    let g = ui.painter().layout_no_wrap(title.to_uppercase(), FontId::proportional(11.0 * 0.936), MUTE);
                    ui.painter().galley(pos2(h.left() + 14.0, h.center().y - g.size().y / 2.0), g, MUTE);
                    if mini_icon(ui, pos2(h.right() - 17.0, h.center().y), "minus", &format!("sec-x{sec}")).on_hover_text("Сховати розділ").clicked() {
                        self.right_secs[mi][*sec] = false;
                    }
                    match *sec {
                        0 => self.activity_body(ui),
                        1 => self.related_body(ui, false),
                        _ => self.comments_body(ui),
                    }
                });
            }
        });
    }

    fn activity_body(&mut self, ui: &mut egui::Ui) {
        let (Some(f), Some(r)) = (self.st.file, self.st.row) else {
            ui.add_space(24.0);
            ui.vertical_centered(|ui| ui.label(RichText::new("Оберіть рядок").color(MUTE)));
            return;
        };
        let hist = self.st.history(f, r);
        if hist.is_empty() {
            ui.add_space(ui.available_height() * 0.35);
            ui.vertical_centered(|ui| ui.label(RichText::new("Брак активності").color(MUTE)));
            return;
        }
        egui::ScrollArea::vertical().id_salt("actscroll").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin::symmetric(14, 8)).show(ui, |ui| {
                for h in hist {
                    ui.label(RichText::new(format!("{} · {}", h.rec.who, h.rec.what)).size(10.5).color(MUTE));
                    ui.label(RichText::new(&h.rec.text).color(TEXT));
                    if h.can_restore && ui.small_button("Повернути цю версію").clicked() {
                        self.draft = h.rec.text.clone();
                    }
                    ui.add_space(6.0);
                }
            });
        });
    }

    fn comments_body(&mut self, ui: &mut egui::Ui) {
        let (Some(f), Some(r)) = (self.st.file, self.st.row) else {
            ui.add_space(24.0);
            ui.vertical_centered(|ui| ui.label(RichText::new("Оберіть рядок").color(MUTE)));
            return;
        };
        egui::ScrollArea::vertical().id_salt("cmtscroll").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin::symmetric(14, 8)).show(ui, |ui| {
                self.tab_comments(ui, f, r);
            });
        });
    }

    /// «Пов’язане»: збіги пам’яті, слова глосарія, примітки QA, однакові рядки, довідкові мови.
    fn related_body(&mut self, ui: &mut egui::Ui, wide: bool) {
        let (Some(f), Some(r)) = (self.st.file, self.st.row) else {
            ui.add_space(24.0);
            ui.vertical_centered(|ui| ui.label(RichText::new("Оберіть рядок").color(MUTE)));
            return;
        };
        let _ = wide;
        egui::ScrollArea::vertical().id_salt(("relscroll", wide)).auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 6, bottom: 12 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 8.0;
                for i in self.st.issues(f, r, &self.draft) {
                    ui.horizontal_wrapped(|ui| {
                        let (d, _) = ui.allocate_exact_size(vec2(10.0, 14.0), Sense::hover());
                        ui.painter().circle_filled(d.center(), 4.0, if i.severity == transly_core::qa::Severity::Bad { BAD } else { WARN });
                        ui.label(RichText::new(&i.message).color(TEXT));
                    });
                }
                for m in self.st.tm_matches(f, r) {
                    egui::Frame::new().fill(PANEL2).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.spacing_mut().item_spacing.y = 5.0;
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 9.0;
                            let (d, _) = ui.allocate_exact_size(vec2(10.0, 14.0), Sense::hover());
                            ui.painter().circle_filled(d.center(), 5.0, MUTE);
                            ui.label(RichText::new(&m.t).font(mp(13.0)).color(TEXT));
                            egui::Frame::new().fill(Color32::from_rgb(0x34, 0x36, 0x3b)).stroke(Stroke::new(1.0_f32, accent_ring())).corner_radius(CornerRadius::same(5)).inner_margin(egui::Margin::symmetric(8, 3)).show(ui, |ui| ui.label(RichText::new(format!("пам’ять {}%", m.score)).font(mp(12.0)).color(accent_text())));
                        });
                        ui.label(RichText::new(format!("«{}» · {}", m.s, m.src.trim_end_matches(".json"))).font(mp(10.5)).color(MUTE));
                        if ui.add(egui::Button::new(RichText::new("Підставити").font(mp(10.5)).color(TEXT)).fill(Color32::TRANSPARENT).stroke(Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54))).corner_radius(CornerRadius::same(8)).min_size(vec2(84.0, 28.0))).clicked() {
                            self.draft = m.t.clone();
                            self.draft_for = Some((f, r));
                            if self.cell_edit.is_none() {
                                self.st.edit(f, r, &m.t);
                            }
                        }
                    });
                }
                self.strands_ui(ui, f, r);
                if let Some((o, fl, up, ed)) = self.st.link_info(f, r) {
                    ui.label(RichText::new(format!("Ще {o} з таким самим оригіналом: порожніх {fl}, старіших {up}, змінених вручну {ed}")).size(11.0).color(MUTE));
                    ui.horizontal(|ui| {
                        if fl + up > 0 && plain_button(ui, "Заповнити копії").clicked() {
                            let n = self.st.apply_links(f, r, false);
                            self.message = format!("Скопійовано в рядки (чернетки): {n}");
                        }
                        if ed > 0 && plain_button(ui, "Перезаписати й змінені").clicked() {
                            let n = self.st.apply_links(f, r, true);
                            self.message = format!("Скопійовано в рядки (чернетки): {n}");
                        }
                        if let Some((is_main, unlinked)) = self.st.link_flags(f, r) {
                            if plain_button(ui, if is_main { "Зняти головного" } else { "Зробити головним" }).clicked() {
                                self.st.link_action(f, r, if is_main { 1 } else { 0 });
                            }
                            if plain_button(ui, if unlinked { "Знову йти за копіями" } else { "Не йти за копіями" }).clicked() {
                                self.st.link_action(f, r, if unlinked { 3 } else { 2 });
                            }
                        }
                    });
                }
                // поля й кнопка в окремих рядках: рядок ширший за картку виштовхував би її рамку
                let w = (ui.available_width() - ui.spacing().item_spacing.x - 16.0) / 2.0;
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut self.term_en).hint_text("слово").desired_width(w));
                    ui.add(egui::TextEdit::singleline(&mut self.term_uk).hint_text("переклад").desired_width(w));
                });
                if plain_button(ui, "Додати термін").clicked() {
                    self.message = self.st.add_term(&self.term_en, &self.term_uk);
                    self.term_en.clear();
                    self.term_uk.clear();
                }
            });
        });
    }

    /// Нитки рядка в «Пов’язаному»: картка на кожен запис глосарія, що є в оригіналі (слово, фраза, конструкція з пропуском),
    /// зі станом у перекладі; і картки назв, які гра визначає сама (предмети, персонажі…) з їхнім перекладом у базі даних.
    fn strands_ui(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        use transly_core::strands::{StrandKind, StrandState};
        for (s, t) in self.st.strands(f, r) {
            let (state, col) = match s.state {
                StrandState::Ok => ("є в перекладі", OK),
                StrandState::Alt => ("передано варіантом", INFO),
                StrandState::Missing => ("немає в перекладі", BAD),
                StrandState::Pending => ("ще не перекладено", MUTE),
            };
            let kind = match s.kind {
                StrandKind::Word => "слово",
                StrandKind::Phrase => "фраза",
                StrandKind::Construction => "конструкція",
            };
            egui::Frame::new().fill(PANEL2).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.spacing_mut().item_spacing.y = 3.0;
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 7.0;
                    let (d, _) = ui.allocate_exact_size(vec2(10.0, 14.0), Sense::hover());
                    ui.painter().circle_filled(d.center(), 5.0, TERM_COLORS[s.ci % TERM_COLORS.len()]);
                    ui.label(RichText::new(&t.en).strong().color(TEXT));
                    ui.label(RichText::new("→").color(MUTE));
                    ui.label(RichText::new(&t.uk).strong().color(TEXT));
                });
                ui.horizontal(|ui| {
                    ui.label(RichText::new(kind).font(mp(10.5)).color(MUTE));
                    ui.label(RichText::new("·").color(DIM));
                    ui.label(RichText::new(state).font(mp(10.5)).color(col));
                });
            });
        }
        let names = self.st.game_names_in(f, r);
        if !names.is_empty() {
            ui.label(RichText::new("НАЗВИ З ГРИ").size(10.5).color(MUTE));
            for (g, tr) in names {
                let mut open_it = false;
                egui::Frame::new().fill(PANEL2).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 7.0;
                        ui.label(RichText::new(&g.name).strong().color(TEXT));
                        ui.label(RichText::new("→").color(MUTE));
                        if tr.is_empty() {
                            ui.label(RichText::new("ще не перекладено").color(MUTE));
                        } else {
                            ui.label(RichText::new(&tr).strong().color(TEXT));
                        }
                    });
                    ui.label(RichText::new(g.file.trim_end_matches(".json")).font(mp(10.5)).color(DIM));
                    if plain_button(ui, "Показати").clicked() {
                        open_it = true;
                    }
                });
                if open_it {
                    self.st.open_ref(&g.file, &g.key);
                    self.draft_for = None;
                    self.cell_edit = None;
                }
            }
        }
    }

    // ------------------------------------------------------------------ центр
    pub(crate) fn editor(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default().frame(card_lr(6, 0)).show(ctx, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            self.st.sync_tabs();
            let Some(f) = self.st.file else {
                ui.centered_and_justified(|ui| ui.label(RichText::new(if self.st.is_open() { "Усі вкладки закрито: виберіть файл зі списку ліворуч" } else { "Відкрийте папку гри: кнопка «Відкрити гру…»" }).color(MUTE)));
                return;
            };
            self.tabs_bar(ui, f);
            if self.focus && !self.scene_mode {
                self.edit_center(ui, f);
                return;
            }
            if self.scene_mode {
                self.scene_center(ui, f);
                return;
            }
            self.filter_row(ui, f);
            self.grid(ui, f);
        });
    }

    /// Центр режиму «Сцена»: заголовок сцени з переходами, дії над сценою, картки реплік із полем перекладу.
    pub(crate) fn scene_center(&mut self, ui: &mut egui::Ui, f: usize) {
        let Some(r) = self.st.row else {
            ui.centered_and_justified(|ui| ui.label(RichText::new("Виберіть сцену ліворуч або рядок у таблиці").color(MUTE)));
            return;
        };
        let Some(v) = self.st.scene_view(f, r) else {
            ui.centered_and_justified(|ui| ui.label(RichText::new("Цей рядок не належить сцені (база даних чи текстовий формат)").color(MUTE)));
            return;
        };
        let file = self.st.file_names().get(f).cloned().unwrap_or_default().trim_end_matches(".json").to_string();
        let side = ((ui.available_width() - 716.0) / 2.0).max(22.0).floor() as i8;
        let n = v.lines.len();
        let done = v.lines.iter().filter(|x| x.status != RowStatus::Untranslated).count();
        let approved = v.lines.iter().filter(|x| x.status == RowStatus::Approved).count();
        egui::ScrollArea::vertical().id_salt("scenescroll").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: side, right: side, top: 16, bottom: 28 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                let (hd, _) = ui.allocate_exact_size(vec2(ui.available_width(), 44.0), Sense::hover());
                ui.painter().text(pos2(hd.left() + 38.0, hd.top() + 10.0), Align2::LEFT_CENTER, &v.title, ip(15.0), TEXT);
                ui.painter().text(pos2(hd.left() + 38.0, hd.top() + 31.0), Align2::LEFT_CENTER, format!("{file} · {n} реплік · перекладено {done} із {n} · вичитано {approved}"), ip(12.0), MUTE);
                for (dx, ic, to, id) in [(hd.left() + 12.0, "left", v.prev, "sc-prev"), (hd.right() - 12.0, "right", v.next, "sc-next")] {
                    let br = Rect::from_center_size(pos2(dx, hd.center().y), vec2(24.0, 24.0));
                    let resp = ui.interact(br, ui.id().with(id), if to.is_some() { Sense::click() } else { Sense::hover() });
                    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, to.is_some(), if ic == "left" { "Попередня сцена" } else { "Наступна сцена" }));
                    if resp.hovered() && to.is_some() {
                        ui.painter().rect_filled(br, CornerRadius::same(8), GHOST_HOVER);
                    }
                    icons::paint(ui, Rect::from_center_size(br.center(), vec2(13.0, 13.0)), ic, if to.is_none() { DIM } else if resp.hovered() { TEXT } else { MUTE });
                    if let (true, Some(t)) = (resp.clicked(), to) {
                        self.st.row = Some(t);
                    }
                }
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 8.0;
                    if plain_button(ui, "Надіслати сцену").clicked() {
                        let (mut ok, mut bad) = (0, 0);
                        for line in &v.lines {
                            let text = match &self.scene_draft {
                                Some((dr, t)) if *dr == line.row => t.clone(),
                                _ => line.target.clone(),
                            };
                            if text.is_empty() || line.status == RowStatus::Approved {
                                continue;
                            }
                            match self.st.submit(f, line.row, &text) {
                                Ok(()) => ok += 1,
                                Err(_) => bad += 1,
                            }
                        }
                        self.scene_draft = None;
                        self.message = format!("Сцену надіслано: {ok} реплік{}", if bad > 0 { format!(", {bad} не пройшли перевірку") } else { String::new() });
                    }
                    if plain_button(ui, "Вичитати сцену").clicked() {
                        let (mut ok, mut bad) = (0, 0);
                        for line in v.lines.iter().filter(|x| x.status == RowStatus::Sent) {
                            match self.st.approve_row(f, line.row) {
                                Ok(()) => ok += 1,
                                Err(_) => bad += 1,
                            }
                        }
                        self.message = format!("Сцену вичитано: {ok} реплік{}", if bad > 0 { format!(", {bad} не пройшли перевірку") } else { String::new() });
                    }
                    if plain_button(ui, "Як у грі").clicked() {
                        if self.st.game_exe().is_none() {
                            if let Some(p) = rfd::FileDialog::new().set_title("Оберіть програму гри (Game.exe)").add_filter("Програма", &["exe"]).pick_file() {
                                self.st.set_game_exe(&p);
                            }
                        }
                        self.message = self.st.play_from(f, r, true).unwrap_or_else(|e| e);
                    }
                    if plain_button(ui, "Прибрати тестовий плагін").clicked() {
                        self.message = self.st.remove_jump_plugin().unwrap_or_else(|e| e);
                    }
                });
                ui.add_space(10.0);
                ui.painter().hline(ui.available_rect_before_wrap().x_range(), ui.cursor().top(), Stroke::new(1.0_f32, LINE));
                ui.add_space(12.0);
                for line in &v.lines {
                    self.scene_card(ui, f, line);
                    ui.add_space(10.0);
                }
            });
        });
    }

    /// Картка репліки: стан, мовець, вид, номер, надсилання; оригінал; поле перекладу (зберігається при виході з поля).
    fn scene_card(&mut self, ui: &mut egui::Ui, f: usize, line: &state::SceneLine) {
        let cur = line.current;
        let frame = egui::Frame::new().fill(if cur { PANEL2 } else { BG }).stroke(Stroke::new(1.0_f32, if cur { accent_ring() } else { LINE })).corner_radius(CornerRadius::same(10)).inner_margin(egui::Margin::same(12));
        let out = frame.show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 8.0;
            let (hd, _) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
            paint_state(ui, pos2(hd.left() + 6.0, hd.center().y), line.status, false);
            let mut x = hd.left() + 20.0;
            if !line.speaker.is_empty() {
                let g = ui.painter().layout_no_wrap(line.speaker.clone(), ip(12.5), VIOLET);
                let w = g.size().x;
                ui.painter().galley(pos2(x, hd.center().y - g.size().y / 2.0), g, VIOLET);
                x += w + 8.0;
            }
            let kind = self.st.kind_label(f, line.row);
            let g = ui.painter().layout_no_wrap(format!("{kind}  {}", line.row + 1), ip(11.5), MUTE);
            ui.painter().galley(pos2(x, hd.center().y - g.size().y / 2.0), g, MUTE);
            let sr = Rect::from_center_size(pos2(hd.right() - 14.0, hd.center().y), vec2(26.0, 24.0));
            let sresp = ui.interact(sr, ui.id().with(("scene-send", line.row)), Sense::click());
            sresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Надіслати репліку {}", line.row + 1)));
            if sresp.hovered() {
                ui.painter().rect_filled(sr, CornerRadius::same(8), GHOST_HOVER);
            }
            icons::paint(ui, Rect::from_center_size(sr.center(), vec2(15.0, 15.0)), "send", if sresp.hovered() { TEXT } else { MUTE });
            let mut send = sresp.on_hover_text("Надіслати на вичитку").clicked();
            egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(12, 10)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(source_job_sized(&line.source, &self.st.source_marks(f, line.row), 14.0));
            });
            let mut buf = match &self.scene_draft {
                Some((dr, t)) if *dr == line.row => t.clone(),
                _ => line.target.clone(),
            };
            let te = ui.add(egui::TextEdit::multiline(&mut buf).hint_text("Переклад").desired_rows(2).desired_width(f32::INFINITY).font(ip(14.0)).margin(vec2(12.0, 10.0)));
            if te.changed() {
                self.scene_draft = Some((line.row, buf.clone()));
            }
            if te.gained_focus() {
                self.st.row = Some(line.row);
            }
            if te.has_focus() && ui.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::Enter)) {
                send = true;
            }
            if send {
                self.message = match self.st.submit(f, line.row, &buf) {
                    Ok(()) => "Надіслано".into(),
                    Err(e) => e,
                };
                self.scene_draft = None;
            } else if te.lost_focus() {
                if let Some((dr, t)) = self.scene_draft.take() {
                    if dr == line.row {
                        self.st.edit(f, dr, &t);
                    } else {
                        self.scene_draft = Some((dr, t));
                    }
                }
            }
        });
        if out.response.interact(Sense::click()).clicked() {
            self.st.row = Some(line.row);
        }
    }

    /// Вкладки: висота 34, вкладка 33, ширина = текст + 69; вибрана — таблетка кольору теми.
    pub(crate) fn tabs_bar(&mut self, ui: &mut egui::Ui, f: usize) {
        let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
        ui.painter().rect_filled(tabs, card_top(), PANEL);
        ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
        let names = self.st.file_names();
        let mut x = tabs.left();
        let (mut pick, mut close): (Option<usize>, Option<usize>) = (None, None);
        for t in self.st.tabs.clone() {
            let Some(tn) = names.get(t) else { continue };
            let map = self.st.map_title(t);
            let stem = map.clone().unwrap_or_else(|| tn.trim_end_matches(".json").to_string());
            let galley = ui.painter().layout_no_wrap(stem, ip(12.5), TEXT);
            let on = t == f;
            let tw = galley.size().x + 69.0 + if map.is_some() { 8.0 } else { 0.0 };
            let rect = Rect::from_min_size(pos2(x, tabs.top()), vec2(tw, 33.0));
            let resp = ui.interact(rect, ui.id().with(("tab", t)), Sense::click());
            resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Вкладка {tn}")));
            if on {
                ui.painter().rect_filled(rect, CornerRadius::same(8), over_color(PANEL, accent(), 0.30));
                ui.painter().rect_stroke(rect, CornerRadius::same(8), Stroke::new(1.0_f32, over_color(PANEL, accent(), 0.70)), StrokeKind::Inside);
            } else if resp.hovered() {
                ui.painter().rect_filled(rect, CornerRadius::same(8), GHOST_HOVER);
            }
            let chip = Rect::from_min_size(pos2(rect.left() + 9.0, rect.center().y - 8.0), vec2(if map.is_some() { 28.0 } else { 20.0 }, 16.0));
            let (badge, bg, fg, bf) = if map.is_some() { ("MAP", Color32::from_rgb(0x1f, 0x3a, 0x2c), OK, 9.0) } else { ("{}", Color32::from_rgb(0x3b, 0x35, 0x24), Color32::from_rgb(0xe5, 0xc0, 0x6a), 12.0) };
            ui.painter().rect_filled(chip, CornerRadius::same(R1), bg);
            ui.painter().text(chip.center(), Align2::CENTER_CENTER, badge, mp(bf), fg);
            ui.painter().galley(pos2(chip.right() + 5.0, rect.center().y - galley.size().y / 2.0), galley.clone(), if on { Color32::WHITE } else { MUTE });
            let cx = Rect::from_center_size(pos2(rect.right() - 17.0, rect.center().y), vec2(24.0, 24.0));
            let cr = ui.interact(cx, ui.id().with(("tabx", t)), Sense::click());
            if cr.hovered() {
                ui.painter().rect_filled(cx, CornerRadius::same(R1), GHOST_HOVER);
            }
            if on || resp.hovered() || cr.hovered() {
                icons::paint(ui, Rect::from_center_size(cx.center(), vec2(11.0, 11.0)), "close", if on || cr.hovered() { TEXT } else { MUTE });
            }
            if cr.clicked() {
                close = Some(t);
            } else if resp.clicked() {
                pick = Some(t);
            }
            x += tw;
        }
        if let Some(t) = pick {
            if self.st.file != Some(t) {
                self.st.file = Some(t);
                self.st.row = None;
                self.draft_for = None;
                self.cell_edit = None;
            }
        }
        if let Some(t) = close {
            self.st.close_tab(t);
            self.draft_for = None;
            self.cell_edit = None;
        }
    }

    /// Рядок фільтрів: пошук 200×24, «Ще» (статуси), праворуч «Мовець» і «Довжина».
    fn filter_row(&mut self, ui: &mut egui::Ui, f: usize) {
        let (fr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 36.0), Sense::hover());
        ui.painter().rect_filled(fr, CornerRadius::ZERO, FILTERS_BG);
        let fin = Rect::from_min_size(pos2(fr.left() + 10.0, fr.top() + 6.0), vec2(200.0, 24.0));
        ui.painter().rect_filled(fin, CornerRadius::same(R1), BG);
        ui.painter().rect_stroke(fin, CornerRadius::same(R1), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
        icons::paint(ui, Rect::from_center_size(pos2(fin.left() + 15.0, fin.center().y), vec2(12.0, 12.0)), "search", MUTE);
        let mut inner = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(pos2(fin.left() + 27.0, fin.top() + 2.0), vec2(168.0, 20.0))));
        inner.add(egui::TextEdit::singleline(&mut self.st.search).hint_text("Фільтр у цьому файлі").frame(false).desired_width(164.0).font(ip(12.5)));
        // чип з випадним списком
        let chip = |ui: &mut egui::Ui, x: f32, text: &str, on: bool| -> (egui::Response, f32) {
            let g = ui.painter().layout_no_wrap(text.to_string(), ip(12.0), TEXT);
            let w = g.size().x + 40.0;
            let rect = Rect::from_min_size(pos2(x, fr.top() + 6.0), vec2(w, 24.0));
            let resp = ui.interact(rect, ui.id().with(("fchip", text)), Sense::click());
            ui.painter().rect_filled(rect, CornerRadius::same(8), if resp.hovered() { BTN_HOVER } else { BTN });
            ui.painter().rect_stroke(rect, CornerRadius::same(8), Stroke::new(1.0_f32, if on { accent_ring() } else { LINE }), StrokeKind::Inside);
            ui.painter().galley(pos2(rect.left() + 9.0, rect.center().y - g.size().y / 2.0), g.clone(), TEXT);
            icons::paint(ui, Rect::from_center_size(pos2(rect.left() + 9.0 + g.size().x + 11.0, rect.center().y), vec2(10.0, 10.0)), "caret", TEXT);
            (resp, w)
        };
        let more_label = if self.st.filter == Filter::All { "Ще".to_string() } else { self.st.filter.label().to_string() };
        let (more, _) = chip(ui, fin.right() + 6.0, &more_label, self.st.filter != Filter::All);
        let counts = self.st.filter_counts(f);
        pop(ui, &more, "more-pop", |ui| {
            for (i, flt) in Filter::ALL.iter().enumerate() {
                if ui.selectable_label(self.st.filter == *flt, format!("{}  {}", flt.label(), counts[i])).clicked() {
                    self.st.filter = *flt;
                }
            }
            if let Some(id) = self.st.group_filter.clone() {
                let name = self.st.groups_view().into_iter().find(|g| g.id == id).map_or(String::new(), |g| g.name);
                ui.separator();
                if ui.button(format!("Група: {name}  (скинути)")).clicked() {
                    self.st.group_filter = None;
                }
            }
        });
        let len_label = ["Довжина", "Далеко від оригіналу", "Довші за оригінал", "Коротші за оригінал"][self.st.len_filter as usize];
        let gl = ui.painter().layout_no_wrap(len_label.to_string(), ip(12.0), TEXT);
        let lw = gl.size().x + 40.0;
        let (len_resp, _) = chip(ui, fr.right() - 10.0 - lw, len_label, self.st.len_filter > 0);
        pop(ui, &len_resp, "len-pop", |ui| {
            for (i, l) in ["Усі довжини", "Далеко від оригіналу", "Довші за оригінал", "Коротші за оригінал"].iter().enumerate() {
                if ui.selectable_label(self.st.len_filter as usize == i, *l).clicked() {
                    self.st.len_filter = i as u8;
                }
            }
        });
        let who_label = self.st.speaker_filter.clone().unwrap_or_else(|| "Мовець".to_string());
        let gw = ui.painter().layout_no_wrap(who_label.clone(), ip(12.0), TEXT);
        let ww = gw.size().x + 40.0;
        let (who_resp, _) = chip(ui, fr.right() - 10.0 - lw - 6.0 - ww, &who_label, self.st.speaker_filter.is_some());
        let speakers = self.st.file_speakers(f);
        pop(ui, &who_resp, "who-pop", |ui| {
            if ui.selectable_label(self.st.speaker_filter.is_none(), "Усі мовці").clicked() {
                self.st.speaker_filter = None;
            }
            if speakers.is_empty() {
                ui.label(RichText::new("У цьому файлі мовців нема").color(MUTE));
            }
            for (name, n) in speakers.iter().take(60) {
                if ui.selectable_label(self.st.speaker_filter.as_deref() == Some(name.as_str()), format!("{name}  {n}")).clicked() {
                    self.st.speaker_filter = Some(name.clone());
                }
            }
        });
    }

    /// Таблиця: шапка 26, рядки 34 із зеброю, колонки №, стан, ключ, [мовець], оригінал, переклад, кількість знаків. Переклад правиться в клітинці.
    fn grid(&mut self, ui: &mut egui::Ui, f: usize) {
        egui::Frame::new().inner_margin(egui::Margin { left: 6, right: 6, top: 0, bottom: 6 }).show(ui, |ui| {
            let w = ui.available_width();
            let who = self.st.file_has_speakers(f);
            let (num_w, st_w, key_w, who_w, len_w) = (34.0_f32, 22.0_f32, 110.0_f32, if who { 120.0 } else { 0.0 }, 78.0_f32);
            let flex = w - num_w - st_w - key_w - who_w - len_w;
            let (src_w, tr_w) = (flex * 0.474, flex * 0.526);
            let xs = {
                let mut v = [0.0_f32; 7];
                let ws = [num_w, st_w, key_w, who_w, src_w, tr_w, len_w];
                let mut acc = 0.0;
                for (i, wd) in ws.iter().enumerate() {
                    v[i] = acc;
                    acc += wd;
                }
                v
            };
            let (hdr, _) = ui.allocate_exact_size(vec2(w, 26.0), Sense::hover());
            ui.painter().rect_filled(hdr, CornerRadius::same(8), PANEL);
            let (sl, tl) = self.st.project.as_ref().map_or(("EN".to_string(), "UK".to_string()), |p| (p.source_lang.to_uppercase(), p.target_lang.to_uppercase()));
            for (i, title) in [(2usize, "Ключ".to_string()), (3, if who { "Мовець".into() } else { String::new() }), (4, format!("Оригінал · {sl}")), (5, format!("Переклад · {tl}")), (6, "К-сть зн.".to_string())] {
                if !title.is_empty() {
                    ui.painter().text(pos2(hdr.left() + xs[i] + 8.0, hdr.center().y), Align2::LEFT_CENTER, title, ip(12.0), MUTE);
                }
            }
            let sep = Color32::from_rgb(0x33, 0x35, 0x3a);
            for k in [1usize, 2, 4, 5, 6] {
                ui.painter().vline(hdr.left() + xs[k], (hdr.top() + 6.0)..=(hdr.bottom() - 6.0), Stroke::new(1.0_f32, sep));
            }
            if self.checked.0 != f {
                self.checked = (f, Default::default());
            }
            let total = self.st.visible_len(f);
            {
                let all_on = total > 0 && self.checked.1.len() >= total && (0..total).all(|i| self.st.visible_at(f, i).is_some_and(|r| self.checked.1.contains(&r)));
                let c = pos2(hdr.left() + xs[0] + num_w / 2.0, hdr.center().y);
                let resp = ui.interact(Rect::from_center_size(c, vec2(22.0, 22.0)), ui.id().with("selall"), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, all_on, "Вибрати всі видимі рядки"));
                paint_check(ui, c, all_on, resp.hovered());
                if resp.clicked() {
                    if all_on {
                        self.checked.1.clear();
                    } else {
                        self.checked.1 = (0..total).filter_map(|i| self.st.visible_at(f, i)).collect();
                    }
                }
            }
            if !self.checked.1.is_empty() {
                let (bar, _) = ui.allocate_exact_size(vec2(w, 34.0), Sense::hover());
                ui.painter().rect_filled(bar, CornerRadius::ZERO, over_color(PANEL, accent(), 0.16));
                ui.painter().text(pos2(bar.left() + 12.0, bar.center().y), Align2::LEFT_CENTER, format!("Вибрано {}", self.checked.1.len()), ip(12.5), TEXT);
                let mut bx = bar.left() + 110.0;
                let mut act: Option<u8> = None;
                for (i, label) in ["Надіслати", "Вичитати", "Зняти вибір"].iter().enumerate() {
                    let g = ui.painter().layout_no_wrap(label.to_string(), ip(12.0), TEXT);
                    let r = Rect::from_min_size(pos2(bx, bar.top() + 5.0), vec2(g.size().x + 20.0, 24.0));
                    let resp = ui.interact(r, ui.id().with(("bulk", i)), Sense::click());
                    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("{label} вибрані")));
                    ui.painter().rect_filled(r, CornerRadius::same(8), if resp.hovered() { BTN_HOVER } else { BTN });
                    ui.painter().galley(pos2(r.left() + 10.0, r.center().y - g.size().y / 2.0), g.clone(), TEXT);
                    if resp.clicked() {
                        act = Some(i as u8);
                    }
                    bx += r.width() + 6.0;
                }
                match act {
                    Some(0) | Some(1) => {
                        let rows = self.checked.1.clone();
                        self.message = self.st.bulk_rows(f, &rows, act == Some(1));
                        self.checked.1.clear();
                    }
                    Some(_) => self.checked.1.clear(),
                    None => {}
                }
            }
            let bad_rows: std::collections::HashSet<usize> = self.st.file_issues(f).into_iter().map(|i| i.0).collect();
            let editing = self.cell_edit;
            let mut commit: Option<bool> = None; // Some(true) — зберегти й далі, Some(false) — скасувати
            let mut begin: Option<usize> = None;
            let list_h = ui.available_height();
            egui::ScrollArea::vertical().id_salt(("gridscroll", f)).auto_shrink([false; 2]).max_height(list_h).show_rows(ui, ROW_H, total, |ui, range| {
                ui.spacing_mut().item_spacing.y = 0.0;
                for i in range {
                    let Some(r) = self.st.visible_at(f, i) else { continue };
                    let (rect, resp) = ui.allocate_exact_size(vec2(w, ROW_H), Sense::click());
                    let sel = self.st.row == Some(r);
                    let (src, tgt, st) = self.st.row_view(f, r);
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, sel, format!("{src} — {tgt}")));
                    let body = Rect::from_min_max(rect.min, pos2(rect.right(), rect.bottom() - 1.0));
                    if sel {
                        ui.painter().rect_filled(body, CornerRadius::same(8), sel_use());
                    } else if resp.hovered() {
                        ui.painter().rect_filled(body, CornerRadius::same(8), ROW_HOVER);
                    } else if i % 2 == 0 {
                        ui.painter().rect_filled(body, CornerRadius::same(8), ZEBRA);
                    }
                    ui.painter().hline(rect.x_range(), rect.bottom() - 1.0, Stroke::new(1.0_f32, LINE_SOFT));
                    for k in [1usize, 2, 4, 5, 6] {
                        ui.painter().vline(rect.left() + xs[k], rect.top()..=(rect.bottom() - 1.0), Stroke::new(1.0_f32, LINE_SOFT));
                    }
                    let col = |k: usize, wd: f32| Rect::from_min_size(pos2(rect.left() + xs[k], rect.top()), vec2(wd, ROW_H - 1.0));
                    let mid = rect.top() + 15.0;
                    // номер і стан
                    let ck_c = pos2(rect.left() + xs[0] + num_w / 2.0, rect.top() + 13.0);
                    let is_checked = self.checked.1.contains(&r);
                    let ck_resp = (resp.hovered() || sel || is_checked || !self.checked.1.is_empty()).then(|| ui.interact(Rect::from_center_size(ck_c, vec2(22.0, 22.0)), ui.id().with(("rowck", r)), Sense::click()));
                    match &ck_resp {
                        Some(cr) => {
                            cr.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, is_checked, format!("Вибрати рядок {}", r + 1)));
                            paint_check(ui, ck_c, is_checked, cr.hovered());
                        }
                        None => {
                            ui.painter().text(ck_c, Align2::CENTER_CENTER, format!("{}", r + 1), mp(12.0), DIM);
                        }
                    }
                    let ck_clicked = ck_resp.as_ref().is_some_and(|c| c.clicked());
                    if ck_clicked && !self.checked.1.remove(&r) {
                        self.checked.1.insert(r);
                    }
                    paint_state(ui, pos2(rect.left() + xs[1] + st_w / 2.0, rect.top() + 17.0), st, bad_rows.contains(&r));
                    ui.painter().with_clip_rect(col(2, key_w)).text(pos2(rect.left() + xs[2] + 8.0, rect.top() + 20.0), Align2::LEFT_CENTER, short_key(&self.st.key_of(f, r)), mp(12.0), MUTE);
                    if who {
                        let name = self.st.speaker_of_row(f, r);
                        ui.painter().with_clip_rect(col(3, who_w)).text(pos2(rect.left() + xs[3] + 8.0, mid), Align2::LEFT_CENTER, name, ip(12.5), VIOLET);
                    }
                    ui.painter().with_clip_rect(col(4, src_w)).text(pos2(rect.left() + xs[4] + 8.0, mid), Align2::LEFT_CENTER, src.replace('\n', " "), ip(12.5), SRC_TEXT);
                    let tcell = col(5, tr_w);
                    if editing == Some((f, r)) {
                        ui.painter().rect_filled(tcell, CornerRadius::same(R1), BG);
                        ui.painter().rect_stroke(tcell, CornerRadius::same(R1), Stroke::new(1.0_f32, accent()), StrokeKind::Inside);
                        let mut cui = ui.new_child(egui::UiBuilder::new().max_rect(tcell.shrink2(vec2(6.0, 2.0))));
                        // Enter і Tab зберігають і ведуть далі, Shift+Enter — перенесення рядка, Esc — скасувати
                        let (enter, tab, esc) = cui.input_mut(|i| (i.consume_key(egui::Modifiers::NONE, egui::Key::Enter), i.consume_key(egui::Modifiers::NONE, egui::Key::Tab), i.consume_key(egui::Modifiers::NONE, egui::Key::Escape)));
                        let te = egui::TextEdit::multiline(&mut self.draft).desired_rows(1).desired_width(f32::INFINITY).frame(false).font(ip(12.5)).margin(vec2(2.0, 4.0));
                        let r2 = cui.add(te);
                        if self.cell_focus {
                            r2.request_focus();
                            self.cell_focus = false;
                        }
                        if enter || tab {
                            commit = Some(true);
                        } else if esc {
                            commit = Some(false);
                        }
                    } else {
                        let (t, c) = if tgt.is_empty() { ("—".to_string(), DIM) } else { (tgt.replace('\n', " "), TEXT) };
                        ui.painter().with_clip_rect(tcell).text(pos2(tcell.left() + 8.0, mid), Align2::LEFT_CENTER, t, ip(12.5), c);
                        if sel {
                            ui.painter().rect_stroke(tcell, CornerRadius::same(R1), Stroke::new(1.0_f32, accent()), StrokeKind::Inside);
                        }
                    }
                    // кількість знаків: переклад / оригінал, відхилення підсвічується
                    let ltxt = if tgt.is_empty() { "—".to_string() } else { format!("{}/{}", tgt.chars().count(), src.chars().count()) };
                    let dev = if tgt.is_empty() { 0 } else { transly_core::qa::length_deviation(&src, &tgt).abs() };
                    ui.painter().text(pos2(rect.left() + xs[6] + len_w - 10.0, rect.top() + 14.0), Align2::RIGHT_CENTER, ltxt, mp(12.0), if dev > 40 { BAD } else if dev > 15 { WARN } else { MUTE });
                    if resp.clicked() && !ck_clicked && editing.is_none_or(|e| e != (f, r)) {
                        self.st.row = Some(r);
                        self.cell_edit = None;
                    }
                    if resp.double_clicked() || (resp.clicked() && sel && tcell.contains(resp.interact_pointer_pos().unwrap_or_default())) {
                        begin = Some(r);
                    }
                }
            });
            if let Some(r) = begin {
                self.st.row = Some(r);
                self.draft = self.st.target_of(f, r);
                self.draft_for = Some((f, r));
                self.cell_edit = Some((f, r));
                self.cell_focus = true;
            }
            match commit {
                Some(true) => {
                    if let Some((cf, cr)) = self.cell_edit {
                        self.st.edit(cf, cr, &self.draft.clone());
                        self.st.step_row(1);
                        if let Some(nr) = self.st.row {
                            self.draft = self.st.target_of(cf, nr);
                            self.draft_for = Some((cf, nr));
                            self.cell_edit = Some((cf, nr));
                            self.cell_focus = true;
                        }
                    }
                }
                Some(false) => {
                    self.cell_edit = None;
                    self.draft_for = None;
                }
                None => {}
            }
        });
    }

    // ------------------------------------------------------------------ «Редагування»
    /// Ліва картка «Рядки»: заголовок із назвою файлу, рядки-картки, внизу сторінки по 50.
    pub(crate) fn rows_panel(&mut self, ctx: &egui::Context) {
        left_card(ctx, "rows", |ui| {
            let name = self.st.file.and_then(|f| self.st.file_names().get(f).cloned()).map(|n| n.trim_end_matches(".json").to_string()).unwrap_or_default();
            match self.rail {
                2 => {
                    card_head(ui, "Сцени", Some(&name));
                }
                3 => {
                    card_head(ui, "Пов’язане", None);
                    self.related_body(ui, true);
                    return;
                }
                0 => {
                    card_head(ui, "Файли гри", None);
                    self.tree_body(ui);
                    return;
                }
                _ => {
                    card_head(ui, "Рядки", Some(&name));
                }
            }
            let Some(f) = self.st.file else { return };
            if self.rail == 2 {
                self.scenes_body(ui, f);
            } else {
                self.rows_cards(ui, f);
            }
        });
    }

    fn scenes_body(&mut self, ui: &mut egui::Ui, f: usize) {
        let list = self.st.scenes_list(f);
        if list.is_empty() {
            ui.add_space(12.0);
            ui.vertical_centered(|ui| ui.label(RichText::new("У цьому файлі немає сцен").color(MUTE)));
            return;
        }
        let cur = self.st.row.and_then(|r| self.st.scene_view(f, r)).map(|v| v.title);
        egui::ScrollArea::vertical().id_salt("scenelist").auto_shrink([false; 2]).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for (title, first, n) in list {
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::click());
                let on = cur.as_deref() == Some(title.as_str());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Сцена {title}")));
                if on {
                    ui.painter().rect_filled(rect.shrink2(vec2(6.0, 1.0)), CornerRadius::same(8), SEL_GRAY);
                } else if resp.hovered() {
                    ui.painter().rect_filled(rect.shrink2(vec2(6.0, 1.0)), CornerRadius::same(8), GHOST_HOVER);
                }
                ui.painter().text(pos2(rect.right() - 14.0, rect.center().y), Align2::RIGHT_CENTER, n.to_string(), mp(11.0), DIM);
                let clip = Rect::from_min_max(rect.min + vec2(14.0, 0.0), pos2(rect.right() - 40.0, rect.bottom()));
                ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.center().y), Align2::LEFT_CENTER, &title, ip(12.5), TEXT);
                if resp.clicked() {
                    self.st.row = Some(first);
                }
            }
        });
    }

    /// Рядки-картки: висота 66,8 + проміжок 2; крапка стану, номер, вид (жирно, колір теми), ключ праворуч, оригінал, переклад.
    pub(crate) fn rows_cards(&mut self, ui: &mut egui::Ui, f: usize) {
        let total = self.st.visible_len(f);
        let row_h = 68.8;
        let bad_rows: std::collections::HashSet<usize> = self.st.file_issues(f).into_iter().map(|i| i.0).collect();
        let area = ui.available_rect_before_wrap();
        let cur_pos = self.st.row.and_then(|r| (0..total).find(|i| self.st.visible_at(f, *i) == Some(r)));
        let mut scroll = egui::ScrollArea::vertical().id_salt(("rowcards", self.focus)).auto_shrink([false; 2]);
        if let (Some(p), Some(want)) = (cur_pos, self.rows_scroll_to.take()) {
            if want {
                scroll = scroll.vertical_scroll_offset((p as f32 * row_h - 3.0 * row_h).max(0.0));
            }
        }
        scroll.show_rows(ui, row_h, total, |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            ui.add_space(0.0);
            for i in range {
                let Some(r) = self.st.visible_at(f, i) else { continue };
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::click());
                let card = Rect::from_min_size(pos2(rect.left() + 6.0, rect.top() + 6.0), vec2(rect.width() - 12.0, 66.8));
                let sel = self.st.row == Some(r);
                let (src, tgt, st) = self.st.row_view(f, r);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, sel, format!("{src} — {tgt}")));
                if sel {
                    ui.painter().rect_filled(card, CornerRadius::same(8), SEL_GRAY);
                    ui.painter().rect_stroke(card, CornerRadius::same(8), Stroke::new(1.0_f32, CARD_LINE), StrokeKind::Inside);
                } else if resp.hovered() {
                    ui.painter().rect_filled(card, CornerRadius::same(8), ROW_HOVER);
                }
                let tx = card.left() + 30.0;
                let top = card.top() + 7.0 + 8.4;
                paint_state(ui, pos2(card.left() + 13.0, card.top() + 16.0), st, bad_rows.contains(&r));
                let num = format!("{}", r + 1);
                let ng = ui.painter().layout_no_wrap(num, ip(12.0), MUTE);
                let nw = ng.size().x;
                ui.painter().galley(pos2(tx, top - ng.size().y / 2.0), ng, MUTE);
                for dx in [0.0, 0.45] {
                    ui.painter().text(pos2(tx + nw + 8.0 + dx, top), Align2::LEFT_CENTER, self.st.kind_label(f, r), ip(12.0), accent_text());
                }
                ui.painter().text(pos2(card.right() - 8.0, top), Align2::RIGHT_CENTER, short_key(&self.st.key_of(f, r)), mp(12.0), MUTE);
                let clip = Rect::from_min_max(pos2(tx, card.top()), pos2(card.right() - 8.0, card.bottom()));
                let p = ui.painter().with_clip_rect(clip);
                p.text(pos2(tx, top + 17.5), Align2::LEFT_CENTER, src.replace('\n', " / "), ip(12.5), SRC_TEXT);
                let (t, c) = if tgt.is_empty() { ("—".to_string(), MUTE) } else { (tgt.replace('\n', " / "), MUTE) };
                p.text(pos2(tx, top + 35.0), Align2::LEFT_CENTER, t, ip(12.5), c);
                if resp.clicked() {
                    self.st.row = Some(r);
                }
            }
        });
        // сторінки по 50 рядків: «‹ 13 / 14 ›»
        let pages = total.div_ceil(50).max(1);
        if pages <= 1 {
            return; // як у старому: одну сторінку без перемикача
        }
        let page = cur_pos.map_or(0, |p| p / 50) + 1;
        let pill_r = Rect::from_center_size(pos2(area.center().x, area.bottom() - 26.0), vec2(122.0, 31.0));
        ui.painter().rect_filled(pill_r, CornerRadius::same(16), BG);
        ui.painter().rect_stroke(pill_r, CornerRadius::same(16), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
        ui.painter().text(pill_r.center(), Align2::CENTER_CENTER, format!("{page} / {pages}"), ip(12.5), TEXT);
        for (dx, ic, dir) in [(-42.0_f32, "left", -1i64), (42.0, "right", 1)] {
            let br = Rect::from_center_size(pill_r.center() + vec2(dx, 0.0), vec2(24.0, 24.0));
            let resp = ui.interact(br, ui.id().with(("pager", dir)), Sense::click());
            icons::paint(ui, Rect::from_center_size(br.center(), vec2(13.0, 13.0)), ic, if resp.hovered() { TEXT } else { MUTE });
            if resp.clicked() && total > 0 {
                let pos = cur_pos.unwrap_or(0) as i64 + dir * 50;
                let pos = pos.clamp(0, total as i64 - 1) as usize;
                self.st.row = self.st.visible_at(f, pos);
                self.rows_scroll_to = Some(true);
            }
        }
    }

    /// Картинка гри як текстура (з кешу). `None`, коли в теці гри такого файлу немає.
    fn pic_texture(&mut self, ctx: &egui::Context, pic: &Pic) -> Option<egui::TextureHandle> {
        let key = match pic {
            Pic::Icon { n, .. } => format!("icon:{n}"),
            Pic::Face { name, index, .. } => format!("face:{name}:{index}"),
            Pic::Enemy { name, .. } => format!("enemy:{name}"),
            Pic::Picture { name, .. } => format!("picture:{name}"),
        };
        if let Some(t) = self.pic_tex.get(&key) {
            return t.clone();
        }
        let tex = self.build_pic(ctx, pic, &key);
        self.pic_tex.insert(key, tex.clone());
        tex
    }

    fn build_pic(&self, ctx: &egui::Context, pic: &Pic, key: &str) -> Option<egui::TextureHandle> {
        let load = |rel: &str| self.st.game_image(rel).and_then(|b| image::load_from_memory_with_format(&b, image::ImageFormat::Png).ok()).map(|i| i.to_rgba8());
        let crop = |img: &image::RgbaImage, x: u32, y: u32, w: u32, h: u32| -> Option<egui::ColorImage> {
            if w == 0 || h == 0 || x + w > img.width() || y + h > img.height() {
                return None;
            }
            let sub = image::imageops::crop_imm(img, x, y, w, h).to_image();
            Some(egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], sub.as_raw()))
        };
        let color = match pic {
            Pic::Icon { n, .. } => {
                let img = load("img/system/IconSet.png")?;
                crop(&img, (*n as u32 % 16) * 32, (*n as u32 / 16) * 32, 32, 32)?
            }
            Pic::Face { name, index, .. } => {
                let img = load(&format!("img/faces/{name}.png"))?;
                let (cw, ch) = (img.width() / 4, img.height() / 2);
                crop(&img, (*index as u32 % 4) * cw, (*index as u32 / 4) * ch, cw, ch)?
            }
            Pic::Enemy { name, .. } => {
                let img = load(&format!("img/enemies/{name}.png")).or_else(|| load(&format!("img/sv_enemies/{name}.png")))?;
                crop(&img, 0, 0, img.width(), img.height())?
            }
            Pic::Picture { name, .. } => {
                let img = load(&format!("img/pictures/{name}.png"))?;
                crop(&img, 0, 0, img.width(), img.height())?
            }
        };
        Some(ctx.load_texture(key, color, egui::TextureOptions::NEAREST))
    }

    /// Картинки до рядка над полем перекладу: піктограма, обличчя, ворог (як у старому застосунку; ≤ 96 у висоту, обличчя 72).
    fn pics_ui(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        let pics = self.st.pics_of(f, r);
        if pics.is_empty() {
            return;
        }
        let ctx = ui.ctx().clone();
        let mut shown: Vec<(egui::TextureHandle, String, egui::Vec2)> = Vec::new();
        for p in &pics {
            let Some(t) = self.pic_texture(&ctx, p) else { continue };
            let sz = t.size_vec2();
            let size = match p {
                Pic::Icon { .. } => sz,
                Pic::Face { .. } => vec2(72.0, 72.0),
                _ => {
                    let k = (96.0 / sz.y).min(1.0);
                    sz * k
                }
            };
            let label = match p {
                Pic::Icon { label, .. } | Pic::Face { label, .. } | Pic::Enemy { label, .. } | Pic::Picture { label, .. } => label.clone(),
            };
            shown.push((t, label, size));
        }
        if shown.is_empty() {
            return;
        }
        ui.add_space(8.0);
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = vec2(10.0, 6.0);
            for (t, label, size) in shown {
                let resp = ui.add(egui::Image::new(&t).fit_to_exact_size(size));
                if !label.is_empty() {
                    resp.on_hover_text(label);
                }
            }
        });
    }

    /// «Внески» під полем: по картці на кожен надісланий переклад рядка (найновіші першими): автор, текст, голоси «+» і «−»,
    /// галочка (переклад іде в рядок і рядок вичитано) і кошик (зняти внесок з картки).
    fn contributions_ui(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        let list = self.st.contributions(f, r);
        if list.is_empty() {
            return;
        }
        ui.add_space(14.0);
        let mut act: Option<(u8, String)> = None;
        // картка, як у старому: заголовок «ВНЕСКИ N» і рядки з аватаром, іменем, датою, позначкою й кнопками
        egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, CARD_LINE)).corner_radius(CornerRadius::same(CARD_R)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 0.0;
            card_head(ui, "Внески", Some(&list.len().to_string()));
            let n = list.len();
            for (i, (v, t)) in list.iter().enumerate() {
                let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 66.0), Sense::hover());
                if i + 1 < n {
                    ui.painter().hline(row.x_range(), row.bottom(), Stroke::new(1.0_f32, LINE));
                }
                // аватар: колір від імені
                let who = if v.who.is_empty() { "Хтось".to_string() } else { v.who.clone() };
                let col = [VIOLET, INFO, OK, WARN][who.bytes().fold(0usize, |a, b| a.wrapping_mul(31).wrapping_add(b as usize)) % 4];
                let c = pos2(row.left() + 26.0, row.top() + 24.0);
                ui.painter().circle_filled(c, 12.0, col);
                ui.painter().text(c, Align2::CENTER_CENTER, who.chars().next().map(|ch| ch.to_uppercase().to_string()).unwrap_or_default(), ip(11.5), BG);
                // ім'я, дата, позначка
                let mut x = row.left() + 46.0;
                let g = ui.painter().layout_no_wrap(who.clone(), ip(12.5), TEXT);
                let w = g.size().x;
                ui.painter().galley(pos2(x, row.top() + 24.0 - g.size().y / 2.0), g, TEXT);
                x += w + 8.0;
                let when = chrono::DateTime::from_timestamp_millis(v.at).map(|d| d.with_timezone(&chrono::Local).format("%d.%m, %H:%M").to_string()).unwrap_or_default();
                let g = ui.painter().layout_no_wrap(when, ip(12.0), MUTE);
                let w = g.size().x;
                ui.painter().galley(pos2(x, row.top() + 24.0 - g.size().y / 2.0), g, MUTE);
                x += w + 8.0;
                let tag = if v.current && v.approved { Some(("вичитано", OK)) } else if v.current { Some(("у рядку", accent_text())) } else if v.approved { Some(("вичитано", OK)) } else { None };
                if let Some((label, color)) = tag {
                    let g = ui.painter().layout_no_wrap(label.to_string(), ip(11.5), color);
                    let pill = Rect::from_min_size(pos2(x, row.top() + 24.0 - 10.0), vec2(g.size().x + 14.0, 20.0));
                    ui.painter().rect(pill, CornerRadius::same(7), over_color(BG, color, 0.12), Stroke::new(1.0_f32, over_color(BG, color, 0.55)), egui::StrokeKind::Inside);
                    ui.painter().galley(pos2(pill.left() + 7.0, pill.center().y - g.size().y / 2.0), g, color);
                }
                ui.painter().text(pos2(row.left() + 46.0, row.top() + 48.0), Align2::LEFT_CENTER, &v.text, ip(13.5), TEXT);
                // кнопки справа: кошик, галочка, «−», «+» (28 px, рамка)
                let mut rx = row.right() - 14.0;
                let id = v.id.clone();
                let mut btn = |ui: &mut egui::Ui, w: f32, label: &str, tip: &str, on: bool, color: Color32, kind: u8| {
                    let rect = Rect::from_min_size(pos2(rx - w, row.top() + 10.0), vec2(w, 28.0));
                    rx -= w + 6.0;
                    let resp = ui.interact(rect, ui.id().with(("var", &id, kind)), Sense::click());
                    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("{tip}: {}", v.text)));
                    let fill = if on { over_color(BG, color, 0.30) } else if resp.hovered() { BTN_HOVER } else { BTN };
                    ui.painter().rect(rect, CornerRadius::same(8), fill, Stroke::new(1.0_f32, if on { over_color(BG, color, 0.7) } else { LINE }), egui::StrokeKind::Inside);
                    let ink = if on { color } else { TEXT };
                    match label {
                        "✓" => icons::paint(ui, Rect::from_center_size(rect.center(), vec2(14.0, 14.0)), "check", ink),
                        "x" => icons::paint(ui, Rect::from_center_size(rect.center(), vec2(14.0, 14.0)), "trash", if v.current { MUTE } else { ink }),
                        _ => {
                            ui.painter().text(rect.center(), Align2::CENTER_CENTER, label, ip(12.0), ink);
                        }
                    }
                    if resp.on_hover_text(tip).clicked() {
                        act = Some((kind, id.clone()));
                    }
                };
                btn(ui, 28.0, "x", "Зняти внесок із картки", false, MUTE, 3);
                btn(ui, 28.0, "✓", if v.approved { "Вичитано: повернути на доопрацювання" } else { "Затвердити: переклад іде в рядок, рядок вичитано" }, v.approved, OK, 2);
                btn(ui, 46.0, &format!("\u{2212} {}", t.down), "Проти", t.mine == -1, BAD, 1);
                btn(ui, 46.0, &format!("+ {}", t.up), "За", t.mine == 1, OK, 0);
            }
        });
        match act {
            Some((0, id)) => self.st.vote_variant(f, r, &id, 1),
            Some((1, id)) => self.st.vote_variant(f, r, &id, -1),
            Some((2, id)) => {
                self.message = match self.st.tick_variant(f, r, &id) {
                    Ok(()) => "Готово".into(),
                    Err(e) => e,
                };
                self.draft_for = None;
            }
            Some((_, id)) => self.st.drop_variant(f, r, &id),
            None => {}
        }
    }

    /// Центр «Редагування»: шлях і стан, оригінал, довідки, «Оригінал ──▶ Переклад», поле з нижньою панеллю. Усе в ширині 716 (поля 38).
    pub(crate) fn edit_center(&mut self, ui: &mut egui::Ui, f: usize) {
        let Some(r) = self.st.row else {
            ui.centered_and_justified(|ui| ui.label(RichText::new("Виберіть рядок ліворуч").color(MUTE)));
            return;
        };
        if self.draft_for != Some((f, r)) {
            self.draft = self.st.target_of(f, r);
            self.draft_for = Some((f, r));
        }
        let name = self.st.file_names().get(f).cloned().unwrap_or_default().trim_end_matches(".json").to_string();
        let (src, _tgt, st) = self.st.row_view(f, r);
        let (sl, tl) = self.st.project.as_ref().map_or(("EN".to_string(), "UK".to_string()), |p| (p.source_lang.to_uppercase(), p.target_lang.to_uppercase()));
        egui::ScrollArea::vertical().id_salt("editc").auto_shrink([false; 2]).show(ui, |ui| {
            // як у старому: колонка не ширша за 716, центрована, поля не менші за 22
            let side = ((ui.available_width() - 716.0) / 2.0).max(22.0).floor() as i8;
            egui::Frame::new().inner_margin(egui::Margin { left: side, right: side, top: 16, bottom: 28 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                // шлях і стан (висота 24)
                let (cr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
                let crumb = format!("{name} › {} › {}", src.replace('\n', " ").chars().take(36).collect::<String>(), short_key(&self.st.key_of(f, r)));
                let g = ui.painter().layout_no_wrap(crumb, mp(12.0), MUTE);
                let gw = g.size().x;
                ui.painter().galley(pos2(cr.left(), cr.center().y - g.size().y / 2.0), g, MUTE);
                let kind = self.st.kind_label(f, r);
                if !kind.is_empty() {
                    ui.painter().vline(cr.left() + gw + 12.0, (cr.center().y - 7.0)..=(cr.center().y + 7.0), Stroke::new(1.0_f32, Color32::from_rgb(0x52, 0x56, 0x5e)));
                    ui.painter().text(pos2(cr.left() + gw + 24.0, cr.center().y), Align2::LEFT_CENTER, kind, ip(12.0), MUTE);
                }
                let (label, col) = match st {
                    RowStatus::Untranslated => ("Без перекладу", MUTE),
                    RowStatus::Draft => ("Чернетка", WARN),
                    RowStatus::Sent => ("Чекає вичитування", INFO),
                    RowStatus::Approved => ("Вичитано", OK),
                };
                let lg = ui.painter().layout_no_wrap(label.to_string(), ip(12.0), MUTE);
                let pr = Rect::from_min_max(pos2(cr.right() - (lg.size().x + 36.0), cr.top()), cr.right_bottom());
                ui.painter().rect_stroke(pr, CornerRadius::same(12), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                paint_state(ui, pos2(pr.left() + 14.0, pr.center().y), st, false);
                ui.painter().galley(pos2(pr.left() + 26.0, pr.center().y - lg.size().y / 2.0), lg, col);
                let _ = col;
                ui.add_space(16.0);
                // оригінал
                egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(14, 12)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.label(source_job_sized(&self.st.source_of(f, r), &self.st.source_marks(f, r), 15.0 * 0.936));
                });
                self.pics_ui(ui, f, r);
                for (lang, text) in self.st.references_of(f, r) {
                    ui.add_space(10.0);
                    ui.label(RichText::new(format!("ДОВІДКА · {}", lang.to_uppercase())).font(ip(12.0)).color(MUTE));
                    ui.add_space(4.0);
                    egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(14, 12)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.label(RichText::new(text).italics().font(ip(15.0)).color(SRC_TEXT));
                    });
                }
                ui.add_space(6.0);
                // Оригінал · EN ───▶ Переклад · UK
                let (hr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 17.0), Sense::hover());
                let lg = ui.painter().layout_no_wrap(format!("Оригінал · {sl}").to_uppercase(), ip(11.5), MUTE);
                let rg = ui.painter().layout_no_wrap(format!("Переклад · {tl}").to_uppercase(), ip(11.5), MUTE);
                let (lw, rw) = (lg.size().x, rg.size().x);
                ui.painter().galley(pos2(hr.left(), hr.center().y - lg.size().y / 2.0), lg, MUTE);
                ui.painter().galley(pos2(hr.right() - rw, hr.center().y - rg.size().y / 2.0), rg, MUTE);
                let (x0, x1) = (hr.left() + lw + 10.0, hr.right() - rw - 18.0);
                ui.painter().hline(x0..=x1, hr.center().y, Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)));
                ui.painter().add(egui::Shape::convex_polygon(vec![pos2(x1, hr.center().y - 3.5), pos2(x1 + 7.0, hr.center().y), pos2(x1, hr.center().y + 3.5)], Color32::from_rgb(0x4a, 0x4d, 0x54), Stroke::NONE));
                ui.add_space(6.0);
                // поле перекладу: рамка 12, нижня панель 49
                let frame = egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, CARD_LINE)).corner_radius(CornerRadius::same(CARD_R));
                let out = frame.show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    let te = ui.add(egui::TextEdit::multiline(&mut self.draft).desired_rows(5).desired_width(f32::INFINITY).font(ip(15.0)).frame(false).margin(vec2(14.0, 12.0)));
                    let focused = te.has_focus();
                    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), 49.0), Sense::hover());
                    ui.painter().rect_filled(bar, CornerRadius { nw: 0, ne: 0, sw: CARD_R - 1, se: CARD_R - 1 }, PANEL);
                    ui.painter().hline(bar.x_range(), bar.top(), Stroke::new(1.0_f32, LINE));
                    let tr = Rect::from_center_size(pos2(bar.left() + 22.0, bar.center().y), vec2(28.0, 28.0));
                    let tresp = ui.interact(tr, ui.id().with("clear"), Sense::click());
                    if tresp.hovered() {
                        ui.painter().rect_filled(tr, CornerRadius::same(8), GHOST_HOVER);
                    }
                    icons::paint(ui, Rect::from_center_size(tr.center(), vec2(15.0, 15.0)), "trash", if tresp.hovered() { TEXT } else { MUTE });
                    if tresp.on_hover_text("Очистити переклад").clicked() {
                        self.draft.clear();
                    }
                    // лічильник стовпчиком: довжина перекладу над рискою, оригіналу під нею
                    let (n, o) = (self.draft.chars().count(), src.chars().count());
                    let cx = bar.right() - 64.0;
                    let warn = o > 0 && n as f32 > o as f32 * 1.25;
                    ui.painter().text(pos2(cx, bar.center().y - 8.0), Align2::CENTER_CENTER, n.to_string(), mp(13.0), if warn { WARN } else if n > 0 { OK } else { TEXT });
                    ui.painter().hline((cx - 9.0)..=(cx + 9.0), bar.center().y, Stroke::new(1.0_f32, MUTE));
                    ui.painter().text(pos2(cx, bar.center().y + 8.0), Align2::CENTER_CENTER, o.to_string(), mp(12.0), MUTE);
                    let sr = Rect::from_center_size(pos2(bar.right() - 28.0, bar.center().y), vec2(36.0, 30.0));
                    let sresp = ui.interact(sr, ui.id().with("send"), Sense::click());
                    ui.painter().rect_filled(sr, CornerRadius::same(8), if sresp.hovered() { accent_hover() } else { accent_solid() });
                    icons::paint(ui, Rect::from_center_size(sr.center(), vec2(17.0, 17.0)), "send", Color32::WHITE);
                    sresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Надіслати"));
                    if sresp.on_hover_text("Надіслати на вичитку (Ctrl+Enter)").clicked() {
                        self.message = match self.st.submit(f, r, &self.draft) {
                            Ok(()) => "Надіслано".into(),
                            Err(e) => e,
                        };
                    }
                    focused
                });
                if out.inner {
                    ui.painter().rect_stroke(out.response.rect, CornerRadius::same(CARD_R), Stroke::new(1.0_f32, accent()), StrokeKind::Inside);
                }
                // як у грі: кольори й імена з керівних кодів, коли вони є в оригіналі чи перекладі
                if self.draft.contains('\\') || src.contains('\\') {
                    ui.add_space(8.0);
                    let who = |n: usize| self.st.actor_name(n);
                    let shown = if self.draft.trim().is_empty() { src.clone() } else { self.draft.clone() };
                    let job = game_job(&shown, 14.0, &who);
                    egui::Frame::new().fill(Color32::from_rgb(0x10, 0x10, 0x18)).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(14, 10)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.label(RichText::new("ЯК У ГРІ").size(10.5).color(MUTE));
                        ui.label(job);
                    });
                }
                ui.add_space(8.0);
                self.contributions_ui(ui, f, r);
                for i in self.st.issues(f, r, &self.draft) {
                    ui.horizontal_wrapped(|ui| {
                        let (d, _) = ui.allocate_exact_size(vec2(10.0, 14.0), Sense::hover());
                        ui.painter().circle_filled(d.center(), 4.0, if i.severity == transly_core::qa::Severity::Bad { BAD } else { WARN });
                        ui.label(RichText::new(&i.message).color(TEXT));
                    });
                }
            });
        });
    }
}
