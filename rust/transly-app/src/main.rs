//! Transly (нативна версія), етап 3. Вигляд перенесено зі старого інтерфейсу (`mockup/workspace.html`, `app/src/ui/theme.css`):
//! рядок меню, панель інструментів, смуга інструментів, дерево файлів, сітка рядків із вкладкою, хлібними крихтами й фільтрами,
//! інспектор рядка праворуч і рядок стану. Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform`.

mod state;
mod theme;

use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, FontId, Rect, RichText, Sense, Stroke, StrokeKind};
use state::{AppState, Filter, RowStatus};
use theme::*;

fn main() -> eframe::Result {
    let opts = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 800.0]).with_min_inner_size([1000.0, 600.0]).with_title("Transly"), ..Default::default() };
    eframe::run_native("Transly", opts, Box::new(|cc| {
        theme::apply(&cc.egui_ctx);
        Ok(Box::new(App::default()))
    }))
}

#[derive(Default)]
struct App {
    st: AppState,
    draft: String,
    draft_for: Option<(usize, usize)>,
    message: String,
}

fn dot_color(s: RowStatus) -> Option<Color32> {
    match s {
        RowStatus::Untranslated => None,
        RowStatus::Draft => Some(WARN),
        RowStatus::Sent => Some(INFO),
        RowStatus::Approved => Some(OK),
    }
}

/// Крапка стану: порожнє кільце для «нового», заповнена для решти.
fn paint_dot(ui: &egui::Ui, c: egui::Pos2, s: RowStatus) {
    match dot_color(s) {
        Some(col) => ui.painter().circle_filled(c, 4.0, col),
        None => ui.painter().circle_stroke(c, 3.5, Stroke::new(1.5_f32, DIM)),
    };
}

fn label_caps(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text.to_uppercase()).size(10.5).color(MUTE));
}

fn primary_button(ui: &mut egui::Ui, text: &str) -> egui::Response {
    ui.add(egui::Button::new(RichText::new(text).color(Color32::WHITE)).fill(ACCENT).stroke(Stroke::new(1.0_f32, ACCENT_HOVER)).min_size(vec2(0.0, 26.0)))
}

fn plain_button(ui: &mut egui::Ui, text: &str) -> egui::Response {
    ui.add(egui::Button::new(text).min_size(vec2(0.0, 26.0)))
}

fn chip(ui: &mut egui::Ui, text: &str, count: usize, on: bool) -> egui::Response {
    let label = format!("{text}  {count}");
    let galley = ui.painter().layout_no_wrap(label, FontId::proportional(12.0), if on { CHIP_ON_TEXT } else { MUTE });
    let size = vec2(galley.size().x + 18.0, 24.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    let (fill, line, col) = if on { (CHIP_ON, CHIP_ON_LINE, CHIP_ON_TEXT) } else if resp.hovered() { (PANEL, LINE, TEXT) } else { (Color32::TRANSPARENT, LINE, MUTE) };
    ui.painter().rect(rect, CornerRadius::same(R3), fill, Stroke::new(1.0_f32, line), StrokeKind::Inside);
    ui.painter().text(rect.left_center() + vec2(9.0, 0.0), Align2::LEFT_CENTER, format!("{text}  {count}"), FontId::proportional(12.0), col);
    resp
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.menubar(ctx);
        self.toolbar(ctx);
        self.statusbar(ctx);
        self.strip(ctx);
        self.tree(ctx);
        self.inspector(ctx);
        self.editor(ctx);
    }
}

