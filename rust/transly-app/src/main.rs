//! Transly (нативна версія), етап 3. Вигляд перенесено зі старого інтерфейсу (`mockup/workspace.html`, `app/src/ui/theme.css`):
//! рядок меню, панель інструментів, смуга інструментів, дерево файлів, сітка рядків із вкладкою, хлібними крихтами й фільтрами,
//! інспектор рядка праворуч і рядок стану. Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform`.

mod plugins;
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

struct App {
    st: AppState,
    last_save: std::time::Instant,
    draft: String,
    draft_for: Option<(usize, usize)>,
    message: String,
    term_en: String,
    term_uk: String,
    itab: usize,
    fill_win: Option<Vec<(transly_core::autofill::Proposal, bool)>>,
    find_win: Option<(String, String, bool, bool)>,
    plugins_win: bool,
    sync_win: Option<(transly_platform::github::GithubSettings, String)>,
    settings: Option<state::SettingsView>,
    btab: usize,
    bottom_open: bool,
    focus: bool,
    comment: String,
    token: String,
}

const TERM_COLORS: [Color32; 4] = [VIOLET, INFO, OK, WARN];

/// Оригінал із підкресленими термінами глосарія (колір за номером терміна).
fn source_job(text: &str, marks: &[(usize, usize, usize)]) -> egui::text::LayoutJob {
    use egui::text::{LayoutJob, TextFormat};
    let base = TextFormat { font_id: FontId::proportional(13.5), color: TEXT, ..Default::default() };
    let mut job = LayoutJob::default();
    let (mut buf, mut cur_mark): (String, Option<usize>) = (String::new(), None);
    let mut u16pos = 0;
    let flush = |job: &mut LayoutJob, buf: &mut String, mark: Option<usize>| {
        if buf.is_empty() {
            return;
        }
        let mut f = base.clone();
        if let Some(i) = mark {
            f.underline = Stroke::new(1.5_f32, TERM_COLORS[i % TERM_COLORS.len()]);
        }
        job.append(buf, 0.0, f);
        buf.clear();
    };
    for c in text.chars() {
        let mark = marks.iter().find(|(a, b, _)| u16pos >= *a && u16pos < *b).map(|m| m.2);
        if mark != cur_mark {
            flush(&mut job, &mut buf, cur_mark);
            cur_mark = mark;
        }
        buf.push(c);
        u16pos += c.len_utf16();
    }
    flush(&mut job, &mut buf, cur_mark);
    job
}

