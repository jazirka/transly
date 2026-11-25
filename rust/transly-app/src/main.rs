//! Transly (нативна версія), етап 3. Вигляд перенесено зі старого інтерфейсу (`mockup/workspace.html`, `app/src/ui/theme.css`):
//! рядок меню, панель інструментів, смуга інструментів, дерево файлів, сітка рядків із вкладкою, хлібними крихтами й фільтрами,
//! інспектор рядка праворуч і рядок стану. Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform`.

// у випуску без чорного вікна консолі
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod icons;
mod plugins;
mod state;
mod theme;

use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, FontId, Rect, RichText, Sense, Stroke, StrokeKind};
use state::{AppState, Filter, RowStatus};
use theme::*;

/// Вікно «Оновити за глосарієм»: зміна терміна й рядки (пропозиція, вибрано, вибір форми на кожен проміжок).
type TermSyncWin = (transly_core::termsync::TermChange, Vec<(transly_core::termsync::TermProposal, bool, Vec<i64>)>);

fn main() -> eframe::Result {
    let opts = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 800.0]).with_min_inner_size([1000.0, 600.0]).with_title("Transly"), ..Default::default() };
    eframe::run_native("Transly", opts, Box::new(|cc| {
        theme::apply(&cc.egui_ctx);
        let mut app = App::default();
        // `transly-app <тека гри>`: відкрити гру одразу
        if let Some(dir) = std::env::args_os().nth(1).map(std::path::PathBuf::from).filter(|d| d.is_dir()) {
            app.message = match app.st.open_game(&dir) {
                Ok(n) => format!("Відкрито: {n} файлів із текстом"),
                Err(e) => e,
            };
        }
        Ok(Box::new(app))
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
    keys_win: bool,
    rail: usize,
    run_cfg: usize,
    tree_closed: std::collections::HashSet<usize>,
    scene_mode: bool,
    keep_edit: Option<(String, String)>,
    activity_win: bool,
    tsync_win: Option<TermSyncWin>,
    wrap_win: Option<(transly_core::wrapconfig::WrapSettings, String, bool)>,
    qar_win: bool,
    br_win: Option<String>,
    merge_win: Option<(String, Vec<transly_core::branches::DiffRow>, std::collections::HashMap<String, transly_core::branches::Decision>)>,
    rename_win: Option<(String, String)>,
    groups_win: Option<String>,
    ref_win: Option<String>,
    spk_win: Option<Vec<(transly_core::speakers::SpeakerCandidate, String)>>,
    import_win: Option<(u8, String)>,
    build_win: Option<state::BuildChoice>,
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
        App { st: AppState::default(), last_save: std::time::Instant::now(), draft: String::new(), draft_for: None, message: String::new(), term_en: String::new(), term_uk: String::new(), itab: 0, keys_win: false, rail: 0, run_cfg: 0, tree_closed: Default::default(), scene_mode: false, keep_edit: None, activity_win: false, tsync_win: None, wrap_win: None, qar_win: false, br_win: None, merge_win: None, rename_win: None, groups_win: None, ref_win: None, spk_win: None, import_win: None, build_win: None, fill_win: None, find_win: None, plugins_win: false, sync_win: None, settings: None, btab: 0, bottom_open: true, focus: false, comment: String::new(), token: String::new() }
    }
}

/// Картка оболонки: заокруглена панель на тлі між картками (як у старому застосунку).
fn card() -> egui::Frame {
    egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(10)).outer_margin(egui::Margin::same(4)).inner_margin(egui::Margin::ZERO)
}

/// Верх картки: заокруглені лише верхні кути.
fn top_round() -> CornerRadius {
    CornerRadius { nw: 10, ne: 10, sw: 0, se: 0 }
}


/// Число з пробілами між тисячами (22 000 → «22 000»).
fn fmt_n(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push('\u{a0}');
        }
        out.push(c);
    }
    out
}

/// Таблетка верхньої панелі: аватар з літерами проєкту чи піктограма, назва, стрілка; рамка — для головної дії.
fn pill(ui: &mut egui::Ui, avatar: Option<&str>, icon: Option<&str>, text: &str, caret: bool, border: bool) -> egui::Response {
    let galley = ui.painter().layout_no_wrap(text.to_string(), FontId::proportional(13.0), TEXT);
    let lead = if avatar.is_some() { 30.0 } else if icon.is_some() { 26.0 } else { 10.0 };
    let w = lead + galley.size().x + if caret { 26.0 } else { 12.0 };
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 32.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, text));
    if resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(16), GHOST_HOVER);
    }
    if border {
        ui.painter().rect_stroke(rect, CornerRadius::same(16), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
    }
    if let Some(letters) = avatar {
        let c = pos2(rect.left() + 17.0, rect.center().y);
        ui.painter().circle_filled(c, 11.0, accent_solid());
        ui.painter().text(c, Align2::CENTER_CENTER, letters, FontId::proportional(10.0), Color32::WHITE);
    } else if let Some(ic) = icon {
        icons::paint(ui, Rect::from_center_size(pos2(rect.left() + 17.0, rect.center().y), vec2(16.0, 16.0)), ic, MUTE);
    }
    ui.painter().galley(pos2(rect.left() + lead, rect.center().y - galley.size().y / 2.0), galley.clone(), TEXT);
    if caret {
        icons::paint(ui, Rect::from_center_size(pos2(rect.left() + lead + galley.size().x + 12.0, rect.center().y), vec2(12.0, 12.0)), "caret", MUTE);
    }
    resp
}

/// Випадний список під кнопкою: відкривається кліком, закривається кліком у списку чи поза ним.
fn pop(ui: &egui::Ui, resp: &egui::Response, id: &str, add: impl FnOnce(&mut egui::Ui)) {
    let pid = ui.make_persistent_id(id);
    if resp.clicked() {
        ui.memory_mut(|m| m.toggle_popup(pid));
    }
    egui::popup::popup_below_widget(ui, pid, resp, egui::popup::PopupCloseBehavior::CloseOnClick, |ui| {
        ui.set_min_width(200.0);
        add(ui);
    });
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
    ui.add(egui::Button::new(RichText::new(text).color(Color32::WHITE)).fill(accent_solid()).stroke(Stroke::new(1.0_f32, accent_hover())).min_size(vec2(0.0, 26.0)))
}

fn plain_button(ui: &mut egui::Ui, text: &str) -> egui::Response {
    ui.add(egui::Button::new(text).min_size(vec2(0.0, 26.0)))
}

fn chip(ui: &mut egui::Ui, text: &str, count: usize, on: bool) -> egui::Response {
    let label = format!("{text}  {count}");
    let galley = ui.painter().layout_no_wrap(label, FontId::proportional(12.0), if on { accent_text() } else { MUTE });
    let size = vec2(galley.size().x + 18.0, 24.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("{text} {count}")));
    let (fill, line, col) = if on { (chip_on(), accent_ring(), accent_text()) } else if resp.hovered() { (PANEL, LINE, TEXT) } else { (Color32::TRANSPARENT, LINE, MUTE) };
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
        self.frame(ctx);
    }
}