impl App {
    fn menubar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("menubar").exact_height(30.0).frame(egui::Frame::new().fill(PANEL).inner_margin(egui::Margin::symmetric(10, 0)).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                let (r, _) = ui.allocate_exact_size(vec2(18.0, 18.0), Sense::hover());
                ui.painter().rect_filled(r, CornerRadius::same(R2), ACCENT);
                ui.painter().text(r.center(), Align2::CENTER_CENTER, "T", FontId::monospace(10.0), Color32::WHITE);
                ui.add_space(4.0);
                for m in ["Файл", "Правка", "Вигляд", "Інструменти", "Довідка"] {
                    ui.label(RichText::new(m).color(TEXT));
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let name = self.st.project.as_ref().map_or("Transly".to_string(), |p| p.name.clone());
                    ui.label(RichText::new(name).color(TEXT));
                });
            });
        });
    }

    fn toolbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("toolbar").exact_height(38.0).frame(egui::Frame::new().fill(PANEL).inner_margin(egui::Margin::symmetric(10, 0)).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                if plain_button(ui, "Відкрити гру…").clicked() {
                    if let Some(dir) = rfd::FileDialog::new().set_title("Оберіть папку гри (data)").pick_folder() {
                        self.message = match self.st.open_game(&dir) {
                            Ok(n) => format!("Відкрито: {n} файлів із текстом"),
                            Err(e) => e,
                        };
                        self.draft_for = None;
                    }
                }
                ui.add(egui::Separator::default().vertical().spacing(4.0));
                let can = self.st.is_open();
                ui.add_enabled_ui(can, |ui| {
                    if primary_button(ui, "Надіслати").clicked() {
                        if let Some((f, r)) = self.st.file.zip(self.st.row) {
                            self.message = match self.st.submit(f, r, &self.draft) {
                                Ok(()) => "Надіслано".into(),
                                Err(e) => e,
                            };
                        }
                    }
                    if plain_button(ui, "Зберегти").clicked() {
                        self.message = match self.st.save_project() {
                            Ok(p) => format!("Збережено: {p}"),
                            Err(e) => e,
                        };
                    }
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.add_enabled(can, egui::TextEdit::singleline(&mut self.st.search).hint_text("Пошук у рядках…").desired_width(300.0).margin(vec2(10.0, 4.0)));
                    if can {
                        let p = self.st.progress();
                        let pct = ((p.draft + p.sent + p.approved) * 100).checked_div(p.total).unwrap_or(0);
                        ui.label(RichText::new(format!("{pct}%")).color(MUTE));
                        let (r, _) = ui.allocate_exact_size(vec2(120.0, 6.0), Sense::hover());
                        ui.painter().rect_filled(r, CornerRadius::same(R1), TRACK);
                        let mut x = r.left();
                        for (n, col) in [(p.approved, OK), (p.sent, INFO), (p.draft, WARN)] {
                            let w = if p.total > 0 { r.width() * n as f32 / p.total as f32 } else { 0.0 };
                            ui.painter().rect_filled(Rect::from_min_size(pos2(x, r.top()), vec2(w, 6.0)), CornerRadius::ZERO, col);
                            x += w;
                        }
                    }
                });
            });
        });
    }

    fn statusbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("status").exact_height(24.0).frame(egui::Frame::new().fill(PANEL).inner_margin(egui::Margin::symmetric(10, 0)).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                if self.st.is_open() {
                    let p = self.st.progress();
                    ui.label(RichText::new(format!("Рядків: {}", p.total)).size(11.5).color(MUTE));
                    ui.label(RichText::new(format!("чернеток: {}", p.draft)).size(11.5).color(MUTE));
                    ui.label(RichText::new(format!("надіслано: {}", p.sent)).size(11.5).color(MUTE));
                    ui.label(RichText::new(format!("вичитано: {}", p.approved)).size(11.5).color(OK));
                } else {
                    ui.label(RichText::new("Гру не відкрито").size(11.5).color(MUTE));
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(RichText::new(&self.message).size(11.5).color(MUTE));
                });
            });
        });
    }

    fn strip(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("strip").exact_width(40.0).resizable(false).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            ui.add_space(6.0);
            ui.vertical_centered(|ui| {
                for (i, g) in ["▤", "◈", "✎", "⚑"].iter().enumerate() {
                    let (r, resp) = ui.allocate_exact_size(vec2(30.0, 30.0), Sense::click());
                    let on = i == 0;
                    if on || resp.hovered() {
                        ui.painter().rect_filled(r, CornerRadius::same(R2), GHOST_HOVER);
                    }
                    if on {
                        ui.painter().rect_filled(Rect::from_min_size(pos2(r.left() - 5.0, r.top() + 7.0), vec2(3.0, r.height() - 14.0)), CornerRadius::same(R1), ACCENT);
                    }
                    ui.painter().text(r.center(), Align2::CENTER_CENTER, g, FontId::proportional(15.0), if on { TEXT } else { MUTE });
                }
            });
        });
    }

    fn tree(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("tree").exact_width(250.0).resizable(false).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            let (h, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
            ui.painter().text(h.left_center() + vec2(10.0, 0.0), Align2::LEFT_CENTER, "ФАЙЛИ", FontId::proportional(11.0), MUTE);
            ui.painter().hline(h.x_range(), h.bottom(), Stroke::new(1.0_f32, LINE));
            let prog = self.st.file_progress();
            let names = self.st.file_names();
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                for (i, name) in names.iter().enumerate() {
                    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
                    let cur = self.st.file == Some(i);
                    if cur {
                        ui.painter().rect_filled(rect, CornerRadius::ZERO, SEL);
                    } else if resp.hovered() {
                        ui.painter().rect_filled(rect, CornerRadius::ZERO, TREE_HOVER);
                    }
                    let badge = Rect::from_min_size(pos2(rect.left() + 10.0, rect.center().y - 8.0), vec2(16.0, 16.0));
                    ui.painter().rect_filled(badge, CornerRadius::same(R1), Color32::from_rgb(0x3b, 0x35, 0x24));
                    ui.painter().text(badge.center(), Align2::CENTER_CENTER, "J", FontId::monospace(8.5), Color32::from_rgb(0xe5, 0xc0, 0x6a));
                    let (total, done) = prog.get(i).copied().unwrap_or((0, 0));
                    let pct = (done * 100).checked_div(total).unwrap_or(0);
                    let right = rect.right() - 10.0;
                    ui.painter().text(pos2(right, rect.center().y), Align2::RIGHT_CENTER, format!("{pct}%"), FontId::monospace(11.0), if pct == 100 { OK } else { MUTE });
                    let bar = Rect::from_min_size(pos2(right - 62.0, rect.center().y - 2.0), vec2(26.0, 4.0));
                    ui.painter().rect_filled(bar, CornerRadius::same(R1), Color32::from_rgb(0x3d, 0x40, 0x45));
                    ui.painter().rect_filled(Rect::from_min_size(bar.min, vec2(bar.width() * pct as f32 / 100.0, 4.0)), CornerRadius::same(R1), if pct == 100 { OK } else { INFO });
                    let clip = Rect::from_min_max(pos2(badge.right() + 6.0, rect.top()), pos2(bar.left() - 6.0, rect.bottom()));
                    ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.center().y), Align2::LEFT_CENTER, name, FontId::proportional(12.5), TEXT);
                    if resp.clicked() {
                        self.st.file = Some(i);
                        self.st.row = None;
                    }
                }
            });
        });
    }

    fn inspector(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("insp").exact_width(380.0).resizable(false).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
            ui.painter().text(tabs.left_center() + vec2(15.0, 0.0), Align2::LEFT_CENTER, "Переклад", FontId::proportional(12.5), TEXT);
            ui.painter().hline((tabs.left() + 4.0)..=(tabs.left() + 78.0), tabs.bottom() - 1.0, Stroke::new(2.0_f32, ACCENT));
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let Some((f, r)) = self.st.file.zip(self.st.row) else {
                ui.add_space(16.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Оберіть рядок у таблиці").color(MUTE)));
                return;
            };
            if self.draft_for != Some((f, r)) {
                self.draft = self.st.target_of(f, r);
                self.draft_for = Some((f, r));
            }
            egui::Frame::new().inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 5.0;
                label_caps(ui, "Оригінал");
                egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 9)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.label(RichText::new(self.st.source_of(f, r)).size(13.5).color(TEXT));
                });
                ui.horizontal(|ui| {
                    let key = self.st.key_of(f, r);
                    ui.label(RichText::new(key).monospace().size(10.5).color(MUTE));
                });
                ui.add_space(8.0);
                label_caps(ui, "Переклад");
                let resp = ui.add(egui::TextEdit::multiline(&mut self.draft).desired_rows(5).desired_width(f32::INFINITY).font(FontId::proportional(13.5)).margin(vec2(10.0, 9.0)).background_color(BG));
                ui.painter().rect_stroke(resp.rect, CornerRadius::same(R2), Stroke::new(1.0_f32, ACCENT), StrokeKind::Outside);
                let src_len = self.st.source_of(f, r).chars().count().max(1);
                let ratio = (self.draft.chars().count() as f32 / src_len as f32).min(1.5);
                let (m, _) = ui.allocate_exact_size(vec2(ui.available_width(), 3.0), Sense::hover());
                ui.painter().rect_filled(m, CornerRadius::same(R1), Color32::from_rgb(0x3d, 0x40, 0x45));
                ui.painter().rect_filled(Rect::from_min_size(m.min, vec2(m.width() * (ratio / 1.5), 3.0)), CornerRadius::same(R1), if ratio > 1.25 { BAD } else { OK });
                ui.add_space(3.0);
                ui.horizontal(|ui| {
                    if primary_button(ui, "Надіслати").clicked() {
                        self.message = match self.st.submit(f, r, &self.draft) {
                            Ok(()) => "Надіслано".into(),
                            Err(e) => e,
                        };
                    }
                    if plain_button(ui, "Зберегти правку").clicked() {
                        self.st.edit(f, r, &self.draft);
                    }
                });
            });
        });
    }

    fn editor(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default().frame(egui::Frame::new().fill(BG)).show(ctx, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let Some(f) = self.st.file else {
                ui.centered_and_justified(|ui| ui.label(RichText::new("Відкрийте папку гри: кнопка «Відкрити гру…»").color(MUTE)));
                return;
            };
            let name = self.st.file_names().get(f).cloned().unwrap_or_default();
            // вкладка
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
            ui.painter().rect_filled(tabs, CornerRadius::ZERO, PANEL);
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let tw = (name.chars().count() as f32 * 7.0 + 40.0).min(400.0);
            let tab = Rect::from_min_size(pos2(tabs.left() + 4.0, tabs.top()), vec2(tw, 33.0));
            ui.painter().rect_filled(tab, CornerRadius::ZERO, Color32::from_rgb(0x25, 0x28, 0x2c));
            ui.painter().hline(tab.x_range(), tab.bottom(), Stroke::new(2.0_f32, ACCENT));
            ui.painter().text(tab.left_center() + vec2(12.0, 0.0), Align2::LEFT_CENTER, &name, FontId::proportional(12.5), TEXT);
            // хлібні крихти
            let (cr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
            ui.painter().hline(cr.x_range(), cr.bottom(), Stroke::new(1.0_f32, LINE));
            ui.painter().text(cr.left_center() + vec2(12.0, 0.0), Align2::LEFT_CENTER, format!("Файли  ›  {name}"), FontId::proportional(11.5), MUTE);
            let n = self.st.row_count(f);
            ui.painter().text(cr.right_center() - vec2(12.0, 0.0), Align2::RIGHT_CENTER, format!("{n} рядків"), FontId::monospace(11.0), MUTE);
            // фільтри
            let (fr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 36.0), Sense::hover());
            ui.painter().rect_filled(fr, CornerRadius::ZERO, FILTERS_BG);
            ui.painter().hline(fr.x_range(), fr.bottom(), Stroke::new(1.0_f32, LINE));
            let counts = self.st.filter_counts(f);
            let mut fui = ui.new_child(egui::UiBuilder::new().max_rect(fr.shrink2(vec2(10.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
            fui.spacing_mut().item_spacing.x = 6.0;
            for (i, flt) in Filter::ALL.iter().enumerate() {
                if chip(&mut fui, flt.label(), counts[i], self.st.filter == *flt).clicked() {
                    self.st.filter = *flt;
                }
            }
            self.grid(ui, f);
        });
    }

    fn grid(&mut self, ui: &mut egui::Ui, f: usize) {
        let w = ui.available_width();
        // колонки: №, стан, ключ, оригінал, переклад
        let fixed = [34.0_f32, 22.0, 150.0];
        let flex = ((w - fixed.iter().sum::<f32>() - 12.0) / 2.0).max(120.0);
        let cols = [fixed[0], fixed[1], fixed[2], flex, flex];
        let (hdr, _) = ui.allocate_exact_size(vec2(w, 26.0), Sense::hover());
        ui.painter().rect_filled(hdr, CornerRadius::ZERO, PANEL);
        ui.painter().hline(hdr.x_range(), hdr.bottom(), Stroke::new(1.0_f32, LINE));
        let mut x = hdr.left();
        for (title, cw) in ["№", "", "Ключ", "Оригінал", "Переклад"].iter().zip(cols) {
            ui.painter().text(pos2(x + 8.0, hdr.center().y), Align2::LEFT_CENTER, title, FontId::proportional(11.0), MUTE);
            x += cw;
            ui.painter().vline(x, hdr.y_range(), Stroke::new(1.0_f32, Color32::from_rgb(0x33, 0x35, 0x3a)));
        }
        let total = self.st.visible_len(f);
        let row_h = 30.0;
        egui::ScrollArea::vertical().auto_shrink([false; 2]).show_rows(ui, row_h, total, |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for i in range {
                let Some(r) = self.st.visible_at(f, i) else { continue };
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::click());
                let sel = self.st.row == Some(r);
                let bg = if sel { SEL } else if resp.hovered() { ROW_HOVER } else if i % 2 == 1 { ZEBRA } else { BG };
                ui.painter().rect_filled(rect, CornerRadius::ZERO, bg);
                ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, LINE_SOFT));
                let (src, tgt, st) = self.st.row_view(f, r);
                let key = self.st.key_of(f, r);
                let mut x = rect.left();
                let cell = |x: f32, cw: f32| Rect::from_min_size(pos2(x, rect.top()), vec2(cw, row_h));
                ui.painter().text(pos2(x + cols[0] - 6.0, rect.center().y), Align2::RIGHT_CENTER, format!("{}", r + 1), FontId::monospace(11.0), DIM);
                x += cols[0];
                paint_dot(ui, pos2(x + cols[1] / 2.0, rect.center().y), st);
                x += cols[1];
                ui.painter().with_clip_rect(cell(x, cols[2])).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, key, FontId::monospace(11.0), MUTE);
                x += cols[2];
                ui.painter().with_clip_rect(cell(x, cols[3])).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, src.replace('\n', " ↵ "), FontId::proportional(12.5), SRC_TEXT);
                x += cols[3];
                let tcell = cell(x, cols[4]);
                if tgt.is_empty() {
                    ui.painter().with_clip_rect(tcell).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, "—", FontId::proportional(12.5), DIM);
                } else {
                    ui.painter().with_clip_rect(tcell).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, tgt.replace('\n', " ↵ "), FontId::proportional(12.5), TEXT);
                }
                if sel {
                    ui.painter().rect_stroke(tcell.shrink(1.0), CornerRadius::same(R1), Stroke::new(1.0_f32, ACCENT), StrokeKind::Inside);
                }
                if resp.clicked() {
                    self.st.row = Some(r);
                }
            }
        });
    }
}