impl Default for App {
    fn default() -> Self {
        App { st: AppState::default(), last_save: std::time::Instant::now(), draft: String::new(), draft_for: None, message: String::new(), term_en: String::new(), term_uk: String::new(), itab: 0, fill_win: None, find_win: None, plugins_win: false, sync_win: None, settings: None, btab: 0, bottom_open: true, focus: false, comment: String::new(), token: String::new() }
    }
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
    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        if self.st.dirty {
            let _ = self.st.save_project();
        }
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // автозбереження: не рідше за раз на 20 с, коли є зміни
        if self.st.dirty && self.last_save.elapsed().as_secs() >= 20 {
            self.message = match self.st.save_project() {
                Ok(_) => "Автозбережено".into(),
                Err(e) => e,
            };
            self.last_save = std::time::Instant::now();
        }
        ctx.request_repaint_after(std::time::Duration::from_secs(5));
        self.menubar(ctx);
        self.toolbar(ctx);
        self.statusbar(ctx);
        self.bottom(ctx);
        self.settings_window(ctx);
        self.sync_window(ctx);
        self.plugins_window(ctx);
        self.find_window(ctx);
        self.fill_window(ctx);
        if let Some(msg) = self.st.finish_sync() {
            self.message = msg;
        }
        self.strip(ctx);
        if !self.focus {
            self.tree(ctx);
        }
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
                            Ok(n) => format!("Відкрито: {n} файлів із текстом{}", if self.st.last_note.is_empty() { String::new() } else { format!(". {}", self.st.last_note) }),
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
                    if plain_button(ui, "Зібрати в гру").clicked() {
                        self.message = self.st.build_into_game(true).unwrap_or_else(|e| e);
                    }
                    if plain_button(ui, "Повернути оригінали").clicked() {
                        self.message = self.st.restore_originals().unwrap_or_else(|e| e);
                    }
                    if plain_button(ui, "Злити проєкт…").clicked() {
                        if let Some(p) = rfd::FileDialog::new().add_filter("Проєкт Transly", &["json"]).pick_file() {
                            self.message = self.st.merge_file(&p).unwrap_or_else(|e| e);
                        }
                    }
                    if plain_button(ui, if self.st.syncing() { "Синхронізація…" } else { "Синхронізувати" }).clicked() {
                        self.sync_win = Some((self.st.github_settings(), self.token.clone()));
                    }
                    ui.menu_button("Дії", |ui| {
                        let f = self.st.file;
                        if ui.button("Надіслати чернетки файлу").clicked() {
                            self.message = self.st.bulk_send(f);
                            ui.close_menu();
                        }
                        if ui.button("Надіслати всі чернетки проєкту").clicked() {
                            self.message = self.st.bulk_send(None);
                            ui.close_menu();
                        }
                        if ui.button("Вичитати надіслані файлу").clicked() {
                            self.message = self.st.bulk_approve(f);
                            ui.close_menu();
                        }
                        if ui.button("Вичитати всі надіслані").clicked() {
                            self.message = self.st.bulk_approve(None);
                            ui.close_menu();
                        }
                        ui.separator();
                        if ui.button("Скасувати останню дію").clicked() {
                            self.message = self.st.undo_last();
                            self.draft_for = None;
                            ui.close_menu();
                        }
                        if ui.button("Повторити скасоване").clicked() {
                            self.message = self.st.redo_last();
                            self.draft_for = None;
                            ui.close_menu();
                        }
                        if ui.button("Автозаповнення…").clicked() {
                            self.fill_win = Some(self.st.autofill_proposals(500).into_iter().map(|p| (p, true)).collect());
                            ui.close_menu();
                        }
                        if ui.button("Пошук і заміна…").clicked() {
                            self.find_win = Some((String::new(), String::new(), false, false));
                            ui.close_menu();
                        }
                    });
                    if plain_button(ui, "Плагіни").clicked() {
                        self.plugins_win = true;
                    }
                    if plain_button(ui, "Налаштування").clicked() {
                        self.settings = self.st.settings_view();
                    }
                    if plain_button(ui, if self.focus { "Таблиця" } else { "Фокус" }).clicked() {
                        self.focus = !self.focus;
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

    fn bottom(&mut self, ctx: &egui::Context) {
        let Some(f) = self.st.file else { return };
        let h = if self.bottom_open { 210.0 } else { 30.0 };
        egui::TopBottomPanel::bottom("bottom").exact_height(h).resizable(false).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            let issues = self.st.file_issues(f);
            let bad = issues.iter().filter(|i| i.2).count();
            let terms = self.st.terms();
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let mut x = tabs.left() + 4.0;
            for (i, (t, n, is_bad)) in [("Глосарій", terms.len(), false), ("QA", issues.len(), bad > 0)].iter().enumerate() {
                let label = format!("{t}  {n}");
                let w = label.chars().count() as f32 * 7.2 + 24.0;
                let r = Rect::from_min_size(pos2(x, tabs.top()), vec2(w, 30.0));
                let resp = ui.interact(r, ui.id().with(("btab", i)), Sense::click());
                let on = self.btab == i && self.bottom_open;
                ui.painter().text(r.center(), Align2::CENTER_CENTER, label, FontId::proportional(12.5), if on || resp.hovered() { TEXT } else { MUTE });
                if *is_bad {
                    ui.painter().circle_filled(pos2(r.right() - 8.0, r.center().y - 5.0), 3.0, BAD);
                }
                if on {
                    ui.painter().hline(r.x_range(), tabs.bottom() - 1.0, Stroke::new(2.0_f32, ACCENT));
                }
                if resp.clicked() {
                    self.btab = i;
                    self.bottom_open = true;
                }
                x += w;
            }
            let toggle = Rect::from_min_size(pos2(tabs.right() - 28.0, tabs.top()), vec2(24.0, 30.0));
            let tr = ui.interact(toggle, ui.id().with("btoggle"), Sense::click());
            ui.painter().text(toggle.center(), Align2::CENTER_CENTER, if self.bottom_open { "▾" } else { "▴" }, FontId::proportional(12.0), MUTE);
            if tr.clicked() {
                self.bottom_open = !self.bottom_open;
            }
            if !self.bottom_open {
                return;
            }
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                if self.btab == 0 {
                    let uses = self.st.term_uses(f);
                    for (i, t) in terms.iter().enumerate() {
                        let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
                        if i % 2 == 1 {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, ZEBRA);
                        }
                        ui.painter().circle_filled(pos2(rect.left() + 16.0, rect.center().y), 3.5, TERM_COLORS[i % TERM_COLORS.len()]);
                        ui.painter().text(pos2(rect.left() + 30.0, rect.center().y), Align2::LEFT_CENTER, &t.en, FontId::proportional(12.5), TEXT);
                        ui.painter().text(pos2(rect.left() + 260.0, rect.center().y), Align2::LEFT_CENTER, &t.uk, FontId::proportional(12.5), TEXT);
                        ui.painter().text(pos2(rect.right() - 12.0, rect.center().y), Align2::RIGHT_CENTER, format!("у {} рядках", uses.get(i).copied().unwrap_or(0)), FontId::monospace(11.0), MUTE);
                    }
                    if terms.is_empty() {
                        ui.add_space(10.0);
                        ui.label(RichText::new("   Глосарій порожній: додайте термін у вкладці «Переклад»").color(MUTE));
                    }
                } else {
                    for (row, msg, is_bad) in issues.iter().take(500) {
                        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::click());
                        if resp.hovered() {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, Color32::from_rgb(0x30, 0x32, 0x3a));
                        }
                        ui.painter().circle_filled(pos2(rect.left() + 16.0, rect.center().y), 4.0, if *is_bad { BAD } else { WARN });
                        ui.painter().text(pos2(rect.left() + 30.0, rect.center().y), Align2::LEFT_CENTER, format!("{}", row + 1), FontId::monospace(11.0), MUTE);
                        ui.painter().text(pos2(rect.left() + 80.0, rect.center().y), Align2::LEFT_CENTER, msg, FontId::proportional(12.5), TEXT);
                        if resp.clicked() {
                            self.st.row = Some(*row);
                            self.st.filter = Filter::All;
                        }
                    }
                    if issues.is_empty() {
                        ui.add_space(10.0);
                        ui.label(RichText::new("   Приміток QA немає").color(OK));
                    }
                }
            });
        });
    }

    fn settings_window(&mut self, ctx: &egui::Context) {
        let Some(mut v) = self.settings.clone() else { return };
        let mut open = true;
        let (mut save, mut cancel) = (false, false);
        egui::Window::new("Налаштування проєкту").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
            egui::Grid::new("settings_grid").num_columns(2).spacing([14.0, 10.0]).show(ui, |ui| {
                ui.label("Назва проєкту");
                ui.text_edit_singleline(&mut v.name);
                ui.end_row();
                ui.label("Мова оригіналу");
                ui.add(egui::TextEdit::singleline(&mut v.source_lang).desired_width(80.0));
                ui.end_row();
                ui.label("Мова перекладу");
                ui.add(egui::TextEdit::singleline(&mut v.target_lang).desired_width(80.0));
                ui.end_row();
                ui.label("Хто перекладає");
                ui.text_edit_singleline(&mut v.who);
                ui.end_row();
                ui.label("Допуск довжини, %");
                ui.add(egui::DragValue::new(&mut v.tolerance_pct).range(0.0..=300.0));
                ui.end_row();
                ui.label("Найдовший рядок (0 — без межі)");
                ui.add(egui::DragValue::new(&mut v.line_limit).range(0.0..=500.0));
                ui.end_row();
                ui.label("Помилки QA блокують надсилання");
                ui.checkbox(&mut v.block_errors, "");
                ui.end_row();
                ui.label("Однакові рядки перекладати разом");
                ui.checkbox(&mut v.propagate, "");
                ui.end_row();
            });
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if primary_button(ui, "Зберегти").clicked() {
                    save = true;
                }
                if plain_button(ui, "Скасувати").clicked() {
                    cancel = true;
                }
            });
        });
        if save {
            self.st.apply_settings(&v);
            self.settings = None;
        } else if cancel || !open {
            self.settings = None;
        } else {
            self.settings = Some(v);
        }
    }

    fn sync_window(&mut self, ctx: &egui::Context) {
        let Some((mut cfg, mut token)) = self.sync_win.clone() else { return };
        let mut open = true;
        let (mut go, mut cancel) = (false, false);
        egui::Window::new("Синхронізація через GitHub").open(&mut open).collapsible(false).resizable(false).default_width(440.0).show(ctx, |ui| {
            egui::Grid::new("sync_grid").num_columns(2).spacing([14.0, 10.0]).show(ui, |ui| {
                ui.label("Репозиторій (власник/назва)");
                ui.text_edit_singleline(&mut cfg.repo);
                ui.end_row();
                ui.label("Гілка (порожньо — типова)");
                ui.text_edit_singleline(&mut cfg.branch);
                ui.end_row();
                ui.label("Тека в репозиторії");
                ui.text_edit_singleline(&mut cfg.dir);
                ui.end_row();
                ui.label("Токен GitHub");
                ui.add(egui::TextEdit::singleline(&mut token).password(true));
                ui.end_row();
                ui.label("Зберігати оригінали (лише приватний)");
                ui.checkbox(&mut cfg.originals, "");
                ui.end_row();
            });
            ui.label(RichText::new("Токен не зберігається: його треба вводити в кожному сеансі.").size(11.0).color(MUTE));
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if primary_button(ui, "Синхронізувати").clicked() {
                    go = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    cancel = true;
                }
            });
        });
        if go {
            self.st.set_github_settings(&cfg);
            self.token = token.clone();
            self.message = match self.st.start_sync(token) {
                Ok(()) => "Синхронізація почалась…".into(),
                Err(e) => e,
            };
            self.sync_win = None;
        } else if cancel || !open {
            self.sync_win = None;
        } else {
            self.sync_win = Some((cfg, token));
        }
    }

    fn plugins_window(&mut self, ctx: &egui::Context) {
        if !self.plugins_win {
            return;
        }
        let mut open = true;
        let mut action: Option<(String, u8)> = None; // 0 вимкнути/увімкнути, 1 видалити
        let mut run: Option<Vec<transly_core::commands::ReplaceStep>> = None;
        let mut gloss: Option<(String, String)> = None;
        egui::Window::new("Плагіни").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
            ui.horizontal(|ui| {
                if primary_button(ui, "Встановити з теки…").clicked() {
                    if let Some(p) = rfd::FileDialog::new().set_title("Тека плагіна (з transly-plugin.json)").pick_folder() {
                        self.message = match self.st.host.install(&p) {
                            Ok(id) => format!("Встановлено: {id}"),
                            Err(e) => e,
                        };
                    }
                }
                if plain_button(ui, "Встановити з файлу…").clicked() {
                    if let Some(p) = rfd::FileDialog::new().add_filter("Пакет плагіна", &["zip", "transly-plugin"]).pick_file() {
                        self.message = match self.st.host.install(&p) {
                            Ok(id) => format!("Встановлено: {id}"),
                            Err(e) => e,
                        };
                    }
                }
            });
            ui.add_space(8.0);
            for r in self.st.host.rows() {
                egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        let mut on = r.enabled;
                        if ui.checkbox(&mut on, "").changed() {
                            action = Some((r.id.clone(), 0));
                        }
                        ui.vertical(|ui| {
                            ui.label(RichText::new(format!("{}  {}", r.name, r.version)).color(TEXT));
                            let (txt, col) = match r.state {
                                "enabled" => ("працює", OK),
                                "disabled" => ("вимкнено", MUTE),
                                "incompatible" => ("несумісний", WARN),
                                "missing-dependency" => ("бракує залежності", WARN),
                                _ => ("помилка", BAD),
                            };
                            ui.label(RichText::new(format!("{}{}{}", r.id, if r.builtin { " · вбудований" } else { "" }, "")).size(11.0).color(MUTE));
                            ui.label(RichText::new(match &r.reason { Some(w) => format!("{txt}: {w}"), None => txt.to_string() }).size(11.0).color(col));
                        });
                        if !r.builtin {
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if plain_button(ui, "Видалити").clicked() {
                                    action = Some((r.id.clone(), 1));
                                }
                            });
                        }
                    });
                });
                ui.add_space(4.0);
            }
            let gl = self.st.host.glossaries();
            if !gl.is_empty() {
                ui.add_space(6.0);
                label_caps(ui, "Глосарії плагінів");
                for (pid, gid, title) in &gl {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(title).color(TEXT));
                        ui.label(RichText::new(pid).size(11.0).color(MUTE));
                        if plain_button(ui, "Додати терміни").clicked() {
                            gloss = Some((pid.clone(), gid.clone()));
                        }
                    });
                }
            }
            let cmds = self.st.host.commands();
            if !cmds.is_empty() {
                ui.add_space(6.0);
                label_caps(ui, "Команди плагінів");
                for c in cmds.iter().filter(|c| c.action == "replace") {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(&c.title).color(TEXT));
                        ui.label(RichText::new(&c.plugin_name).size(11.0).color(MUTE));
                        if plain_button(ui, "Виконати").clicked() {
                            run = c.steps.clone();
                        }
                    });
                }
            }
        });
        if let Some((id, kind)) = action {
            if kind == 0 {
                let on = !self.st.host.rows().iter().any(|r| r.id == id && r.enabled);
                self.st.host.set_enabled(&id, on);
            } else {
                self.message = match self.st.host.remove(&id) {
                    Ok(()) => "Плагін видалено".into(),
                    Err(e) => e,
                };
            }
        }
        if let Some((pid, gid)) = gloss {
            self.message = self.st.import_plugin_glossary(&pid, &gid);
        }
        if let Some(steps) = run {
            self.message = match self.st.run_replace(&steps, true) {
                Ok(0) => "Команда нічого не змінила".into(),
                Ok(n) => format!("Команда змінила рядків: {n}"),
                Err(e) => e,
            };
        }
        if !open {
            self.plugins_win = false;
        }
    }

    fn find_window(&mut self, ctx: &egui::Context) {
        let Some((mut find, mut repl, mut case, mut word)) = self.find_win.clone() else { return };
        let mut open = true;
        let (mut apply, mut close) = (false, false);
        let step = transly_core::commands::ReplaceStep { find: find.clone(), replace: repl.clone(), whole_word: word, case_sensitive: case };
        let count = self.st.run_replace(std::slice::from_ref(&step), false).unwrap_or(0);
        egui::Window::new("Пошук і заміна в перекладах").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
            egui::Grid::new("find_grid").num_columns(2).spacing([14.0, 10.0]).show(ui, |ui| {
                ui.label("Знайти");
                ui.text_edit_singleline(&mut find);
                ui.end_row();
                ui.label("Замінити на");
                ui.text_edit_singleline(&mut repl);
                ui.end_row();
                ui.label("Враховувати регістр");
                ui.checkbox(&mut case, "");
                ui.end_row();
                ui.label("Лише ціле слово");
                ui.checkbox(&mut word, "");
                ui.end_row();
            });
            ui.add_space(6.0);
            ui.label(RichText::new(if find.is_empty() { "Введіть, що шукати".to_string() } else { format!("Буде змінено рядків: {count}") }).color(MUTE));
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(count > 0, egui::Button::new(RichText::new("Замінити все").color(Color32::WHITE)).fill(ACCENT).min_size(vec2(0.0, 26.0))).clicked() {
                    apply = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if apply {
            let step = transly_core::commands::ReplaceStep { find: find.clone(), replace: repl.clone(), whole_word: word, case_sensitive: case };
            self.message = match self.st.run_replace(&[step], true) {
                Ok(n) => format!("Замінено в рядках: {n}"),
                Err(e) => e,
            };
            self.draft_for = None;
        }
        if close || !open {
            self.find_win = None;
        } else {
            self.find_win = Some((find, repl, case, word));
        }
    }

    fn fill_window(&mut self, ctx: &egui::Context) {
        let Some(mut list) = self.fill_win.take() else { return };
        let mut open = true;
        let (mut apply, mut close) = (false, false);
        egui::Window::new("Автозаповнення").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
            if list.is_empty() {
                ui.label(RichText::new("Немає чого заповнювати: усі короткі рядки або вже перекладені, або мають невідомі слова.").color(MUTE));
            } else {
                ui.label(RichText::new("Рядки, де кожне слово вже відоме з ваших перекладів і глосарія. Знімете позначку з зайвих.").color(MUTE));
                ui.horizontal(|ui| {
                    if plain_button(ui, "Позначити всі").clicked() {
                        list.iter_mut().for_each(|x| x.1 = true);
                    }
                    if plain_button(ui, "Зняти всі").clicked() {
                        list.iter_mut().for_each(|x| x.1 = false);
                    }
                });
                egui::ScrollArea::vertical().max_height(340.0).show(ui, |ui| {
                    for (p, on) in list.iter_mut() {
                        ui.horizontal(|ui| {
                            ui.checkbox(on, "");
                            ui.vertical(|ui| {
                                ui.label(RichText::new(&p.source).color(SRC_TEXT));
                                ui.label(RichText::new(&p.target).color(TEXT));
                            });
                        });
                        ui.separator();
                    }
                });
            }
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                let n = list.iter().filter(|x| x.1).count();
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("Записати чернетками ({n})")).color(Color32::WHITE)).fill(ACCENT).min_size(vec2(0.0, 26.0))).clicked() {
                    apply = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if apply {
            let picked: Vec<_> = list.iter().filter(|x| x.1).map(|x| x.0.clone()).collect();
            self.message = self.st.apply_autofill(&picked);
            self.draft_for = None;
        } else if !close && open {
            self.fill_win = Some(list);
        }
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
        let width = if self.focus { (ctx.screen_rect().width() - 40.0 - 330.0).max(380.0) } else { 380.0 };
        egui::SidePanel::right("insp").exact_width(width).resizable(false).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE))).show(ctx, |ui| {
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let mut x = tabs.left() + 4.0;
            for (i, t) in ["Переклад", "Пам’ять", "Історія", "Коментарі"].iter().enumerate() {
                let w = t.chars().count() as f32 * 7.2 + 22.0;
                let r = Rect::from_min_size(pos2(x, tabs.top()), vec2(w, 34.0));
                let resp = ui.interact(r, ui.id().with(("itab", i)), Sense::click());
                let on = self.itab == i;
                ui.painter().text(r.center(), Align2::CENTER_CENTER, t, FontId::proportional(12.5), if on || resp.hovered() { TEXT } else { MUTE });
                if on {
                    ui.painter().hline(r.x_range(), tabs.bottom() - 1.0, Stroke::new(2.0_f32, ACCENT));
                }
                if resp.clicked() {
                    self.itab = i;
                }
                x += w;
            }
            let Some((f, r)) = self.st.file.zip(self.st.row) else {
                ui.add_space(16.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Оберіть рядок").color(MUTE)));
                return;
            };
            if self.draft_for != Some((f, r)) {
                self.draft = self.st.target_of(f, r);
                self.draft_for = Some((f, r));
            }
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 5.0;
                    match self.itab {
                        0 => self.tab_translate(ui, f, r),
                        1 => self.tab_memory(ui, f, r),
                        2 => self.tab_history(ui, f, r),
                        _ => self.tab_comments(ui, f, r),
                    }
                });
            });
        });
    }

    fn tab_translate(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        label_caps(ui, "Оригінал");
        egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 9)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(source_job(&self.st.source_of(f, r), &self.st.source_marks(f, r)));
        });
        ui.label(RichText::new(self.st.key_of(f, r)).monospace().size(10.5).color(MUTE));
        ui.add_space(8.0);
        label_caps(ui, "Переклад");
        let rows = if self.focus { 9 } else { 5 };
        let resp = ui.add(egui::TextEdit::multiline(&mut self.draft).desired_rows(rows).desired_width(f32::INFINITY).font(FontId::proportional(13.5)).margin(vec2(10.0, 9.0)).background_color(BG));
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
        ui.add_space(8.0);
        for i in self.st.issues(f, r, &self.draft) {
            ui.horizontal(|ui| {
                let (d, _) = ui.allocate_exact_size(vec2(10.0, 14.0), Sense::hover());
                let col = if i.severity == transly_core::qa::Severity::Bad { BAD } else { WARN };
                ui.painter().circle_filled(d.center(), 4.0, col);
                ui.label(RichText::new(&i.message).color(TEXT));
            });
        }
        ui.add_space(10.0);
        label_caps(ui, "Глосарій");
        for (i, t) in self.st.terms().iter().enumerate() {
            ui.horizontal(|ui| {
                ui.colored_label(TERM_COLORS[i % TERM_COLORS.len()], "▪");
                ui.label(RichText::new(&t.en).color(TEXT));
                ui.label(RichText::new("→").color(DIM));
                ui.label(RichText::new(&t.uk).color(TEXT));
            });
        }
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut self.term_en).hint_text("слово").desired_width(110.0));
            ui.add(egui::TextEdit::singleline(&mut self.term_uk).hint_text("переклад").desired_width(110.0));
            if plain_button(ui, "Додати термін").clicked() {
                self.message = self.st.add_term(&self.term_en, &self.term_uk);
                self.term_en.clear();
                self.term_uk.clear();
            }
        });
    }

    fn tab_memory(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        label_caps(ui, "Схожі переклади");
        let ms = self.st.tm_matches(f, r);
        if ms.is_empty() {
            ui.label(RichText::new("Схожих рядків ще немає").color(MUTE));
        }
        for m in ms {
            let resp = egui::Frame::new()
                .fill(Color32::from_rgb(0x29, 0x2b, 0x2e))
                .stroke(Stroke::new(1.0_f32, LINE))
                .corner_radius(CornerRadius::same(R2))
                .inner_margin(egui::Margin::symmetric(8, 7))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(format!("{}%", m.score)).monospace().strong().color(if m.score >= 85 { OK } else { WARN }));
                        ui.vertical(|ui| {
                            ui.label(RichText::new(&m.t).color(TEXT));
                            ui.label(RichText::new(&m.s).size(11.0).color(MUTE));
                        });
                    });
                })
                .response
                .interact(Sense::click());
            if resp.clicked() {
                self.draft = m.t.clone();
                self.itab = 0;
            }
        }
    }

    fn tab_history(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        label_caps(ui, "Історія рядка");
        let rows = self.st.history(f, r);
        if rows.is_empty() {
            ui.label(RichText::new("Змін ще не було").color(MUTE));
        }
        for h in rows {
            ui.label(RichText::new(&h.rec.what).size(11.0).color(MUTE));
            egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(R1)).inner_margin(egui::Margin::symmetric(8, 5)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(RichText::new(&h.rec.text).color(TEXT));
            });
            if h.can_restore && ui.small_button("Повернути цю версію").clicked() {
                self.draft = h.rec.text.clone();
                self.itab = 0;
            }
            ui.add_space(6.0);
        }
    }

    fn tab_comments(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        label_caps(ui, "Обговорення");
        for t in self.st.threads(f, r) {
            egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::same(8)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(RichText::new(&t.root.who).size(11.0).color(VIOLET));
                ui.label(RichText::new(&t.root.text).color(TEXT));
                for re in &t.replies {
                    ui.label(RichText::new(format!("↳ {}: {}", re.who, re.text)).color(MUTE));
                }
            });
        }
        ui.add(egui::TextEdit::multiline(&mut self.comment).hint_text("Коментар…").desired_rows(3).desired_width(f32::INFINITY));
        if plain_button(ui, "Додати коментар").clicked() && !self.comment.trim().is_empty() {
            let text = self.comment.clone();
            self.st.comment(f, r, &text);
            self.comment.clear();
        }
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

    /// Вузький список (режим «фокус»): крапка стану, оригінал і переклад у два рядки.
    fn compact_list(&mut self, ui: &mut egui::Ui, f: usize) {
        let total = self.st.visible_len(f);
        let row_h = 42.0;
        egui::ScrollArea::vertical().auto_shrink([false; 2]).show_rows(ui, row_h, total, |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for i in range {
                let Some(r) = self.st.visible_at(f, i) else { continue };
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::click());
                let sel = self.st.row == Some(r);
                ui.painter().rect_filled(rect, CornerRadius::ZERO, if sel { SEL } else if resp.hovered() { TREE_HOVER } else { PANEL });
                ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, LINE_SOFT));
                let (src, tgt, st) = self.st.row_view(f, r);
                paint_dot(ui, pos2(rect.left() + 14.0, rect.top() + 14.0), st);
                let clip = Rect::from_min_max(pos2(rect.left() + 26.0, rect.top()), pos2(rect.right() - 8.0, rect.bottom()));
                ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.top() + 14.0), Align2::LEFT_CENTER, src.replace('\n', " ↵ "), FontId::proportional(12.5), SRC_TEXT);
                let t = if tgt.is_empty() { "—".to_string() } else { tgt.replace('\n', " ↵ ") };
                ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.top() + 30.0), Align2::LEFT_CENTER, t, FontId::proportional(12.0), MUTE);
                if resp.clicked() {
                    self.st.row = Some(r);
                }
            }
        });
    }

    fn grid(&mut self, ui: &mut egui::Ui, f: usize) {
        let w = ui.available_width();
        if w < 520.0 {
            self.compact_list(ui, f);
            return;
        }
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