impl App {
    /// Один кадр інтерфейсу (окремо від `eframe`, щоб його можна було ганяти в тестах).
    fn frame(&mut self, ctx: &egui::Context) {
        // автозбереження: не рідше за раз на 20 с, коли є зміни
        if self.st.dirty && self.last_save.elapsed().as_secs() >= 20 {
            self.message = match self.st.save_project() {
                Ok(_) => "Автозбережено".into(),
                Err(e) => e,
            };
            self.last_save = std::time::Instant::now();
        }
        ctx.request_repaint_after(std::time::Duration::from_secs(5));
        self.hotkeys(ctx);
        let hue = transly_core::theme::theme_hue(self.st.project.as_ref().map_or("Transly", |p| p.name.as_str()), self.st.project.as_ref().and_then(|p| p.settings.get("hue")));
        if theme::set_hue(hue) {
            theme::apply_style(ctx);
        }
        self.topbar(ctx);
        self.statusbar(ctx);
        self.bottom(ctx);
        self.settings_window(ctx);
        self.sync_window(ctx);
        self.plugins_window(ctx);
        self.find_window(ctx);
        self.fill_window(ctx);
        self.build_window(ctx);
        self.import_window(ctx);
        self.speakers_window(ctx);
        self.reference_window(ctx);
        self.groups_window(ctx);
        self.branches_window(ctx);
        self.qarules_window(ctx);
        self.merge_window(ctx);
        self.rename_window(ctx);
        self.wrap_window(ctx);
        self.term_sync_window(ctx);
        self.activity_window(ctx);
        self.keys_window(ctx);
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

    /// Клавіші: Ctrl+Enter — надіслати й перейти далі, Ctrl+S — зберегти, F2 — «Фокус», стрілки вгору/вниз — між рядками (поки не набирається текст).
    fn hotkeys(&mut self, ctx: &egui::Context) {
        use egui::{Key, KeyboardShortcut, Modifiers};
        if ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(Modifiers::COMMAND, Key::Enter))) {
            if let Some((f, r)) = self.st.file.zip(self.st.row) {
                self.message = match self.st.submit(f, r, &self.draft) {
                    Ok(()) => {
                        self.st.step_row(1);
                        "Надіслано".into()
                    }
                    Err(e) => e,
                };
            }
        }
        if ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(Modifiers::COMMAND, Key::S))) && self.st.is_open() {
            self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
        }
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::F2)) {
            self.focus = !self.focus;
        }
        if !ctx.wants_keyboard_input() {
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowDown)) {
                self.st.step_row(1);
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowUp)) {
                self.st.step_row(-1);
            }
        }
    }

    /// Верхня панель, як у старому застосунку: логотип, меню, проєкт і гілка, режими, прогрес, збірка, запуск.
    fn topbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("topbar").exact_height(50.0).show_separator_line(false).frame(egui::Frame::new().fill(GROUND).inner_margin(egui::Margin::symmetric(12, 0))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                let can = self.st.is_open();
                // логотип
                let (r, _) = ui.allocate_exact_size(vec2(26.0, 26.0), Sense::hover());
                ui.painter().circle_filled(r.center(), 13.0, accent_solid());
                ui.painter().text(r.center(), Align2::CENTER_CENTER, "T", FontId::proportional(13.0), Color32::WHITE);
                // головне меню
                egui::menu::menu_custom_button(ui, egui::Button::image(icons::image("menu", MUTE, 16.0)).frame(false).min_size(vec2(30.0, 30.0)), |ui| {
                    ui.menu_button("Файл", |ui| self.menu_file(ui));
                    ui.menu_button("Вигляд", |ui| self.menu_view(ui));
                    ui.menu_button("Інструменти", |ui| self.menu_tools(ui));
                });
                // проєкт
                let name = self.st.project.as_ref().map_or("Transly".to_string(), |p| p.name.clone());
                let letters = self.st.project.as_ref().map_or("T".to_string(), transly_core::projname::icon_letters);
                let resp = pill(ui, Some(&letters), None, &name, true, false);
                pop(ui, &resp, "projpop", |ui| {
                    if ui.button("Відкрити гру…").clicked() {
                        self.open_dialog();
                    }
                    if ui.add_enabled(can, egui::Button::new("Зберегти")).clicked() {
                        self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
                    }
                    if ui.add_enabled(can, egui::Button::new("Налаштування проєкту…")).clicked() {
                        self.act_settings();
                    }
                });
                // гілка
                if can {
                    let br = self.st.current_branch();
                    let resp = pill(ui, None, Some("branch"), &br, true, false);
                    if resp.clicked() {
                        self.br_win = Some(String::new());
                    }
                }
                ui.add_space(6.0);
                // режим: Таблиця, Редагування, Сцена
                ui.add_enabled_ui(can, |ui| {
                    egui::Frame::new().fill(BTN).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(2, 2)).show(ui, |ui| {
                        ui.spacing_mut().item_spacing.x = 2.0;
                        let modes = [("table", "Таблиця: усі рядки файлу", !self.focus && !self.scene_mode), ("edit", "Редагування: один рядок", self.focus && !self.scene_mode), ("scene", "Сцена: репліки подій поспіль", self.scene_mode)];
                        for (i, (ic, tip, on)) in modes.into_iter().enumerate() {
                            if icons::button(ui, ic, tip, on, MUTE).clicked() {
                                self.focus = i == 1;
                                self.scene_mode = i == 2;
                            }
                        }
                    });
                });
                ui.add_space(8.0);
                if can {
                    let p = self.st.progress();
                    let pc = |n: usize| (n * 100).checked_div(p.total).unwrap_or(0);
                    let (r, _) = ui.allocate_exact_size(vec2(150.0, 6.0), Sense::hover());
                    ui.painter().rect_filled(r, CornerRadius::same(R1), TRACK);
                    let mut x = r.left();
                    for (n, col) in [(p.approved, OK), (p.sent, INFO), (p.draft, WARN)] {
                        let w = if p.total > 0 { r.width() * n as f32 / p.total as f32 } else { 0.0 };
                        ui.painter().rect_filled(Rect::from_min_size(pos2(x, r.top()), vec2(w, 6.0)), CornerRadius::ZERO, col);
                        x += w;
                    }
                    let done = p.draft + p.sent + p.approved;
                    let full = format!("Перекладено {}% ({} з {}) · надіслано {}% · вичитано {}%", pc(done), fmt_n(done), fmt_n(p.total), pc(p.sent), pc(p.approved));
                    if ctx.screen_rect().width() > 1500.0 {
                        ui.label(RichText::new(full).monospace().size(11.5).color(MUTE));
                    } else {
                        ui.label(RichText::new(format!("{}%", pc(done))).monospace().size(11.5).color(MUTE)).on_hover_text(full);
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    if icons::button(ui, "keys", "Гарячі клавіші", false, MUTE).clicked() {
                        self.keys_win = !self.keys_win;
                    }
                    let resp = icons::button(ui, "menu", "Дії: масові дії, скасування, автозаповнення, пошук і заміна", false, MUTE);
                    pop(ui, &resp, "actpop", |ui| self.menu_actions(ui));
                    ui.add_enabled_ui(can, |ui| {
                        if icons::button(ui, "play", "Запустити (виконати вибране зліва)", false, OK).clicked() {
                            self.run_selected();
                        }
                        let (name, ic) = [("Збірка (файл)", "file"), ("Збірка (гра)", "game"), ("Поточна сцена", "flag")][self.run_cfg];
                        let resp = pill(ui, None, Some(ic), name, true, true);
                        pop(ui, &resp, "cfgpop", |ui| {
                            for (i, (name, sub)) in [("Збірка (файл)", "Записати переклад у файли гри (з вибором параметрів)"), ("Збірка (гра)", "Записати переклад із чернетками й запустити гру"), ("Поточна сцена", "Те саме, але гра починається зі сцени вибраного рядка")].iter().enumerate() {
                                if ui.selectable_label(self.run_cfg == i, *name).on_hover_text(*sub).clicked() {
                                    self.run_cfg = i;
                                }
                            }
                        });
                    });
                });
            });
        });
    }

    fn menu_file(&mut self, ui: &mut egui::Ui) {
            if ui.button("Відкрити гру…").clicked() {
                self.open_dialog();
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Зберегти проєкт")).clicked() {
                self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Злити з іншим проєктом…")).clicked() {
                self.act_merge();
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Повернути оригінали гри")).clicked() {
                self.act_restore();
                ui.close_menu();
            }
            ui.separator();
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Імпорт пам’яті й глосарія…")).clicked() {
                self.import_win = Some((0, String::new()));
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Додати довідкову мову…")).clicked() {
                self.ref_win = Some(String::new());
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Налаштування проєкту…")).clicked() {
                self.act_settings();
                ui.close_menu();
            }
    }

    fn menu_view(&mut self, ui: &mut egui::Ui) {
            if ui.button(if self.focus { "Режим таблиці" } else { "Режим «Фокус»" }).clicked() {
                self.focus = !self.focus;
                ui.close_menu();
            }
            if ui.button(if self.bottom_open { "Сховати нижню панель" } else { "Показати нижню панель" }).clicked() {
                self.bottom_open = !self.bottom_open;
                ui.close_menu();
            }
    }

    fn menu_tools(&mut self, ui: &mut egui::Ui) {
            if ui.add_enabled(self.st.is_open(), egui::Button::new(if self.st.syncing() { "Синхронізація триває…" } else { "Синхронізація через GitHub…" })).clicked() {
                self.act_sync();
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Активність…")).clicked() {
                self.activity_win = true;
                ui.close_menu();
            }
            if ui.add_enabled(self.st.last_term_change.is_some(), egui::Button::new("Оновити за глосарієм…")).clicked() {
                self.open_term_sync();
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Перенесення рядків…")).clicked() {
                self.wrap_win = Some((self.st.wrap_settings(), "Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.".into(), false));
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Правила QA…")).clicked() {
                self.qar_win = true;
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Гілки перекладу…")).clicked() {
                self.br_win = Some(String::new());
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Групи рядків…")).clicked() {
                self.groups_win = Some(String::new());
                ui.close_menu();
            }
            if ui.add_enabled(self.st.is_open(), egui::Button::new("Мовці…")).clicked() {
                self.spk_win = Some(self.st.speaker_candidates());
                ui.close_menu();
            }
            if ui.button("Плагіни…").clicked() {
                self.act_plugins();
                ui.close_menu();
            }
    }

    fn menu_actions(&mut self, ui: &mut egui::Ui) {
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
    }

    /// Кнопка «Запуск»: те, що обрано в списку конфігурацій (як у старому застосунку).
    fn run_selected(&mut self) {
        if self.run_cfg == 0 {
            self.build_win = Some(self.st.build_defaults());
            return;
        }
        if self.st.game_exe().is_none() {
            if let Some(p) = rfd::FileDialog::new().set_title("Оберіть програму гри (Game.exe)").add_filter("Програма", &["exe"]).pick_file() {
                self.st.set_game_exe(&p);
            }
        }
        self.message = if self.run_cfg == 1 {
            self.st.play_game().unwrap_or_else(|e| e)
        } else {
            match self.st.file.zip(self.st.row) {
                Some((f, r)) => self.st.play_from(f, r, true).unwrap_or_else(|e| e),
                None => "Виберіть рядок, зі сцени якого стартувати".into(),
            }
        };
    }

    // дії меню
    fn act_restore(&mut self) {
            self.message = self.st.restore_originals().unwrap_or_else(|e| e);
        
    }

    fn act_merge(&mut self) {
            if let Some(p) = rfd::FileDialog::new().add_filter("Проєкт Transly", &["json"]).pick_file() {
                self.message = self.st.merge_file(&p).unwrap_or_else(|e| e);
            }
        
    }

    fn act_sync(&mut self) {
 self.sync_win = Some((self.st.github_settings(), self.token.clone()));
    }

    fn act_plugins(&mut self) {
            self.plugins_win = true;
        
    }

    fn act_settings(&mut self) {
            self.settings = self.st.settings_view();
        
    }

    fn open_dialog(&mut self) {
        if let Some(dir) = rfd::FileDialog::new().set_title("Оберіть папку гри (data)").pick_folder() {
            self.message = match self.st.open_game(&dir) {
                Ok(n) => format!("Відкрито: {n} файлів із текстом{}", if self.st.last_note.is_empty() { String::new() } else { format!(". {}", self.st.last_note) }),
                Err(e) => e,
            };
            self.draft_for = None;
        }
    
    }

    fn statusbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("status").exact_height(26.0).show_separator_line(false).frame(egui::Frame::new().fill(GROUND).inner_margin(egui::Margin::symmetric(12, 0))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 16.0;
                let small = |t: String, c: Color32| RichText::new(t).size(11.5).color(c);
                if self.st.is_open() {
                    // збереження
                    let (dot, text) = if self.st.dirty {
                        (WARN, "Є незбережені зміни".to_string())
                    } else if let Some(ms) = self.st.saved_ms {
                        let t = chrono::DateTime::from_timestamp_millis(ms).map(|d| d.with_timezone(&chrono::Local).format("%H:%M:%S").to_string()).unwrap_or_default();
                        (OK, format!("Збережено о {t}"))
                    } else {
                        (OK, "Проєкт відкрито".to_string())
                    };
                    let (r, _) = ui.allocate_exact_size(vec2(8.0, 8.0), Sense::hover());
                    ui.painter().circle_filled(r.center(), 3.5, dot);
                    ui.add_space(-12.0);
                    ui.label(small(text, if dot == OK { OK } else { WARN }));
                    if let Some(f) = self.st.file {
                        let bad = self.st.file_issues(f).iter().filter(|i| i.2).count();
                        if bad > 0 {
                            ui.label(small(format!("{bad} проблем QA"), BAD));
                        }
                        if let Some(r) = self.st.row {
                            ui.label(small(format!("Рядок {} з {}", r + 1, self.st.row_count(f)), MUTE));
                        }
                    }
                    if self.st.current_branch() != "main" {
                        ui.label(small(format!("гілка: {}", self.st.current_branch()), VIOLET));
                    }
                } else {
                    ui.label(small("Гру не відкрито".into(), MUTE));
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if self.st.is_open() {
                        let p = self.st.progress();
                        ui.label(small(format!("Проєкт: {} / {} вичитано · {} чекає вичитування", p.approved, p.total, p.sent), MUTE));
                        if let Some(f) = self.st.file {
                            let n = self.st.row_count(f);
                            let c = self.st.filter_counts(f);
                            ui.label(small(format!("Файл: {} / {} вичитано · {} чекає", c[4], n, c[3]), MUTE));
                        }
                    }
                    ui.label(small(self.message.clone(), MUTE));
                });
            });
        });
    }

    fn bottom(&mut self, ctx: &egui::Context) {
        let Some(f) = self.st.file else { return };
        let h = if self.bottom_open { 210.0 } else { 30.0 };
        egui::TopBottomPanel::bottom("bottom").exact_height(h).resizable(false).show_separator_line(false).frame(card()).show(ctx, |ui| {
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
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, label.clone()));
                ui.painter().text(r.center(), Align2::CENTER_CENTER, label, FontId::proportional(12.5), if on || resp.hovered() { TEXT } else { MUTE });
                if *is_bad {
                    ui.painter().circle_filled(pos2(r.right() - 8.0, r.center().y - 5.0), 3.0, BAD);
                }
                if on {
                    ui.painter().hline(r.x_range(), tabs.bottom() - 1.0, Stroke::new(2.0_f32, accent()));
                }
                if resp.clicked() {
                    self.btab = i;
                    self.bottom_open = true;
                }
                x += w;
            }
            let toggle = Rect::from_min_size(pos2(tabs.right() - 28.0, tabs.top()), vec2(24.0, 30.0));
            let tr = ui.interact(toggle, ui.id().with("btoggle"), Sense::click());
            ui.painter().text(toggle.center(), Align2::CENTER_CENTER, if self.bottom_open { "v" } else { "^" }, FontId::proportional(12.0), MUTE);
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
                ui.label("Однакові рядки");
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut v.link_mode, "ask".to_string(), "після надсилання заповнювати порожні");
                    ui.selectable_value(&mut v.link_mode, "auto".to_string(), "оновлювати всі самі");
                    ui.selectable_value(&mut v.link_mode, "off".to_string(), "не чіпати");
                });
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
                if ui.add_enabled(count > 0, egui::Button::new(RichText::new("Замінити все").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
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
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("Записати чернетками ({n})")).color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
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

    fn build_window(&mut self, ctx: &egui::Context) {
        let Some(mut c) = self.build_win else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        let preview = self.st.build_preview(&c);
        egui::Window::new("Збірка в гру").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
            ui.checkbox(&mut c.only_approved, "Лише вичитані рядки");
            ui.add_enabled(!c.only_approved, egui::Checkbox::new(&mut c.include_drafts, "Додати чернетки (щоб перевірити переклад у грі)"));
            ui.checkbox(&mut c.block_errors, "Рядки з помилкою QA лишати мовою оригіналу");
            ui.add_space(8.0);
            match &preview {
                Ok((inc, skip, blocked)) => {
                    ui.label(RichText::new(format!("У грі буде рядків: {inc}")).color(TEXT));
                    ui.label(RichText::new(format!("Поза збіркою: {skip}{}", if *blocked > 0 { format!(" (з них через помилки QA: {blocked})") } else { String::new() })).color(MUTE));
                }
                Err(e) => {
                    ui.label(RichText::new(e).color(BAD));
                }
            }
            ui.label(RichText::new("Файли гри не змінюються безповоротно: копії оригіналів лежать поруч, їх можна повернути.").size(11.0).color(MUTE));
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if primary_button(ui, "Зібрати").clicked() {
                    go = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if go {
            self.message = self.st.build_with(&c).unwrap_or_else(|e| e);
            self.build_win = None;
        } else if close || !open {
            self.build_win = None;
        } else {
            self.build_win = Some(c);
        }
    }

    fn import_window(&mut self, ctx: &egui::Context) {
        let Some((mut kind, mut text)) = self.import_win.take() else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        egui::Window::new("Імпорт").open(&mut open).collapsible(false).default_width(520.0).show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.selectable_value(&mut kind, 0, "Пам’ять перекладів");
                ui.selectable_value(&mut kind, 1, "Глосарій із таблиці");
            });
            ui.add_space(6.0);
            ui.label(RichText::new(if kind == 0 { "Рядки «оригінал, табуляція, переклад». Пари потраплять у підказки вкладки «Пам’ять»." } else { "CSV, TSV чи HTML-таблиця (підходить експорт Google Sheets): колонка «Оригінал» і «Переклад» (можна кілька), «Опис», «Розділ»." }).size(11.5).color(MUTE));
            if plain_button(ui, "Завантажити з файлу…").clicked() {
                if let Some(p) = rfd::FileDialog::new().add_filter("Текст і таблиці", &["txt", "tsv", "csv", "html", "htm"]).pick_file() {
                    text = std::fs::read_to_string(p).unwrap_or_default();
                }
            }
            ui.add(egui::TextEdit::multiline(&mut text).desired_rows(10).desired_width(f32::INFINITY));
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(!text.trim().is_empty(), egui::Button::new(RichText::new("Імпортувати").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    go = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if go {
            self.message = if kind == 0 { self.st.import_memory(&text) } else { self.st.import_terms_table(&text) };
            text.clear();
        }
        if !close && open {
            self.import_win = Some((kind, text));
        }
    }

    fn speakers_window(&mut self, ctx: &egui::Context) {
        let Some(mut list) = self.spk_win.take() else { return };
        let mut open = true;
        let (mut save, mut close) = (false, false);
        egui::Window::new("Мовці").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
            if list.is_empty() {
                ui.label(RichText::new("У рядках гри нема що визначати: усі діалоги вже мають мовця.").color(MUTE));
            } else {
                ui.label(RichText::new("Дайте ім'я тому, хто говорить: за ім'ям у тексті, обличчям, позначкою розробника чи подією. Ім'я з'явиться в таблиці й сцені.").size(11.5).color(MUTE));
                egui::ScrollArea::vertical().max_height(340.0).show(ui, |ui| {
                    for (c, name) in list.iter_mut() {
                        ui.horizontal(|ui| {
                            let kind = match c.kind {
                                transly_core::speakers::CandKind::Hdr => "імʼя в тексті",
                                transly_core::speakers::CandKind::Face => "обличчя",
                                transly_core::speakers::CandKind::Note => "позначка",
                                transly_core::speakers::CandKind::Event => "подія",
                            };
                            ui.vertical(|ui| {
                                ui.label(RichText::new(format!("{}  ({kind}, рядків: {})", c.label, c.count)).color(TEXT));
                                ui.label(RichText::new(&c.sample).size(11.0).color(MUTE));
                            });
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                ui.add(egui::TextEdit::singleline(name).hint_text("ім'я").desired_width(160.0));
                            });
                        });
                        ui.separator();
                    }
                });
            }
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if primary_button(ui, "Зберегти").clicked() {
                    save = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if save {
            let names: Vec<(String, String)> = list.iter().map(|(c, n)| (c.key.clone(), n.clone())).collect();
            self.message = self.st.set_speakers(&names);
        }
        if !close && open && !save {
            self.spk_win = Some(list);
        }
    }

    fn reference_window(&mut self, ctx: &egui::Context) {
        let Some(mut lang) = self.ref_win.take() else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        egui::Window::new("Довідкова мова").open(&mut open).collapsible(false).resizable(false).default_width(440.0).show(ctx, |ui| {
            ui.label(RichText::new("Оберіть папку тієї самої гри іншою мовою (наприклад, офіційна російська чи польська версія): її тексти з'являться в інспекторі як довідка.").size(11.5).color(MUTE));
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label("Код мови");
                ui.add(egui::TextEdit::singleline(&mut lang).hint_text("ru").desired_width(80.0));
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(!lang.trim().is_empty(), egui::Button::new(RichText::new("Обрати папку…").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    go = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if go {
            if let Some(dir) = rfd::FileDialog::new().set_title("Папка гри іншою мовою (data)").pick_folder() {
                self.message = self.st.import_reference(&dir, &lang).unwrap_or_else(|e| e);
                close = true;
            }
        }
        if !close && open {
            self.ref_win = Some(lang);
        }
    }

    fn groups_window(&mut self, ctx: &egui::Context) {
        let Some(mut name) = self.groups_win.take() else { return };
        let mut open = true;
        let cur = self.st.file.zip(self.st.row);
        let mut act: Option<(String, u8)> = None; // 0 рядок, 1 сцена, 2 файл, 3 показати, 4 видалити
        let mut create = false;
        let mut auto: Option<bool> = None;
        egui::Window::new("Групи рядків").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
            ui.label(RichText::new("Група — набір рядків, який зручно перекладати разом (персонаж, квест, мапа). Додайте вибраний рядок, його сцену чи файл.").size(11.5).color(MUTE));
            ui.add_space(6.0);
            for g in self.st.groups_view() {
                egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        let (d, _) = ui.allocate_exact_size(vec2(12.0, 14.0), Sense::hover());
                        let col = u32::from_str_radix(g.color.trim_start_matches('#'), 16).map_or(accent(), |c| Color32::from_rgb((c >> 16) as u8, (c >> 8) as u8, c as u8));
                        ui.painter().circle_filled(d.center(), 5.0, col);
                        ui.label(RichText::new(&g.name).color(TEXT));
                        ui.label(RichText::new(format!("{} з {} перекладено", g.translated, g.rows)).size(11.0).color(MUTE));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.small_button("Видалити").clicked() {
                                act = Some((g.id.clone(), 4));
                            }
                            if ui.small_button("Показати").clicked() {
                                act = Some((g.id.clone(), 3));
                            }
                        });
                    });
                    if cur.is_some() {
                        ui.horizontal(|ui| {
                            for (label, k) in [("+ рядок", 0u8), ("+ сцена", 1), ("+ файл", 2)] {
                                if ui.small_button(label).clicked() {
                                    act = Some((g.id.clone(), k));
                                }
                            }
                        });
                    }
                });
                ui.add_space(4.0);
            }
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.add(egui::TextEdit::singleline(&mut name).hint_text("Назва нової групи").desired_width(220.0));
                if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(RichText::new("Створити").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    create = true;
                }
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if plain_button(ui, "Групи за мовцями").clicked() {
                    auto = Some(true);
                }
                if plain_button(ui, "Групи за сценами").clicked() {
                    auto = Some(false);
                }
            });
        });
        if let Some((id, k)) = act {
            match (k, cur) {
                (3, _) => self.st.group_filter = Some(id),
                (4, _) => self.st.delete_group(&id),
                (k, Some((f, r))) => {
                    let n = self.st.place_in_group(f, r, k, Some(&id));
                    self.message = format!("У групу додано рядків: {n}");
                }
                _ => {}
            }
        }
        if create {
            self.message = self.st.create_group(&name);
            name.clear();
        }
        if let Some(by_speaker) = auto {
            self.message = format!("Створено груп: {}", self.st.auto_groups(by_speaker));
        }
        if open {
            self.groups_win = Some(name);
        }
    }

    fn branches_window(&mut self, ctx: &egui::Context) {
        let Some(mut name) = self.br_win.take() else { return };
        let mut open = true;
        let mut act: Option<(String, u8)> = None; // 0 перемкнути, 1 злити, 2 видалити
        let mut create = false;
        egui::Window::new("Гілки перекладу").open(&mut open).collapsible(false).default_width(480.0).show(ctx, |ui| {
            ui.label(RichText::new("Гілка — окрема версія перекладу (наприклад, інший стиль). Злиття бере нові й змінені рядки, конфлікти лишає як є; його можна скасувати.").size(11.5).color(MUTE));
            ui.add_space(6.0);
            for (n, rows, cur) in self.st.branches_view() {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(if cur { format!("{n}  (поточна)") } else { n.clone() }).color(TEXT));
                    ui.label(RichText::new(format!("рядків: {rows}")).size(11.0).color(MUTE));
                    if !cur {
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.small_button("Видалити").clicked() {
                                act = Some((n.clone(), 2));
                            }
                            if ui.small_button("Злити сюди").clicked() {
                                act = Some((n.clone(), 1));
                            }
                            if ui.small_button("Назва").clicked() {
                                act = Some((n.clone(), 3));
                            }
                            if ui.small_button("Перемкнутись").clicked() {
                                act = Some((n.clone(), 0));
                            }
                        });
                    }
                });
            }
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.add(egui::TextEdit::singleline(&mut name).hint_text("Назва нової гілки").desired_width(220.0));
                if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(RichText::new("Створити з поточної").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    create = true;
                }
            });
        });
        if let Some((n, k)) = act {
            self.message = match k {
                0 => self.st.switch_branch(&n).map(|_| format!("Гілка «{n}»")).unwrap_or_else(|e| e),
                1 => match self.st.branch_diff(&n) {
                    Ok(rows) if rows.iter().any(|r| r.kind == transly_core::branches::DiffKind::Conflict && !r.locked) => {
                        self.merge_win = Some((n.clone(), rows, Default::default()));
                        String::new()
                    }
                    Ok(_) => self.st.merge_branch(&n).unwrap_or_else(|e| e),
                    Err(e) => e,
                },
                3 => {
                    self.rename_win = Some((n.clone(), n.clone()));
                    String::new()
                }
                _ => self.st.delete_branch(&n).map(|_| format!("Гілку «{n}» видалено")).unwrap_or_else(|e| e),
            };
        }
        if create {
            self.message = self.st.create_branch(&name).map(|_| format!("Гілка «{}»", name.trim())).unwrap_or_else(|e| e);
            name.clear();
        }
        if open {
            self.br_win = Some(name);
        }
    }

    fn qarules_window(&mut self, ctx: &egui::Context) {
        if !self.qar_win {
            return;
        }
        let f = self.st.file.unwrap_or(0);
        let mut open = true;
        let mut set: Option<(String, &'static str)> = None;
        let mut fix: Option<String> = None;
        let (mut apo, mut words) = self.keep_edit.take().unwrap_or_else(|| self.st.qa_keep());
        let before = (apo.clone(), words.clone());
        egui::Window::new("Правила QA").open(&mut open).collapsible(false).default_width(620.0).default_height(440.0).show(ctx, |ui| {
            ui.label(RichText::new("Правила про форму перекладу: літери чужого алфавіту, приховані знаки, пробіли тощо. Кількість — у поточному файлі.").size(11.5).color(MUTE));
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label("Апостроф");
                for (v, label) in [("any", "будь-який правильний"), ("’", "лише ’"), ("ʼ", "лише ʼ"), ("'", "лише '")] {
                    ui.selectable_value(&mut apo, v.to_string(), label);
                }
            });
            ui.label(RichText::new("Латинські слова, які дозволено лишати в українському тексті (по слову в рядку):").size(11.5).color(MUTE));
            ui.add(egui::TextEdit::multiline(&mut words).desired_rows(2).desired_width(f32::INFINITY));
            ui.add_space(6.0);
            egui::ScrollArea::vertical().show(ui, |ui| {
                for (id, title, explain, level, rows, fixable) in self.st.qa_rules_view(f) {
                    egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(&title).color(TEXT));
                            ui.label(RichText::new(format!("рядків: {rows}")).size(11.0).color(MUTE));
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if fixable > 0 && ui.small_button(format!("Виправити ({fixable})")).clicked() {
                                    fix = Some(id.clone());
                                }
                                for (lv, label) in [("bad", "Помилка"), ("warn", "Порада"), ("off", "Вимкнено")] {
                                    if ui.selectable_label(level == lv, label).clicked() {
                                        set = Some((id.clone(), lv));
                                    }
                                }
                            });
                        });
                        ui.label(RichText::new(&explain).size(11.0).color(MUTE));
                    });
                    ui.add_space(4.0);
                }
            });
        });
        if let Some((id, lv)) = set {
            self.st.set_rule_level(&id, lv);
        }
        if let Some(id) = fix {
            let n = self.st.fix_qa_rule(&id);
            self.message = format!("Виправлено рядків: {n}");
        }
        if (apo.clone(), words.clone()) != before {
            self.st.set_qa_keep(&apo, &words);
        }
        self.keep_edit = if open { Some((apo, words)) } else { None };
        self.qar_win = open;
    }

    fn wrap_window(&mut self, ctx: &egui::Context) {
        use transly_core::wrapconfig::{HyphenMode, WrapKeep, WrapMode};
        let Some((mut w, mut sample, mut face)) = self.wrap_win.take() else { return };
        let before = w.clone();
        let mut open = true;
        egui::Window::new("Перенесення рядків").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
            ui.label(RichText::new("Вікно повідомлення в грі не переносить рядки саме. Тут обираєте, хто це робить і як. Довжина перекладу ніколи не обмежується, це лише рекомендації. Ширину задає «Налаштування проєкту → Довжина рядка».").size(11.5).color(MUTE));
            ui.add_space(6.0);
            label_caps(ui, "Коли переносити");
            ui.radio_value(&mut w.mode, WrapMode::Build, "Під час збірки й запуску гри (рекомендовано)");
            ui.radio_value(&mut w.mode, WrapMode::Text, "У тексті, коли надсилаю рядок");
            ui.radio_value(&mut w.mode, WrapMode::Off, "Не переносити (лише попереджати)");
            ui.add_space(6.0);
            label_caps(ui, "Переніс слів");
            ui.horizontal(|ui| {
                ui.selectable_value(&mut w.hyphen, HyphenMode::Off, "не переносити слова");
                ui.selectable_value(&mut w.hyphen, HyphenMode::Needed, "лише коли треба");
                ui.selectable_value(&mut w.hyphen, HyphenMode::Fill, "коли краще заповнює");
            });
            ui.horizontal(|ui| {
                ui.label("Літер до / після переносу");
                ui.add(egui::DragValue::new(&mut w.min_left).range(1..=6));
                ui.add(egui::DragValue::new(&mut w.min_right).range(1..=6));
            });
            ui.add_space(6.0);
            label_caps(ui, "Розриви, які поставили ви");
            ui.radio_value(&mut w.keep, WrapKeep::Long, "Зберігати, переносити лише задовгі (рекомендовано)");
            ui.radio_value(&mut w.keep, WrapKeep::Reflow, "Збирати текст заново завжди");
            ui.horizontal(|ui| {
                ui.label("Попереджати, коли рядків більше, ніж (0 — вимкнено)");
                ui.add(egui::DragValue::new(&mut w.max_lines).range(0..=12));
            });
            ui.add_space(6.0);
            label_caps(ui, "Приклад");
            ui.add(egui::TextEdit::multiline(&mut sample).desired_rows(3).desired_width(f32::INFINITY));
            ui.checkbox(&mut face, "Поруч портрет персонажа");
            let (shown, n) = self.st.wrap_preview(&sample, face);
            ui.label(RichText::new(shown).monospace().color(TEXT));
            ui.label(RichText::new(format!("Рядків: {n}")).size(11.0).color(MUTE));
        });
        if w != before {
            self.st.set_wrap_settings(&w);
        }
        if open {
            self.wrap_win = Some((w, sample, face));
        }
    }

    fn merge_window(&mut self, ctx: &egui::Context) {
        use transly_core::branches::{row_id, Decision, DiffKind};
        let Some((src, rows, mut dec)) = self.merge_win.take() else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        egui::Window::new(format!("Злиття гілки «{src}»")).open(&mut open).collapsible(false).default_width(680.0).default_height(460.0).show(ctx, |ui| {
            ui.label(RichText::new("Нові й змінені рядки беруться. У конфліктах змінили обидві гілки: оберіть, чий переклад лишити (без вибору лишається ваш).").size(11.5).color(MUTE));
            egui::ScrollArea::vertical().max_height(340.0).show(ui, |ui| {
                for r in rows.iter().filter(|r| r.kind == DiffKind::Conflict && !r.locked) {
                    let id = row_id(&r.file, &r.key);
                    let mine = r.mine.as_ref().map_or("", |e| e.target.as_str()).to_string();
                    egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 6)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.label(RichText::new(format!("{} · {}", r.file, r.key)).monospace().size(10.5).color(MUTE));
                        let cur = dec.get(&id).cloned();
                        if ui.radio(matches!(cur, None | Some(Decision::Mine)), format!("Мій: {mine}")).clicked() {
                            dec.insert(id.clone(), Decision::Mine);
                        }
                        if ui.radio(matches!(cur, Some(Decision::Theirs)), format!("Їхній: {}", r.theirs.target)).clicked() {
                            dec.insert(id.clone(), Decision::Theirs);
                        }
                    });
                    ui.add_space(3.0);
                }
            });
            ui.horizontal(|ui| {
                if primary_button(ui, "Злити").clicked() {
                    go = true;
                }
                if plain_button(ui, "Скасувати").clicked() {
                    close = true;
                }
            });
        });
        if go {
            let d = dec.clone();
            self.message = self.st.merge_branch_with(&src, &move |id| d.get(id).cloned()).unwrap_or_else(|e| e);
            close = true;
        }
        if !close && open {
            self.merge_win = Some((src, rows, dec));
        }
    }

    fn rename_window(&mut self, ctx: &egui::Context) {
        let Some((from, mut to)) = self.rename_win.take() else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        egui::Window::new("Назва гілки").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
            ui.add(egui::TextEdit::singleline(&mut to).desired_width(260.0));
            ui.horizontal(|ui| {
                if primary_button(ui, "Перейменувати").clicked() {
                    go = true;
                }
                if plain_button(ui, "Скасувати").clicked() {
                    close = true;
                }
            });
        });
        if go {
            self.message = self.st.rename_branch(&from, &to).map(|_| format!("Гілка «{}»", to.trim())).unwrap_or_else(|e| e);
            close = true;
        }
        if !close && open {
            self.rename_win = Some((from, to));
        }
    }

    fn open_term_sync(&mut self) {
        let Some(change) = self.st.last_term_change.clone() else { return };
        let sync = self.st.term_sync(&change);
        if sync.total == 0 {
            self.message = format!("Рядків зі старою формою «{}» не знайдено", change.old.join("», «"));
            return;
        }
        self.tsync_win = Some((change, sync.proposals.into_iter().map(|p| { let (t, c) = (p.tick, vec![-1i64; p.spans.len()]); (p, t, c) }).collect()));
    }

    fn term_sync_window(&mut self, ctx: &egui::Context) {
        let Some((change, mut rows)) = self.tsync_win.take() else { return };
        let mut open = true;
        let (mut go, mut close) = (false, false);
        egui::Window::new(format!("Оновити за глосарієм: {} → {}", change.old.join(", "), change.next)).open(&mut open).collapsible(false).default_width(720.0).default_height(480.0).show(ctx, |ui| {
            ui.label(RichText::new("Рядки зі старою формою терміна. Позначені лише впевнені заміни, де в оригіналі є цей термін; решту перевірте самі. Статус рядків не змінюється, дію можна скасувати.").size(11.5).color(MUTE));
            let n = rows.iter().filter(|r| r.1).count();
            ui.horizontal(|ui| {
                ui.label(RichText::new(format!("Знайдено {}, вибрано {n}", rows.len())).size(11.5).color(MUTE));
                if plain_button(ui, "Позначити лише впевнені").clicked() {
                    for r in rows.iter_mut() {
                        r.1 = r.0.tick;
                    }
                }
            });
            egui::ScrollArea::vertical().max_height(340.0).show(ui, |ui| {
                for (p, on, choice) in rows.iter_mut() {
                    egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 6)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.checkbox(on, RichText::new(format!("{} · {}", p.file, if p.conf.level == "high" { "впевнено" } else { "перевірте" })).size(11.0).color(MUTE));
                        ui.label(RichText::new(&p.before).color(MUTE));
                        ui.label(RichText::new(transly_core::termsync::apply_spans(&p.before, &p.spans, choice)).color(TEXT));
                        for (si, sp) in p.spans.iter().enumerate() {
                            if sp.alts.is_empty() {
                                continue;
                            }
                            let cur = choice[si];
                            let shown = if cur < 0 { sp.text.clone() } else { sp.alts.get(cur as usize).map_or(sp.text.clone(), |a| a.text.clone()) };
                            egui::ComboBox::from_id_salt(format!("alt-{}-{}-{si}", p.file, p.key)).selected_text(format!("інша форма: {shown}")).show_ui(ui, |ui| {
                                if ui.selectable_label(cur < 0, &sp.text).clicked() {
                                    choice[si] = -1;
                                }
                                for (ai, a) in sp.alts.iter().enumerate() {
                                    if ui.selectable_label(cur == ai as i64, &a.text).clicked() {
                                        choice[si] = ai as i64;
                                    }
                                }
                            });
                        }
                    });
                    ui.add_space(3.0);
                }
            });
            ui.horizontal(|ui| {
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new("Оновити вибрані").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    go = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if go {
            let picks: Vec<_> = rows.iter().filter(|r| r.1).map(|r| (r.0.clone(), r.2.clone())).collect();
            self.message = format!("Оновлено рядків: {}", self.st.apply_term_sync(&picks));
            close = true;
        }
        if !close && open {
            self.tsync_win = Some((change, rows));
        }
    }

    fn activity_window(&mut self, ctx: &egui::Context) {
        if !self.activity_win {
            return;
        }
        let mut open = true;
        let mut undo: Option<String> = None;
        egui::Window::new("Активність").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
            ui.label(RichText::new("Масові дії (надсилання, вичитка, автозаповнення, заміни, злиття) можна скасувати, поки рядки не змінено, і потім повторити.").size(11.5).color(MUTE));
            ui.add_space(6.0);
            let items = self.st.activity();
            if items.is_empty() {
                ui.label(RichText::new("Масових дій ще не було").color(MUTE));
            }
            egui::ScrollArea::vertical().show(ui, |ui| {
                for a in items {
                    egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(R2)).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(&a.title).color(TEXT));
                            ui.label(RichText::new(&a.when).size(11.0).color(MUTE));
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if ui.small_button(a.label).clicked() {
                                    undo = Some(a.id.clone());
                                }
                            });
                        });
                        for (src, tgt) in &a.sample {
                            ui.label(RichText::new(format!("{}  →  {}", src.replace('\n', " / "), tgt.replace('\n', " / "))).size(11.0).color(MUTE));
                        }
                        if a.more > 0 {
                            ui.label(RichText::new(format!("…і ще {} змінено після цього", a.more)).size(11.0).color(MUTE));
                        }
                    });
                    ui.add_space(4.0);
                }
            });
        });
        if let Some(id) = undo {
            self.message = self.st.undo_batch(&id);
        }
        self.activity_win = open;
    }

    fn keys_window(&mut self, ctx: &egui::Context) {
        if !self.keys_win {
            return;
        }
        let mut open = true;
        egui::Window::new("Гарячі клавіші").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
            egui::Grid::new("keys").num_columns(2).spacing([24.0, 6.0]).show(ui, |ui| {
                for (k, what) in [("Ctrl+Enter", "надіслати рядок і перейти до наступного"), ("Ctrl+S", "зберегти проєкт"), ("F2", "режим «Редагування»"), ("↑ / ↓", "попередній / наступний рядок (поки не набираєте текст)")] {
                    ui.label(RichText::new(k).monospace().color(TEXT));
                    ui.label(RichText::new(what).color(MUTE));
                    ui.end_row();
                }
            });
        });
        self.keys_win = open;
    }

    fn strip(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("strip").exact_width(40.0).resizable(false).show_separator_line(false).frame(egui::Frame::new().fill(GROUND)).show(ctx, |ui| {
            ui.add_space(6.0);
            ui.vertical_centered(|ui| {
                for (i, (g, tip)) in [("Ф", "Файли"), ("Р", "Рядки файлу"), ("С", "Сцени файлу"), ("П", "Пов’язане з рядком: терміни, однакові рядки")].iter().enumerate() {
                    let (r, resp) = ui.allocate_exact_size(vec2(30.0, 30.0), Sense::click());
                    let on = i == self.rail;
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Панель: {tip}")));
                    if on || resp.hovered() {
                        ui.painter().rect_filled(r, CornerRadius::same(R2), GHOST_HOVER);
                    }
                    if on {
                        ui.painter().rect_filled(Rect::from_min_size(pos2(r.left() - 5.0, r.top() + 7.0), vec2(3.0, r.height() - 14.0)), CornerRadius::same(R1), accent());
                    }
                    ui.painter().text(r.center(), Align2::CENTER_CENTER, g, FontId::proportional(15.0), if on { TEXT } else { MUTE });
                    if resp.on_hover_text(*tip).clicked() {
                        self.rail = i;
                    }
                }
            });
        });
    }

    /// Бічні панелі «Рядки», «Сцени», «Пов’язане» (замість дерева файлів).
    fn rail_panel(&mut self, ui: &mut egui::Ui) {
        let Some(f) = self.st.file else {
            ui.add_space(12.0);
            ui.vertical_centered(|ui| ui.label(RichText::new("Відкрийте файл").color(MUTE)));
            return;
        };
        match self.rail {
            1 => self.compact_list(ui, f),
            2 => {
                let list = self.st.scenes_list(f);
                if list.is_empty() {
                    ui.add_space(12.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("У цьому файлі немає сцен").color(MUTE)));
                    return;
                }
                let cur = self.st.row.and_then(|r| self.st.scene_view(f, r)).map(|v| v.title);
                egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 0.0;
                    for (title, first, n) in list {
                        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::click());
                        let on = cur.as_deref() == Some(title.as_str());
                        resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Сцена {title}")));
                        if on {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, sel_use());
                        } else if resp.hovered() {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, TREE_HOVER);
                        }
                        ui.painter().text(pos2(rect.right() - 10.0, rect.center().y), Align2::RIGHT_CENTER, n.to_string(), FontId::monospace(10.5), DIM);
                        let clip = Rect::from_min_max(rect.min + vec2(12.0, 0.0), pos2(rect.right() - 36.0, rect.bottom()));
                        ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.center().y), Align2::LEFT_CENTER, &title, FontId::proportional(12.5), TEXT);
                        if resp.clicked() {
                            self.st.row = Some(first);
                        }
                    }
                });
            }
            _ => {
                let Some(r) = self.st.row else {
                    ui.add_space(12.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("Виберіть рядок").color(MUTE)));
                    return;
                };
                egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                    egui::Frame::new().inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                        label_caps(ui, "Терміни глосарія в оригіналі");
                        let terms = self.st.terms();
                        let mut seen = std::collections::BTreeSet::new();
                        for (_, _, ti) in self.st.source_marks(f, r) {
                            if seen.insert(ti) {
                                if let Some(t) = terms.get(ti) {
                                    ui.label(RichText::new(format!("{}  -  {}", t.en, t.uk)).color(TEXT));
                                }
                            }
                        }
                        if seen.is_empty() {
                            ui.label(RichText::new("нема").color(MUTE));
                        }
                        ui.add_space(8.0);
                        label_caps(ui, "Однакові рядки");
                        match self.st.link_info(f, r) {
                            Some((o, fl, up, ed)) => {
                                ui.label(RichText::new(format!("Ще {o} з таким самим оригіналом: порожніх {fl}, старіших {up}, змінених вручну {ed}")).color(MUTE));
                            }
                            None => {
                                ui.label(RichText::new("нема").color(MUTE));
                            }
                        }
                        let refs = self.st.references_of(f, r);
                        if !refs.is_empty() {
                            ui.add_space(8.0);
                            label_caps(ui, "Довідкові мови");
                            for (lang, text) in refs {
                                ui.label(RichText::new(format!("{lang}: {text}")).color(SRC_TEXT));
                            }
                        }
                    });
                });
            }
        }
    }

    fn tree(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("tree").exact_width(258.0).resizable(false).show_separator_line(false).frame(card()).show(ctx, |ui| {
            let (h, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
            ui.painter().text(h.left_center() + vec2(10.0, 0.0), Align2::LEFT_CENTER, ["ФАЙЛИ ГРИ", "РЯДКИ", "СЦЕНИ", "ПОВ’ЯЗАНЕ"][self.rail], FontId::proportional(11.0), MUTE);
            ui.painter().hline(h.x_range(), h.bottom(), Stroke::new(1.0_f32, LINE));
            if self.rail != 0 {
                self.rail_panel(ui);
                return;
            }
            let prog = self.st.file_progress();
            let names = self.st.file_names();
            // теки, як у старому застосунку: дані гри, мапи, текстові файли
            let kind = |n: &str| -> usize {
                let b = n.rsplit('/').next().unwrap_or(n);
                if !b.to_lowercase().ends_with(".json") {
                    2
                } else if b.starts_with("Map") && b[3..].trim_end_matches(".json").chars().all(|c| c.is_ascii_digit()) && b.len() > 8 {
                    1
                } else {
                    0
                }
            };
            let folders = [("data", 0usize), ("maps", 1), ("Тексти", 2)];
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                for (title, k) in folders {
                    let members: Vec<usize> = (0..names.len()).filter(|i| kind(&names[*i]) == k).collect();
                    if members.is_empty() {
                        continue;
                    }
                    let open = !self.tree_closed.contains(&k);
                    let (hr, hresp) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::click());
                    if hresp.hovered() {
                        ui.painter().rect_filled(hr, CornerRadius::ZERO, TREE_HOVER);
                    }
                    hresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Тека {title}")));
                    let c = pos2(hr.left() + 14.0, hr.center().y);
                    let tri = if open { vec![pos2(c.x - 4.0, c.y - 2.0), pos2(c.x + 4.0, c.y - 2.0), pos2(c.x, c.y + 3.0)] } else { vec![pos2(c.x - 2.0, c.y - 4.0), pos2(c.x + 3.0, c.y), pos2(c.x - 2.0, c.y + 4.0)] };
                    ui.painter().add(egui::Shape::convex_polygon(tri, MUTE, Stroke::NONE));
                    ui.painter().text(pos2(hr.left() + 26.0, hr.center().y), Align2::LEFT_CENTER, title, FontId::proportional(12.5), TEXT);
                    ui.painter().text(pos2(hr.right() - 10.0, hr.center().y), Align2::RIGHT_CENTER, members.len().to_string(), FontId::monospace(10.5), DIM);
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
                        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
                        let cur = self.st.file == Some(i);
                        resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, cur, name.clone()));
                        if cur {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, sel_use());
                        } else if resp.hovered() {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, TREE_HOVER);
                        }
                        // значок формату: {} дані, MAP мапа, Aa текст
                        let (label, bg, fg) = match k {
                            1 => ("MAP", Color32::from_rgb(0x1f, 0x3a, 0x2c), OK),
                            2 => ("Aa", Color32::from_rgb(0x2a, 0x2f, 0x4a), INFO),
                            _ => ("{}", Color32::from_rgb(0x3b, 0x35, 0x24), Color32::from_rgb(0xe5, 0xc0, 0x6a)),
                        };
                        let bw = if k == 1 { 26.0 } else { 18.0 };
                        let badge = Rect::from_min_size(pos2(rect.left() + 22.0, rect.center().y - 8.0), vec2(bw, 16.0));
                        ui.painter().rect_filled(badge, CornerRadius::same(R1), bg);
                        ui.painter().text(badge.center(), Align2::CENTER_CENTER, label, FontId::monospace(8.5), fg);
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
                }
            });
        });
    }

    fn inspector(&mut self, ctx: &egui::Context) {
        let width = if self.focus { (ctx.screen_rect().width() - 40.0 - 330.0).max(380.0) } else { 380.0 };
        egui::SidePanel::right("insp").exact_width(width).resizable(false).show_separator_line(false).frame(card()).show(ctx, |ui| {
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let mut x = tabs.left() + 4.0;
            for (i, t) in ["Переклад", "Пам’ять", "Сцена", "Історія", "Коментарі"].iter().enumerate() {
                let w = t.chars().count() as f32 * 7.2 + 22.0;
                let r = Rect::from_min_size(pos2(x, tabs.top()), vec2(w, 34.0));
                let resp = ui.interact(r, ui.id().with(("itab", i)), Sense::click());
                let on = self.itab == i;
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, *t));
                ui.painter().text(r.center(), Align2::CENTER_CENTER, t, FontId::proportional(12.5), if on || resp.hovered() { TEXT } else { MUTE });
                if on {
                    ui.painter().hline(r.x_range(), tabs.bottom() - 1.0, Stroke::new(2.0_f32, accent()));
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
                        2 => self.tab_scene(ui, f, r),
                        3 => self.tab_history(ui, f, r),
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
        for (lang, text) in self.st.references_of(f, r) {
            ui.add_space(4.0);
            label_caps(ui, &format!("Довідка · {lang}"));
            ui.label(RichText::new(text).color(SRC_TEXT));
        }
        if let Some((others, fills, updates, edited)) = self.st.link_info(f, r) {
            ui.add_space(4.0);
            label_caps(ui, "Однакові рядки");
            ui.label(RichText::new(format!("Ще {others} з таким самим оригіналом: порожніх {fills}, старіших {updates}, змінених вручну {edited}")).size(11.5).color(MUTE));
            if let Some((is_main, unlinked)) = self.st.link_flags(f, r) {
                ui.horizontal(|ui| {
                    if is_main {
                        if plain_button(ui, "Зняти головного").clicked() {
                            self.st.link_action(f, r, 1);
                        }
                    } else if plain_button(ui, "Зробити головним").clicked() {
                        self.st.link_action(f, r, 0);
                    }
                    if unlinked {
                        if plain_button(ui, "Знову йти за копіями").clicked() {
                            self.st.link_action(f, r, 3);
                        }
                    } else if plain_button(ui, "Не йти за копіями").clicked() {
                        self.st.link_action(f, r, 2);
                    }
                });
            }
            if fills + updates + edited > 0 {
                ui.horizontal(|ui| {
                    if fills + updates > 0 && plain_button(ui, "Заповнити копії").clicked() {
                        let n = self.st.apply_links(f, r, false);
                        self.message = format!("Скопійовано в рядки (чернетки): {n}");
                    }
                    if edited > 0 && plain_button(ui, "Перезаписати й змінені").clicked() {
                        let n = self.st.apply_links(f, r, true);
                        self.message = format!("Скопійовано в рядки (чернетки): {n}");
                    }
                });
            }
        }
        ui.add_space(8.0);
        label_caps(ui, "Переклад");
        let rows = if self.focus { 9 } else { 5 };
        let resp = ui.add(egui::TextEdit::multiline(&mut self.draft).desired_rows(rows).desired_width(f32::INFINITY).font(FontId::proportional(13.5)).margin(vec2(10.0, 9.0)).background_color(BG));
        ui.painter().rect_stroke(resp.rect, CornerRadius::same(R2), Stroke::new(1.0_f32, accent()), StrokeKind::Outside);
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
            ui.horizontal_wrapped(|ui| {
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
                ui.colored_label(TERM_COLORS[i % TERM_COLORS.len()], "•");
                ui.label(RichText::new(&t.en).color(TEXT));
                ui.label(RichText::new("-").color(DIM));
                ui.label(RichText::new(&t.uk).color(TEXT));
            });
        }
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut self.term_en).hint_text("слово").desired_width(88.0));
            ui.add(egui::TextEdit::singleline(&mut self.term_uk).hint_text("переклад").desired_width(88.0));
            if plain_button(ui, "Додати").clicked() {
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

    fn tab_scene(&mut self, ui: &mut egui::Ui, f: usize, r: usize) {
        let Some(v) = self.st.scene_view(f, r) else {
            label_caps(ui, "Сцена");
            ui.label(RichText::new("Цей рядок не належить сцені (база даних чи текстовий формат)").color(MUTE));
            return;
        };
        ui.horizontal(|ui| {
            if ui.add_enabled(v.prev.is_some(), egui::Button::new("<")).clicked() {
                self.st.row = v.prev;
            }
            if ui.add_enabled(v.next.is_some(), egui::Button::new(">")).clicked() {
                self.st.row = v.next;
            }
            ui.label(RichText::new(&v.title).color(TEXT));
        });
        ui.horizontal(|ui| {
            if plain_button(ui, "Запустити гру звідси").clicked() {
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
        ui.add_space(4.0);
        for l in &v.lines {
            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 46.0), Sense::click());
            resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, l.current, format!("{}: {}", l.speaker, l.source)));
            ui.painter().rect_filled(rect, CornerRadius::same(R1), if l.current { sel_use() } else if resp.hovered() { TREE_HOVER } else { PANEL2 });
            paint_dot(ui, pos2(rect.left() + 12.0, rect.top() + 14.0), l.status);
            let clip = Rect::from_min_max(pos2(rect.left() + 24.0, rect.top()), pos2(rect.right() - 6.0, rect.bottom()));
            let p = ui.painter().with_clip_rect(clip);
            if !l.speaker.is_empty() {
                p.text(pos2(clip.left(), rect.top() + 6.0), Align2::LEFT_TOP, &l.speaker, FontId::proportional(11.0), VIOLET);
            }
            p.text(pos2(clip.left(), rect.top() + 18.0), Align2::LEFT_TOP, l.source.replace('\n', " / "), FontId::proportional(12.5), SRC_TEXT);
            let t = if l.target.is_empty() { "-".to_string() } else { l.target.replace('\n', " / ") };
            p.text(pos2(clip.left(), rect.top() + 32.0), Align2::LEFT_TOP, t, FontId::proportional(12.0), MUTE);
            if resp.clicked() {
                self.st.row = Some(l.row);
            }
            ui.add_space(3.0);
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
                    ui.label(RichText::new(format!("> {}: {}", re.who, re.text)).color(MUTE));
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
        egui::CentralPanel::default().frame(card()).show(ctx, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            self.st.sync_tabs();
            let Some(f) = self.st.file else {
                ui.centered_and_justified(|ui| ui.label(RichText::new(if self.st.is_open() { "Усі вкладки закрито: виберіть файл зі списку ліворуч" } else { "Відкрийте папку гри: кнопка «Відкрити гру…»" }).color(MUTE)));
                return;
            };
            let name = self.st.file_names().get(f).cloned().unwrap_or_default();
            // вкладки відкритих файлів: назва, скільки рядків ще без перекладу, закрити
            let (tabs, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
            ui.painter().rect_filled(tabs, top_round(), PANEL);
            ui.painter().hline(tabs.x_range(), tabs.bottom(), Stroke::new(1.0_f32, LINE));
            let progress = self.st.file_progress();
            let names = self.st.file_names();
            let mut x = tabs.left() + 4.0;
            let (mut pick, mut close): (Option<usize>, Option<usize>) = (None, None);
            for t in self.st.tabs.clone() {
                let Some(tn) = names.get(t) else { continue };
                let left = progress.get(t).map_or(0, |p| p.0.saturating_sub(p.1));
                let galley = ui.painter().layout_no_wrap(tn.clone(), FontId::proportional(12.5), TEXT);
                let badge = if left > 0 { Some(ui.painter().layout_no_wrap(left.to_string(), FontId::proportional(11.0), WARN)) } else { None };
                let tw = (galley.size().x + 44.0 + badge.as_ref().map_or(0.0, |b| b.size().x + 8.0)).min(320.0);
                let rect = Rect::from_min_size(pos2(x, tabs.top()), vec2(tw, 33.0));
                let resp = ui.interact(rect, ui.id().with(("tab", t)), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, t == f, format!("Вкладка {tn}")));
                let on = t == f;
                ui.painter().rect_filled(rect, CornerRadius::ZERO, if on { Color32::from_rgb(0x25, 0x28, 0x2c) } else if resp.hovered() { TREE_HOVER } else { PANEL });
                if on {
                    ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(2.0_f32, accent()));
                }
                let mut tx = rect.left() + 12.0;
                ui.painter().with_clip_rect(rect.shrink2(vec2(2.0, 0.0))).galley(pos2(tx, rect.center().y - galley.size().y / 2.0), galley.clone(), TEXT);
                tx += galley.size().x + 8.0;
                if let Some(b) = badge {
                    let bw = b.size().x;
                    ui.painter().galley(pos2(tx, rect.center().y - b.size().y / 2.0), b, WARN);
                    tx += bw;
                }
                let _ = tx;
                let cx = Rect::from_center_size(pos2(rect.right() - 14.0, rect.center().y), vec2(16.0, 16.0));
                let cr = ui.interact(cx, ui.id().with(("tabx", t)), Sense::click());
                ui.painter().text(cx.center(), Align2::CENTER_CENTER, "x", FontId::proportional(12.0), if cr.hovered() { TEXT } else { MUTE });
                if cr.clicked() {
                    close = Some(t);
                } else if resp.clicked() {
                    pick = Some(t);
                }
                x += tw + 2.0;
            }
            if let Some(t) = pick {
                if self.st.file != Some(t) {
                    self.st.file = Some(t);
                    self.st.row = None;
                    self.draft_for = None;
                }
            }
            if let Some(t) = close {
                self.st.close_tab(t);
                self.draft_for = None;
            }
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
            fui.add(egui::TextEdit::singleline(&mut self.st.search).hint_text("Фільтр у цьому файлі").desired_width(190.0).margin(vec2(10.0, 4.0)));
            for (i, flt) in Filter::ALL.iter().enumerate() {
                if chip(&mut fui, flt.label(), counts[i], self.st.filter == *flt).clicked() {
                    self.st.filter = *flt;
                }
            }
            if let Some(id) = self.st.group_filter.clone() {
                let name = self.st.groups_view().into_iter().find(|g| g.id == id).map_or(String::new(), |g| g.name);
                let r = ui.allocate_rect(egui::Rect::from_min_size(fr.left_top(), vec2(0.0, 0.0)), Sense::hover());
                let _ = r;
                fui.add_space(8.0);
                if chip(&mut fui, &format!("Група: {name}  x"), self.st.visible_len(f), true).clicked() {
                    self.st.group_filter = None;
                }
            }
            if self.scene_mode {
                match self.st.row {
                    Some(r) => {
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                            ui.add_space(8.0);
                            egui::Frame::new().inner_margin(egui::Margin::symmetric(14, 0)).show(ui, |ui| self.tab_scene(ui, f, r));
                        });
                    }
                    None => {
                        ui.centered_and_justified(|ui| ui.label(RichText::new("Виберіть рядок: тут з'являться репліки його сцени").color(MUTE)));
                    }
                }
            } else {
                self.grid(ui, f);
            }
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
                ui.painter().rect_filled(rect, CornerRadius::ZERO, if sel { sel_use() } else if resp.hovered() { TREE_HOVER } else { PANEL });
                ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, LINE_SOFT));
                let (src, tgt, st) = self.st.row_view(f, r);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, sel, format!("{src} — {tgt}")));
                paint_dot(ui, pos2(rect.left() + 14.0, rect.top() + 14.0), st);
                let clip = Rect::from_min_max(pos2(rect.left() + 26.0, rect.top()), pos2(rect.right() - 8.0, rect.bottom()));
                ui.painter().with_clip_rect(clip).text(pos2(clip.left(), rect.top() + 14.0), Align2::LEFT_CENTER, src.replace('\n', " / "), FontId::proportional(12.5), SRC_TEXT);
                let t = if tgt.is_empty() { "—".to_string() } else { tgt.replace('\n', " / ") };
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
        // колонки, як у старому застосунку: №, стан, ключ, мовець, оригінал, переклад, позначки, довжина
        let wide = w > 1000.0;
        let fixed = [34.0_f32, 30.0, 96.0, 104.0];
        let tail = [if wide { 128.0_f32 } else { 0.0 }, 68.0];
        let flex = ((w - fixed.iter().sum::<f32>() - tail.iter().sum::<f32>() - 12.0) / 2.0).max(120.0);
        let cols = [fixed[0], fixed[1], fixed[2], fixed[3], flex, flex, tail[0], tail[1]];
        let titles = ["№", "", "Ключ", "Мовець", "Оригінал", "Переклад", if wide { "Позначки" } else { "" }, "Довж."];
        let (hdr, _) = ui.allocate_exact_size(vec2(w, 26.0), Sense::hover());
        ui.painter().rect_filled(hdr, CornerRadius::ZERO, PANEL);
        ui.painter().hline(hdr.x_range(), hdr.bottom(), Stroke::new(1.0_f32, LINE));
        let mut x = hdr.left();
        for (title, cw) in titles.iter().zip(cols) {
            if cw > 0.0 {
                ui.painter().text(pos2(x + 8.0, hdr.center().y), Align2::LEFT_CENTER, title, FontId::proportional(11.0), MUTE);
                x += cw;
                ui.painter().vline(x, hdr.y_range(), Stroke::new(1.0_f32, Color32::from_rgb(0x33, 0x35, 0x3a)));
            }
        }
        let total = self.st.visible_len(f);
        let row_h = 46.0;
        let bad_rows: std::collections::HashSet<usize> = self.st.file_issues(f).into_iter().map(|i| i.0).collect();
        let list_h = (ui.available_height() - 26.0).max(60.0);
        egui::ScrollArea::vertical().auto_shrink([false; 2]).max_height(list_h).show_rows(ui, row_h, total, |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for i in range {
                let Some(r) = self.st.visible_at(f, i) else { continue };
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::click());
                let sel = self.st.row == Some(r);
                let bg = if sel { sel_use() } else if resp.hovered() { ROW_HOVER } else if i % 2 == 1 { ZEBRA } else { BG };
                ui.painter().rect_filled(rect, CornerRadius::ZERO, bg);
                ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, LINE_SOFT));
                let (src, tgt, st) = self.st.row_view(f, r);
                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, sel, format!("{src} — {tgt}")));
                let key = short_key(&self.st.key_of(f, r));
                let who = self.st.speaker_of_row(f, r);
                let mut x = rect.left();
                let cell = |x: f32, cw: f32| Rect::from_min_size(pos2(x, rect.top()), vec2(cw, row_h));
                ui.painter().text(pos2(x + cols[0] - 6.0, rect.center().y), Align2::RIGHT_CENTER, format!("{}", r + 1), FontId::monospace(11.0), DIM);
                x += cols[0];
                paint_state(ui, pos2(x + cols[1] / 2.0, rect.center().y), st, bad_rows.contains(&r));
                x += cols[1];
                ui.painter().with_clip_rect(cell(x, cols[2])).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, key, FontId::monospace(11.0), MUTE);
                x += cols[2];
                ui.painter().with_clip_rect(cell(x, cols[3])).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, who, FontId::proportional(12.0), VIOLET);
                x += cols[3];
                let wrapped = |ui: &egui::Ui, text: &str, color: Color32, size: f32, cw: f32| ui.painter().layout(text.replace('\n', " ").to_string(), FontId::proportional(size), color, cw - 16.0);
                let g = wrapped(ui, &src, SRC_TEXT, 12.5, cols[4]);
                let gy = rect.center().y - g.size().y / 2.0;
                ui.painter().with_clip_rect(cell(x, cols[4])).galley(pos2(x + 8.0, gy.max(rect.top() + 3.0)), g, SRC_TEXT);
                x += cols[4];
                let tcell = cell(x, cols[5]);
                if tgt.is_empty() {
                    ui.painter().with_clip_rect(tcell).text(pos2(x + 8.0, rect.center().y), Align2::LEFT_CENTER, "не перекладено", FontId::proportional(12.5), DIM);
                } else {
                    let g = wrapped(ui, &tgt, TEXT, 12.5, cols[5]);
                    let gy = rect.center().y - g.size().y / 2.0;
                    ui.painter().with_clip_rect(tcell).galley(pos2(x + 8.0, gy.max(rect.top() + 3.0)), g, TEXT);
                }
                if sel {
                    ui.painter().rect_stroke(tcell.shrink(1.0), CornerRadius::same(R1), Stroke::new(1.0_f32, accent()), StrokeKind::Inside);
                }
                x += cols[5];
                if wide {
                    let ctx = self.st.context_of(f, r);
                    if !ctx.is_empty() {
                        let g = ui.painter().layout_no_wrap(ctx, FontId::proportional(11.5), TEXT);
                        let cw = (g.size().x + 22.0).min(cols[6] - 12.0);
                        let chip = Rect::from_min_size(pos2(x + 6.0, rect.top() + 6.0), vec2(cw, 20.0));
                        ui.painter().rect_filled(chip, CornerRadius::same(10), BTN);
                        ui.painter().circle_filled(pos2(chip.left() + 8.0, chip.center().y), 3.0, accent());
                        ui.painter().with_clip_rect(chip.shrink2(vec2(4.0, 0.0))).galley(pos2(chip.left() + 15.0, chip.center().y - g.size().y / 2.0), g, TEXT);
                    }
                    x += cols[6];
                }
                if !tgt.is_empty() {
                    let (t, o) = (tgt.chars().count(), src.chars().count());
                    let dev = if o == 0 { 0.0 } else { (t as f64 / o as f64 - 1.0).abs() };
                    let col = if dev > 0.4 { BAD } else if dev > 0.15 { WARN } else { TEXT };
                    ui.painter().text(pos2(x + cols[7] - 8.0, rect.center().y), Align2::RIGHT_CENTER, format!("{t}/{o}"), FontId::monospace(11.0), col);
                }
                if resp.clicked() {
                    self.st.row = Some(r);
                }
            }
        });
        // умовні позначки внизу таблиці
        let (leg, _) = ui.allocate_exact_size(vec2(w, 24.0), Sense::hover());
        ui.painter().hline(leg.x_range(), leg.top(), Stroke::new(1.0_f32, LINE));
        let mut lx = leg.left() + 14.0;
        for (st, bad, label) in [(RowStatus::Untranslated, false, "без перекладу"), (RowStatus::Draft, false, "чернетка"), (RowStatus::Sent, false, "чекає вичитування"), (RowStatus::Approved, false, "вичитано"), (RowStatus::Untranslated, true, "є проблема QA")] {
            paint_state(ui, pos2(lx, leg.center().y), st, bad);
            let g = ui.painter().layout_no_wrap(label.to_string(), FontId::proportional(11.5), MUTE);
            let wd = g.size().x;
            ui.painter().galley(pos2(lx + 12.0, leg.center().y - g.size().y / 2.0), g, MUTE);
            lx += wd + 36.0;
        }
    }
}

/// Позначка стану рядка, як у старому застосунку: ✓ вичитано, ● чернетка / чекає вичитування, ○ без перекладу, ▲ проблема QA.
fn paint_state(ui: &egui::Ui, c: egui::Pos2, s: RowStatus, bad: bool) {
    let p = ui.painter();
    if bad {
        let tri = vec![pos2(c.x, c.y - 5.5), pos2(c.x + 5.5, c.y + 4.5), pos2(c.x - 5.5, c.y + 4.5)];
        p.add(egui::Shape::convex_polygon(tri, BAD, Stroke::NONE));
        return;
    }
    match s {
        RowStatus::Approved => {
            p.circle_filled(c, 6.0, OK);
            p.line_segment([pos2(c.x - 3.0, c.y), pos2(c.x - 1.0, c.y + 2.5)], Stroke::new(1.6_f32, BG));
            p.line_segment([pos2(c.x - 1.0, c.y + 2.5), pos2(c.x + 3.0, c.y - 2.5)], Stroke::new(1.6_f32, BG));
        }
        RowStatus::Sent => {
            p.circle_filled(c, 5.0, INFO);
        }
        RowStatus::Draft => {
            p.circle_filled(c, 5.0, WARN);
        }
        RowStatus::Untranslated => {
            p.circle_stroke(c, 4.5, Stroke::new(1.3_f32, DIM));
        }
    }
}

/// Ключ коротко: без шляху до сторінки події (`events[3].pages[0].list[12]` → `list[12]`).
fn short_key(key: &str) -> String {
    match key.rfind("].pages[") {
        Some(i) => key[i + 2..].split_once("].").map_or(key.to_string(), |(_, rest)| rest.to_string()),
        None => key.to_string(),
    }
}

#[cfg(test)]
mod ui_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;
    use egui_kittest::Harness;

    fn game(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("transly-ui-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"Hero","nickname":"","profile":"Brave","note":""},{"id":2,"name":"Mage","nickname":"","profile":"Wise","note":""}]"#).unwrap();
        data
    }

    fn press(h: &mut Harness<'static, App>, mods: egui::Modifiers, key: egui::Key) {
        h.input_mut().modifiers = mods;
        h.input_mut().events.push(egui::Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: mods });
        h.input_mut().events.push(egui::Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: mods });
    }

    fn harness(app: App) -> Harness<'static, App> {
        Harness::builder().with_size(egui::vec2(1360.0, 800.0)).build_state(|ctx, app: &mut App| {
            theme::apply(ctx);
            app.frame(ctx);
        }, app)
    }

    #[test]
    fn an_empty_window_asks_to_open_a_game() {
        let mut h = harness(App::default());
        h.run();
        h.get_by_label_contains("Відкрийте папку гри");
        h.get_by_label("Гру не відкрито");
    }

    #[test]
    fn a_game_shows_files_rows_and_the_inspector_follows_the_selected_row() {
        let data = game("rows");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let mut h = harness(app);
        h.run();
        h.get_by_label("Actors.json");
        h.get_by_label_contains("Hero");
        // вибір рядка наповнює інспектор
        h.state_mut().st.row = Some(0);
        h.run();
        h.get_by_label("ОРИГІНАЛ");
        h.get_by_label("ПЕРЕКЛАД");
        h.get_by_label("Пам’ять");
        assert!(h.get_all_by_label("Надіслати").count() >= 1, "кнопка є в інспекторі");
    }

    #[test]
    fn arrow_keys_move_between_rows_and_ctrl_enter_sends() {
        let data = game("keys");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let mut h = harness(app);
        h.run();
        press(&mut h, egui::Modifiers::NONE, egui::Key::ArrowDown);
        h.run();
        assert_eq!(h.state().st.row, Some(0));
        press(&mut h, egui::Modifiers::NONE, egui::Key::ArrowDown);
        h.run();
        assert_eq!(h.state().st.row, Some(1));
        h.state_mut().draft = "Герой".into();
        h.state_mut().draft_for = Some((0, 1));
        press(&mut h, egui::Modifiers::COMMAND, egui::Key::Enter);
        h.run();
        assert_eq!(h.state().st.progress().sent, 1);
        assert_eq!(h.state().st.row, Some(2), "після надсилання курсор іде далі");
    }

    #[test]
    fn the_mode_switch_changes_the_layout_and_back() {
        let data = game("focus");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let mut h = harness(app);
        h.run();
        assert!(!h.state().focus);
        h.get_by_label("Редагування: один рядок").click();
        h.run();
        assert!(h.state().focus);
        h.get_by_label("Сцена: репліки подій поспіль").click();
        h.run();
        assert!(h.state().scene_mode && !h.state().focus);
        h.get_by_label("Таблиця: усі рядки файлу").click();
        h.run();
        assert!(!h.state().focus && !h.state().scene_mode);
    }

    #[test]
    fn the_settings_window_opens_and_saves() {
        let data = game("settings");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let mut h = harness(app);
        h.run();
        h.get_by_label_contains("MyGame").click();
        h.run();
        h.get_by_label("Налаштування проєкту…").click();
        h.run();
        h.get_by_label("Налаштування проєкту");
        h.get_by_label("Хто перекладає");
        h.get_by_label("Скасувати").click();
        h.run();
        assert!(h.query_by_label("Хто перекладає").is_none());
    }

    #[test]
    fn typing_a_translation_and_sending_updates_progress() {
        let data = game("send");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        h.state_mut().draft = "Герой".into();
        h.state_mut().draft_for = Some((0, 0));
        h.run();
        // кнопка «Надіслати» є і в панелі інструментів, і в інспекторі
        h.get_all_by_label("Надіслати").last().unwrap().click();
        h.run();
        assert_eq!(h.state().st.progress().sent, 1);
        assert_eq!(h.state().message, "Надіслано");
    }

    /// Знімок вікна в PNG для перевірки вигляду очима: `TRANSLY_SHOTS=<тека> cargo test -p transly-app shots -- --ignored`.
    #[test]
    #[ignore]
    fn shots() {
        let Some(dir_out) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        let dir = dir_out.clone();
        std::fs::create_dir_all(&dir).unwrap();
        let data = game("shots");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.add_term("Hero", "Герой");
        app.st.edit(0, 0, "Герой");
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        h.render().unwrap().save(dir.join("table.png")).unwrap();
        h.state_mut().focus = true;
        h.run();
        h.render().unwrap().save(dir.join("focus.png")).unwrap();
        h.state_mut().focus = false;
        {
            let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
            let l = [cmd(101, r#""",0,0,2,"Оповідач""#), cmd(401, r#""The hall is silent. Dust drifts through a single shaft of light, and something shifts in the dark beyond the pillars.""#), cmd(101, r#""",0,0,2,"Марина""#), cmd(401, r#""Hello? Is someone there?""#), cmd(0, "")].join(",");
            let dir = h.state().st.dir.clone().unwrap();
            std::fs::write(dir.join("Map001.json"), format!(r#"{{"displayName":"Зал","events":[null,{{"id":1,"name":"Зал вартових","x":1,"y":1,"pages":[{{"conditions":{{}},"list":[{l}],"trigger":0}}]}}]}}"#)).unwrap();
            h.state_mut().st.open_game(&dir).unwrap();
            h.state_mut().st.file = h.state().st.file_names().iter().position(|n| n == "Map001.json");
            let fi = h.state().st.file.unwrap();
            h.state_mut().st.edit(fi, 0, "У залі тихо. Пил кружляє в єдиному промені світла, і щось ворухнулось у темряві за колонами.");
            h.state_mut().st.row = Some(0);
        }
        h.run();
        h.render().unwrap().save(dir_out.join("map.png")).unwrap();
        for (i, name) in [(1usize, "rail-rows"), (2, "rail-scenes"), (3, "rail-related")] {
            h.state_mut().rail = i;
            h.run();
            h.render().unwrap().save(dir_out.join(format!("{name}.png"))).unwrap();
        }
        h.state_mut().rail = 0;
        h.state_mut().itab = 2;
        h.state_mut().qar_win = true;
        h.state_mut().wrap_win = Some((h.state().st.wrap_settings(), "Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг.".into(), false));
        h.state_mut().groups_win = Some(String::new());
        h.run();
        h.render().unwrap().save(dir.join("windows.png")).unwrap();
    }
}
