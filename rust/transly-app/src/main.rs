//! Transly (нативна версія), етап 3. Вигляд перенесено зі старого інтерфейсу (`mockup/workspace.html`, `app/src/ui/theme.css`):
//! рядок меню, панель інструментів, смуга інструментів, дерево файлів, сітка рядків із вкладкою, хлібними крихтами й фільтрами,
//! інспектор рядка праворуч і рядок стану. Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform`.

// у випуску без чорного вікна консолі
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod glossary_panel;
mod icons;
mod layout;
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
    /// Глосарій у лівій панелі: пошук, вибраний чип (Усе, Слова, Конструкції, Рядки, Пам’ять, Розбіжності), форма запису, запис, що чекає другого кліку «Видалити».
    gl_query: String,
    gl_show: usize,
    gl_form: Option<glossary_panel::GlForm>,
    gl_del: Option<String>,
    rows_scroll_to: Option<bool>,
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
    was_edit: u8,
    /// Картинки гри (піктограми, обличчя, вороги) як текстури; None — файлу в теці гри немає.
    pic_tex: std::collections::HashMap<String, Option<egui::TextureHandle>>,
    /// Вікно «Тексти плагінів»: вибрані назви команд.
    plug_win: Option<std::collections::BTreeSet<String>>,
    upd: UpdUi,
    /// Вікно реле-синхронізації: правка адреси, пароля й періоду.
    relay_win: Option<state::RelayCfg>,
    /// Вікно «Конструкції»: знайдені пропозиції; відкладені («Не зараз») пам'ятаються до кінця сеансу.
    mine_win: Option<Vec<transly_core::mine::ConstructionSuggestion>>,
    mine_no: std::collections::HashSet<String>,
    /// Сповіщення внизу: (текст, коли з'явилось, чи можна скасувати); останнє показане повідомлення й лічильник скасувань.
    toast: Option<(String, std::time::Instant, bool)>,
    toast_seen: (String, u64),
    /// «Пошук скрізь»: (запит, вибраний результат); None — закрито.
    search_win: Option<(String, usize)>,
    /// Відмічені прапорцями рядки таблиці: (файл, рядки).
    checked: (usize, std::collections::HashSet<usize>),
    /// Репліка сцени, що набирається: (рядок, текст); пишеться в проєкт при виході з поля.
    scene_draft: Option<(usize, String)>,
    /// Клітинка перекладу, що редагується в таблиці: (файл, рядок).
    cell_edit: Option<(usize, usize)>,
    cell_focus: bool,
    /// Розділи правої колонки (Активність, Пов’язане, Обговорення) окремо для таблиці й «Редагування».
    right_secs: [[bool; 3]; 2],
    comment: String,
    /// Робоче вікно: остання панель, куди клацнули (спершу центр).
    pane: Pane,
    /// Гілка, у якій відкрито поле відповіді, і текст відповіді; коментар, що чекає другого кліку «Видалити»; чи розкрито «Розв’язані».
    reply_to: Option<String>,
    reply_text: String,
    del_confirm: Option<String>,
    closed_open: bool,
    token: String,
}

/// Відповіді потоків оновлення.
enum UpdMsg {
    Checked(Result<transly_platform::selfupdate::Latest, String>),
    Downloaded(Result<std::path::PathBuf, String>),
}

/// Стан вікна «Оновлення».
struct UpdUi {
    win: bool,
    repo: String,
    token: String,
    status: String,
    latest: Option<transly_platform::selfupdate::Latest>,
    rx: Option<std::sync::mpsc::Receiver<UpdMsg>>,
    /// Перевірка при старті вже була; поточна відповідь тиха (без повідомлення, коли нового нема).
    auto_done: bool,
    silent: bool,
}

impl Default for UpdUi {
    fn default() -> Self {
        UpdUi { win: false, repo: "jazirka/transly".into(), token: String::new(), status: String::new(), latest: None, rx: None, auto_done: false, silent: false }
    }
}

/// Кольори ниток рядка (`--s0…--s5` у вебі).
pub(crate) const TERM_COLORS: [Color32; 6] = [VIOLET, INFO, OK, WARN, Color32::from_rgb(0xee, 0x7a, 0xa8), Color32::from_rgb(0x4c, 0xc9, 0xc0)];

fn source_job_sized(text: &str, marks: &[(usize, usize, usize)], size: f32, line_height: Option<f32>) -> egui::text::LayoutJob {
    use egui::text::{LayoutJob, TextFormat};
    let base = TextFormat { font_id: FontId::proportional(size), color: TEXT, line_height, ..Default::default() };
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

/// Кольори вікна повідомлень RPG Maker (`\C[n]`): близькі до тих, що показує гра, але не точні для ігор із власним скіном.
const GAME_COLORS: [(u8, u8, u8); 32] = [
    (0xff, 0xff, 0xff), (0x20, 0xa0, 0xd6), (0xff, 0x78, 0x4c), (0x66, 0xcc, 0x40), (0x99, 0xcc, 0xff), (0xcc, 0xc0, 0xff), (0xff, 0xff, 0xa0), (0x80, 0x80, 0x80),
    (0xc0, 0xc0, 0xc0), (0x20, 0x80, 0xcc), (0xff, 0x38, 0x20), (0x00, 0xa0, 0x40), (0x60, 0x80, 0xc0), (0x80, 0x60, 0xc0), (0xff, 0xcc, 0x20), (0x00, 0x00, 0x00),
    (0x84, 0xaa, 0xff), (0xff, 0xff, 0x40), (0xff, 0x20, 0x20), (0x20, 0x20, 0x40), (0xe0, 0x80, 0x40), (0xf0, 0xc0, 0x40), (0x40, 0x40, 0xc0), (0x20, 0xe0, 0x20),
    (0x40, 0x80, 0xc0), (0x80, 0x40, 0xc0), (0xc0, 0x40, 0x80), (0x80, 0x80, 0x40), (0xc0, 0xc0, 0x00), (0x40, 0xc0, 0xc0), (0x40, 0x40, 0x80), (0x60, 0x20, 0x60),
];

/// Текст так, як його покаже вікно повідомлень: кольори `\C[n]` застосовано, `\N[n]` — ім'я героя, коди часу (`\.` `\|` `\!`…) відкинуто,
/// решта керівних кодів (`\V[n]`, `\I[n]`, `\P[n]`) лишається як є.
fn game_job(text: &str, size: f32, actor_name: &dyn Fn(usize) -> Option<String>) -> egui::text::LayoutJob {
    use egui::text::{LayoutJob, TextFormat};
    let fmt = |c: Color32| TextFormat { font_id: FontId::proportional(size), color: c, ..Default::default() };
    let mut job = LayoutJob::default();
    let mut color = TEXT;
    let chars: Vec<char> = text.chars().collect();
    let (mut i, mut buf) = (0usize, String::new());
    let flush = |job: &mut LayoutJob, buf: &mut String, c: Color32| {
        if !buf.is_empty() {
            job.append(buf, 0.0, fmt(c));
            buf.clear();
        }
    };
    while i < chars.len() {
        if chars[i] != '\\' {
            buf.push(chars[i]);
            i += 1;
            continue;
        }
        // двократна скісна риска — одна
        if chars.get(i + 1) == Some(&'\\') {
            buf.push('\\');
            i += 2;
            continue;
        }
        if chars.get(i + 1).is_some_and(|c| "{}.|!><^$".contains(*c)) {
            i += 2;
            continue;
        }
        let name: String = chars[i + 1..].iter().take_while(|c| c.is_ascii_alphabetic()).collect();
        let after = i + 1 + name.len();
        if !name.is_empty() && chars.get(after) == Some(&'[') {
            if let Some(end) = chars[after..].iter().position(|c| *c == ']') {
                let num: String = chars[after + 1..after + end].iter().collect();
                let n: usize = num.parse().unwrap_or(0);
                match name.to_uppercase().as_str() {
                    "C" => {
                        flush(&mut job, &mut buf, color);
                        color = if n == 0 { TEXT } else { GAME_COLORS.get(n).map_or(TEXT, |(r, g, b)| Color32::from_rgb(*r, *g, *b)) };
                    }
                    "N" => match actor_name(n) {
                        Some(a) => buf.push_str(&a),
                        None => buf.push_str(&chars[i..=after + end].iter().collect::<String>()),
                    },
                    _ => buf.push_str(&chars[i..=after + end].iter().collect::<String>()),
                }
                i = after + end + 1;
                continue;
            }
        }
        buf.push('\\');
        i += 1;
    }
    flush(&mut job, &mut buf, color);
    job
}

impl Default for App {
    fn default() -> Self {
        App { st: AppState::default(), last_save: std::time::Instant::now(), draft: String::new(), draft_for: None, message: String::new(), gl_query: String::new(), gl_show: 0, gl_form: None, gl_del: None, rows_scroll_to: None, keys_win: false, rail: 0, run_cfg: 0, tree_closed: Default::default(), scene_mode: false, keep_edit: None, activity_win: false, tsync_win: None, wrap_win: None, qar_win: false, br_win: None, merge_win: None, rename_win: None, groups_win: None, ref_win: None, spk_win: None, import_win: None, build_win: None, fill_win: None, find_win: None, plugins_win: false, sync_win: None, settings: None, btab: 0, bottom_open: false, focus: false, was_edit: 0, pic_tex: Default::default(), plug_win: None, upd: UpdUi::default(), relay_win: None, mine_win: None, mine_no: Default::default(), toast: None, toast_seen: (String::new(), 0), search_win: None, checked: (0, Default::default()), scene_draft: None, cell_edit: None, cell_focus: false, right_secs: [[false, true, false], [false, true, false]], comment: String::new(), pane: Pane::Centre, reply_to: None, reply_text: String::new(), del_confirm: None, closed_open: false, token: String::new() }
    }
}

/// Картка оболонки: заокруглена панель на тлі між картками (як у старому застосунку).
fn card() -> egui::Frame {
    egui::Frame::new().fill(BG).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(10)).outer_margin(egui::Margin { left: 4, right: 4, top: 0, bottom: 6 }).inner_margin(egui::Margin::ZERO)
}

/// Шрифт інтерфейсу (Inter) заданого розміру.
pub(crate) fn ip(size: f32) -> FontId {
    FontId::proportional(size)
}

/// Шрифт інтерфейсу з вагою: 500 — Medium, 600 і вище — SemiBold (як `font-weight` у вебі), решта — звичайний.
pub(crate) fn ipw(size: f32, weight: u16) -> FontId {
    if !theme::weights_ready() {
        return ip(size);
    }
    match weight {
        500 => FontId::new(size, egui::FontFamily::Name("InterMedium".into())),
        600..=900 => FontId::new(size, egui::FontFamily::Name("InterSemiBold".into())),
        _ => ip(size),
    }
}

/// Моноширинний шрифт (ключі, числа).
pub(crate) fn mp(size: f32) -> FontId {
    FontId::monospace(size)
}


/// Колір `top` поверх `base` з непрозорістю `a`.
fn over_color(base: Color32, top: Color32, a: f32) -> Color32 {
    let f = |b: u8, t: u8| (b as f32 * (1.0 - a) + t as f32 * a).round() as u8;
    Color32::from_rgb(f(base.r(), top.r()), f(base.g(), top.g()), f(base.b(), top.b()))
}

/// Горизонтальний градієнт у прямокутнику.
/// Еліптична підсвітка: центр кольору `c` з прозорістю `a`, до краю еліпса — нуль (нижня половина еліпса від верху вікна).
fn glow(painter: &egui::Painter, center: egui::Pos2, radii: egui::Vec2, c: Color32, a: f32) {
    use egui::epaint::{Mesh, Vertex, WHITE_UV};
    let mid = Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), (a * 255.0) as u8);
    let edge = Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), 0);
    let mut mesh = Mesh::default();
    mesh.vertices.push(Vertex { pos: center, uv: WHITE_UV, color: mid });
    let n = 48;
    for i in 0..=n {
        let t = std::f32::consts::PI * i as f32 / n as f32;
        mesh.vertices.push(Vertex { pos: pos2(center.x + radii.x * t.cos(), center.y + radii.y * t.sin()), uv: WHITE_UV, color: edge });
    }
    for i in 0..n {
        mesh.indices.extend([0, i as u32 + 1, i as u32 + 2]);
    }
    painter.add(egui::Shape::mesh(mesh));
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
    // розміри з комп'ютерних стилів веба: кнопка 28, заокруглення 8, шрифт 13; аватар 26 (відступ 4, проміжок 8); піктограма 16 (відступ 6 чи 12 у «збірки», проміжок 8 чи 7)
    let galley = ui.painter().layout_no_wrap(text.to_string(), FontId::proportional(13.0), if border { Color32::from_rgb(0xc7, 0xca, 0xd1) } else { TEXT });
    let (pad_l, lead, pad_r) = if avatar.is_some() { (4.0, 26.0 + 8.0, 6.0) } else if icon.is_some() { if border { (12.0, 16.0 + 7.0, 10.0) } else { (6.0, 16.0 + 8.0, 6.0) } } else { (10.0, 0.0, 6.0) };
    let w = pad_l + lead + galley.size().x + if caret { 8.0 + 10.0 } else { 0.0 } + pad_r;
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 28.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, text));
    if border || resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(8), over_ground(0.07));
    }
    if let Some(letters) = avatar {
        let c = pos2(rect.left() + pad_l + 13.0, rect.center().y);
        ui.painter().circle_filled(c, 13.0, accent_solid());
        ui.painter().text(c, Align2::CENTER_CENTER, letters, FontId::monospace(11.5), Color32::WHITE);
    } else if let Some(ic) = icon {
        icons::paint(ui, Rect::from_center_size(pos2(rect.left() + pad_l + 8.0, rect.center().y), vec2(16.0, 16.0)), ic, MUTE);
    }
    ui.painter().galley(pos2(rect.left() + pad_l + lead, rect.center().y - galley.size().y / 2.0), galley.clone(), TEXT);
    if caret {
        icons::paint(ui, Rect::from_center_size(pos2(rect.left() + pad_l + lead + galley.size().x + 8.0 + 5.0, rect.center().y), vec2(10.0, 10.0)), "caret", MUTE);
    }
    resp
}

/// «Робоче вікно» (`html[data-pane]` у вебі): остання панель, куди клацнули. Вибране в ньому — кольору теми, в інших — сіре.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Pane {
    Files,
    Rows,
    Scenes,
    Glossary,
    Centre,
    Right,
}

/// Яке вікно відкриває кнопка смужки зліва.
pub(crate) fn pane_of_rail(rail: usize) -> Pane {
    match rail {
        0 => Pane::Files,
        1 => Pane::Rows,
        2 => Pane::Scenes,
        _ => Pane::Glossary,
    }
}

/// Випадний список під кнопкою: відкривається кліком, закривається кліком у списку чи поза ним.
fn pop(ui: &egui::Ui, resp: &egui::Response, id: &str, add: impl FnOnce(&mut egui::Ui)) {
    let pid = ui.make_persistent_id(id);
    if resp.clicked() {
        ui.memory_mut(|m| m.toggle_popup(pid));
    }
    egui::popup::popup_below_widget(ui, pid, resp, egui::popup::PopupCloseBehavior::CloseOnClick, |ui| {
        menu_style(ui);
        add(ui);
    });
}

/// Вікно-діалог, як `.dlg` у вебі: по центру вікна, тло `#2b2d33`, рамка `#4a4d54` 1 px, радіус 12, тінь, поля 16×12. Далі — звичайні налаштування `egui::Window`.
pub(crate) fn dlg<'a>(title: impl Into<egui::WidgetText>) -> egui::Window<'a> {
    egui::Window::new(title).anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0)).frame(
        egui::Frame::new()
            .fill(Color32::from_rgb(0x2b, 0x2d, 0x33))
            .stroke(Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)))
            .corner_radius(CornerRadius::same(12))
            .shadow(egui::epaint::Shadow { offset: [0, 24], blur: 70, spread: 0, color: Color32::from_black_alpha(153) })
            .inner_margin(egui::Margin::symmetric(16, 12)),
    )
}

/// Вигляд випадних меню, як `.mdd`/`.mi` у вебі: ширина від 260, пункти без проміжків, наведення — біле 7 %, без рамок і заливки.
pub(crate) fn menu_style(ui: &mut egui::Ui) {
    ui.set_min_width(260.0);
    let sp = ui.spacing_mut();
    sp.item_spacing = vec2(0.0, 0.0);
    sp.button_padding = vec2(12.0, 7.0);
    sp.interact_size.y = 32.0;
    let v = ui.visuals_mut();
    for w in [&mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.weak_bg_fill = Color32::TRANSPARENT;
        w.bg_fill = Color32::TRANSPARENT;
        w.bg_stroke = Stroke::NONE;
        w.corner_radius = CornerRadius::same(8);
    }
    v.widgets.hovered.weak_bg_fill = over_ground(0.07);
    v.widgets.hovered.bg_fill = over_ground(0.07);
    v.widgets.open.weak_bg_fill = over_ground(0.07);
}

/// Розділювач у меню (`.msep`): лінія 1 `#43454a`, поля 5 зверху й знизу, 8 з боків.
pub(crate) fn menu_sep(ui: &mut egui::Ui) {
    ui.add_space(5.0);
    let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
    ui.painter().hline((r.left() + 8.0)..=(r.right() - 8.0), r.center().y, Stroke::new(1.0_f32, Color32::from_rgb(0x43, 0x45, 0x4a)));
    ui.add_space(5.0);
}

/// Пункт меню (`.mi`): висота 32, відступи 12; ліворуч назва, праворуч сполучення клавіш приглушене. «Назва  (Ctrl+K)» розкладається на назву й сполучення.
pub(crate) fn mi(ui: &mut egui::Ui, label: impl AsRef<str>, enabled: bool) -> egui::Response {
    let label = label.as_ref();
    let (name, sc) = match label.rfind("  (") {
        Some(i) if label.ends_with(')') => (&label[..i], &label[i + 3..label.len() - 1]),
        _ => (label, ""),
    };
    let ng = ui.painter().layout_no_wrap(name.to_string(), ip(12.5), if enabled { TEXT } else { DIM });
    let sg = ui.painter().layout_no_wrap(sc.to_string(), ip(12.5), MUTE);
    let w = (24.0 + ng.size().x + if sc.is_empty() { 0.0 } else { 24.0 + sg.size().x }).max(ui.available_width());
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 32.0), if enabled { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, enabled, label));
    if enabled && resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(8), over_ground(0.07));
    }
    ui.painter().galley(pos2(rect.left() + 12.0, rect.center().y - ng.size().y / 2.0), ng, if enabled { TEXT } else { DIM });
    if !sc.is_empty() {
        ui.painter().galley(pos2(rect.right() - 12.0 - sg.size().x, rect.center().y - sg.size().y / 2.0), sg, MUTE);
    }
    resp
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
        theme::sync_weights(ctx);
        // робоче вікно: куди клацнули в попередньому кадрі (прямокутники панелей запам'ятовують самі панелі)
        if let Some(p) = ctx.input(|i| if i.pointer.any_pressed() { i.pointer.interact_pos() } else { None }) {
            let rect_of = |name: &str| ctx.data(|d| d.get_temp::<Rect>(egui::Id::new(name)));
            if rect_of("pane-left").is_some_and(|r| r.contains(p)) {
                self.pane = pane_of_rail(self.rail);
            } else if rect_of("pane-right").is_some_and(|r| r.contains(p)) {
                self.pane = Pane::Right;
            } else if rect_of("pane-centre").is_some_and(|r| r.contains(p)) {
                self.pane = Pane::Centre;
            }
        }
        // автозбереження: не рідше за раз на 20 с, коли є зміни
        if self.st.dirty && self.last_save.elapsed().as_secs() >= 20 {
            self.message = match self.st.save_project() {
                Ok(_) => "Автозбережено".into(),
                Err(e) => e,
            };
            self.last_save = std::time::Instant::now();
        }
        ctx.request_repaint_after(std::time::Duration::from_secs(5));
        // тло оболонки під картками й між ними
        ctx.layer_painter(egui::LayerId::background()).rect_filled(ctx.screen_rect(), CornerRadius::ZERO, GROUND);
        // підсвічення від значка проєкту (відтінок теми) на всьому тлі: еліпс 520×90 від верху вікна, згасає до нуля, як `.ide` у вебі
        glow(&ctx.layer_painter(egui::LayerId::background()), pos2(105.0, 0.0), vec2(520.0, 90.0), accent(), 0.16);
        self.hotkeys(ctx);
        let title = self.st.project.as_ref().map_or("Transly".to_string(), transly_core::projname::project_title);
        let hue = transly_core::theme::theme_hue(&title, self.st.project.as_ref().and_then(|p| p.settings.get("hue")));
        if theme::set_hue(hue) {
            theme::apply_style(ctx);
        }
        self.topbar(ctx);
        self.statusbar(ctx);
        self.bottom(ctx);
        self.settings_window(ctx);
        self.sync_window(ctx);
        self.relay_window(ctx);
        self.relay_auto();
        self.plug_window(ctx);
        self.update_window(ctx);
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
        self.search_window(ctx);
        self.mine_window(ctx);
        self.toast_ui(ctx);
        if let Some(msg) = self.st.finish_sync() {
            self.message = msg;
        }
        // перехід між режимами: ліворуч рядки («Редагування»), сцени («Сцена») або файли (таблиця)
        let mode = if self.scene_mode { 2 } else { u8::from(self.focus) };
        if mode != self.was_edit {
            self.was_edit = mode;
            self.rail = [0, 1, 2][mode as usize];
        }
        self.strip(ctx);
        if self.focus || self.scene_mode {
            // «Редагування» й «Сцена»: рядки чи сцени ліворуч, редактор посередині
            self.rows_panel(ctx);
        } else {
            self.left_panel(ctx);
        }
        self.right_panel(ctx);
        self.editor(ctx);
    }

    /// Клавіші: Ctrl+Enter — надіслати й перейти далі, Ctrl+S — зберегти, F2 — «Фокус», стрілки вгору/вниз — між рядками (поки не набирається текст).
    fn hotkeys(&mut self, ctx: &egui::Context) {
        use egui::{Key, KeyboardShortcut, Modifiers};
        if ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(Modifiers::COMMAND | Modifiers::SHIFT, Key::Enter))) {
            // вичитати й перейти до наступного на вичитку
            if let Some((f, r)) = self.st.file.zip(self.st.row) {
                self.message = match self.st.approve_row(f, r) {
                    Ok(()) => self.st.jump_queue(transly_core::queue::QueueKind::Unreviewed, true),
                    Err(e) => e,
                };
                self.draft_for = None;
            }
        }
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
        if ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(Modifiers::COMMAND, Key::K))) && self.st.is_open() {
            self.search_win = Some((String::new(), 0));
        }
        if ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(Modifiers::COMMAND, Key::S))) && self.st.is_open() {
            self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
        }
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::F2)) {
            self.focus = !self.focus;
        }
        {
            use transly_core::queue::QueueKind;
            let mut go: Option<(QueueKind, bool)> = None;
            let alt_shift = Modifiers { alt: true, shift: true, ..Default::default() };
            if ctx.input_mut(|i| i.consume_key(alt_shift, Key::ArrowDown)) {
                go = Some((QueueKind::Untranslated, true));
            } else if ctx.input_mut(|i| i.consume_key(alt_shift, Key::ArrowUp)) {
                go = Some((QueueKind::Untranslated, false));
            } else if ctx.input_mut(|i| i.consume_key(Modifiers::SHIFT, Key::F8)) {
                go = Some((QueueKind::Error, false));
            } else if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::F8)) {
                go = Some((QueueKind::Error, true));
            }
            if let Some((kind, fwd)) = go {
                self.message = self.st.jump_queue(kind, fwd);
                self.draft_for = None;
                self.cell_edit = None;
            }
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
    /// Розміри — з розмірів старого застосунку в пунктах (знімок у пікселях ÷ 1,25).
    fn topbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("topbar").exact_height(40.0).show_separator_line(false).frame(egui::Frame::new().fill(Color32::TRANSPARENT).inner_margin(egui::Margin::symmetric(9, 0))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                let can = self.st.is_open();
                // логотип
                let (r, _) = ui.allocate_exact_size(vec2(21.0, 21.0), Sense::hover());
                ui.painter().circle_filled(r.center(), 10.5, accent_solid());
                ui.painter().text(r.center(), Align2::CENTER_CENTER, "T", FontId::proportional(11.0), Color32::WHITE);
                ui.add_space(2.0);
                // головне меню
                egui::menu::menu_custom_button(ui, egui::Button::image(icons::image("menu", MUTE, 16.0)).frame(false).min_size(vec2(28.0, 28.0)), |ui| {
                    menu_style(ui);
                    ui.menu_button("Файл", |ui| self.menu_file(ui));
                    ui.menu_button("Перехід", |ui| self.menu_goto(ui));
                    ui.menu_button("Вигляд", |ui| self.menu_view(ui));
                    ui.menu_button("Інструменти", |ui| self.menu_tools(ui));
                });
                // проєкт
                let name = self.st.project.as_ref().map_or("Transly".to_string(), transly_core::projname::project_title);
                let letters = self.st.project.as_ref().map_or("T".to_string(), transly_core::projname::icon_letters);
                let resp = pill(ui, Some(&letters), None, &name, true, false);
                pop(ui, &resp, "projpop", |ui| {
                    if mi(ui, "Відкрити гру…", true).clicked() {
                        self.open_dialog();
                    }
                    if mi(ui, "Зберегти", can).clicked() {
                        self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
                    }
                    if mi(ui, "Налаштування проєкту…", can).clicked() {
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
                ui.add_space(2.0);
                // режим: Таблиця, Редагування, Сцена
                ui.add_enabled_ui(can, |ui| {
                    egui::Frame::new().fill(over_ground(0.05)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::same(2)).show(ui, |ui| {
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
                ui.add_space(6.0);
                if can {
                    let p = self.st.progress();
                    let pc = |n: usize| (n * 100).checked_div(p.total).unwrap_or(0);
                    let (r, _) = ui.allocate_exact_size(vec2(120.0, 5.0), Sense::hover());
                    ui.painter().rect_filled(r, CornerRadius::same(R1), TRACK);
                    let mut x = r.left();
                    for (n, col) in [(p.approved, OK), (p.sent, INFO), (p.draft, WARN)] {
                        let w = if p.total > 0 { r.width() * n as f32 / p.total as f32 } else { 0.0 };
                        ui.painter().rect_filled(Rect::from_min_size(pos2(x, r.top()), vec2(w, 5.0)), CornerRadius::ZERO, col);
                        x += w;
                    }
                    let done = p.draft + p.sent + p.approved;
                    let full = format!("Перекладено {}% ({} з {}) · надіслано {}% · вичитано {}%", pc(done), fmt_n(done), fmt_n(p.total), pc(p.sent), pc(p.approved));
                    if ctx.screen_rect().width() > 1180.0 {
                        ui.label(RichText::new(full).monospace().size(10.0).color(MUTE));
                    } else {
                        ui.label(RichText::new(format!("{}%", pc(done))).monospace().size(10.0).color(MUTE)).on_hover_text(full);
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    if icons::button(ui, "keys", "Гарячі клавіші", false, MUTE).clicked() {
                        self.keys_win = !self.keys_win;
                    }
                    let resp = icons::button(ui, "menu", "Дії: масові дії, скасування, автозаповнення, пошук і заміна", false, MUTE);
                    pop(ui, &resp, "actpop", |ui| self.menu_actions(ui));
                    // сповіщення: як у старому дзвоник між «Запустити» і «Дії»; поки що заглушка
                    if icons::button(ui, "bell", "Сповіщення: що потребує уваги й що змінили інші", false, MUTE).clicked() {
                        self.message = "Сповіщення: розділ у розробці".into();
                    }
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
        menu_style(ui);
            if mi(ui, "Відкрити гру…", true).clicked() {
                self.open_dialog();
                ui.close_menu();
            }
            if mi(ui, "Зберегти проєкт", self.st.is_open()).clicked() {
                self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e);
                ui.close_menu();
            }
            if mi(ui, "Відкрити проєкт із файлу…", self.st.is_open()).on_hover_text("Наприклад, файл, збережений зі старого застосунку: переклади й налаштування беруться з нього").clicked() {
                if let Some(p) = rfd::FileDialog::new().add_filter("Проєкт Transly", &["json"]).pick_file() {
                    self.message = self.st.open_project_file(&p).unwrap_or_else(|e| e);
                    self.draft_for = None;
                }
                ui.close_menu();
            }
            if mi(ui, "Злити з іншим проєктом…", self.st.is_open()).clicked() {
                self.act_merge();
                ui.close_menu();
            }
            if mi(ui, "Повернути оригінали гри", self.st.is_open()).clicked() {
                self.act_restore();
                ui.close_menu();
            }
            menu_sep(ui);
            if mi(ui, "Імпорт пам’яті й глосарія…", self.st.is_open()).clicked() {
                self.import_win = Some((0, String::new()));
                ui.close_menu();
            }
            if mi(ui, "Додати довідкову мову…", self.st.is_open()).clicked() {
                self.ref_win = Some(String::new());
                ui.close_menu();
            }
            if mi(ui, "Налаштування проєкту…", self.st.is_open()).clicked() {
                self.act_settings();
                ui.close_menu();
            }
    }

    /// «Пошук скрізь» (Ctrl+K): файли, рядки й терміни одним списком; стрілки й Enter, клік відкриває результат.
    fn search_window(&mut self, ctx: &egui::Context) {
        let Some((mut q, mut sel)) = self.search_win.take() else { return };
        let hits = self.st.search_all(&q, 8);
        // позиції результатів по порядку: файли, рядки, терміни
        let n = hits.files.len() + hits.rows.len() + hits.terms.len();
        let (down, up, enter, esc) = ctx.input_mut(|i| (i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowDown), i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowUp), i.consume_key(egui::Modifiers::NONE, egui::Key::Enter), i.consume_key(egui::Modifiers::NONE, egui::Key::Escape)));
        if n > 0 {
            if down {
                sel = (sel + 1) % n;
            }
            if up {
                sel = (sel + n - 1) % n;
            }
        }
        sel = sel.min(n.saturating_sub(1));
        let mut pick: Option<usize> = (enter && n > 0).then_some(sel);
        let mut open = !esc;
        let names = self.st.file_names();
        egui::Window::new("Пошук скрізь").title_bar(false).anchor(Align2::CENTER_TOP, vec2(0.0, 70.0)).fixed_size(vec2(560.0, 0.0)).frame(egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::same(12))).show(ctx, |ui| {
            let te = ui.add(egui::TextEdit::singleline(&mut q).hint_text("Файл, рядок чи термін").desired_width(f32::INFINITY).font(ip(14.0)).margin(vec2(10.0, 8.0)));
            te.request_focus();
            ui.add_space(8.0);
            let mut idx = 0usize;
            let group = |ui: &mut egui::Ui, title: String| {
                ui.add_space(4.0);
                ui.label(RichText::new(title.to_uppercase()).size(11.0).color(MUTE));
            };
            let item = |ui: &mut egui::Ui, idx: usize, dot: Option<RowStatus>, title: &str, sub: &str, place: &str| -> bool {
                let h = if sub.is_empty() && place.is_empty() { 26.0 } else { 48.0 };
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), h), Sense::click());
                resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("{title} {sub}")));
                if idx == sel {
                    ui.painter().rect_filled(rect, CornerRadius::same(8), SEL_GRAY_UI);
                } else if resp.hovered() {
                    ui.painter().rect_filled(rect, CornerRadius::same(8), GHOST_HOVER);
                }
                let mut x = rect.left() + 10.0;
                if let Some(st) = dot {
                    paint_state(ui, pos2(x + 4.0, rect.top() + 14.0), st, false);
                    x += 18.0;
                }
                let clip = Rect::from_min_max(pos2(x, rect.top()), pos2(rect.right() - 8.0, rect.bottom()));
                let p = ui.painter().with_clip_rect(clip);
                p.text(pos2(x, rect.top() + 14.0), Align2::LEFT_CENTER, title.replace('\n', " "), ip(13.0), TEXT);
                if !sub.is_empty() {
                    p.text(pos2(x, rect.top() + 30.0), Align2::LEFT_CENTER, sub.replace('\n', " "), ip(12.0), MUTE);
                }
                if !place.is_empty() {
                    ui.painter().text(pos2(rect.right() - 10.0, rect.top() + 14.0), Align2::RIGHT_CENTER, place, mp(11.0), DIM);
                }
                resp.clicked()
            };
            if !hits.files.is_empty() {
                group(ui, "Файли".into());
                for (_, name) in &hits.files {
                    if item(ui, idx, None, name.trim_end_matches(".json"), "", "") {
                        pick = Some(idx);
                    }
                    idx += 1;
                }
            }
            if !hits.rows.is_empty() {
                let more = if hits.rows_total > hits.rows.len() { format!("Рядки · показано {} з {}{}", hits.rows.len(), hits.rows_total, if hits.rows_total >= 999 { "+" } else { "" }) } else { "Рядки".into() };
                group(ui, more);
                for r in &hits.rows {
                    let place = format!("{} · {}", names.get(r.file).map_or("", |n| n.trim_end_matches(".json")), short_key(&self.st.key_of(r.file, r.row)));
                    if item(ui, idx, Some(r.status), &r.source, &r.target, &place) {
                        pick = Some(idx);
                    }
                    idx += 1;
                }
            }
            if !hits.terms.is_empty() {
                group(ui, "Терміни".into());
                for (en, uk) in &hits.terms {
                    if item(ui, idx, None, en, uk, "") {
                        pick = Some(idx);
                    }
                    idx += 1;
                }
            }
            if n == 0 {
                ui.label(RichText::new("Нічого не знайдено").color(MUTE));
            }
        });
        if let Some(p) = pick.filter(|p| *p < n) {
            let (nf, nr) = (hits.files.len(), hits.rows.len());
            if p < nf {
                self.st.file = Some(hits.files[p].0);
                self.st.row = None;
            } else if p < nf + nr {
                let r = &hits.rows[p - nf];
                self.st.filter = Filter::All;
                self.st.search.clear();
                self.st.file = Some(r.file);
                self.st.row = Some(r.row);
            } else {
                let (en, _) = &hits.terms[p - nf - nr];
                self.message = format!("Термін «{en}»: відкрийте його в панелі «Пов’язане» біля рядка, де він трапляється");
            }
            self.draft_for = None;
            self.cell_edit = None;
            open = false;
        }
        if open {
            self.search_win = Some((q, sel));
        }
    }

    /// Сповіщення внизу посередині на 6 с: нове повідомлення; після масової дії з кнопкою «Скасувати».
    fn toast_ui(&mut self, ctx: &egui::Context) {
        let undo_now = self.st.undo_count;
        if (self.message.as_str(), undo_now) != (self.toast_seen.0.as_str(), self.toast_seen.1) {
            let undoable = undo_now != self.toast_seen.1;
            if !self.message.is_empty() {
                self.toast = Some((self.message.clone(), std::time::Instant::now(), undoable));
            }
            self.toast_seen = (self.message.clone(), undo_now);
        }
        let Some((text, since, undoable)) = self.toast.clone() else { return };
        if since.elapsed().as_secs() >= 6 {
            self.toast = None;
            return;
        }
        ctx.request_repaint_after(std::time::Duration::from_millis(500));
        let mut undo = false;
        let mut close = false;
        egui::Area::new(egui::Id::new("toast")).anchor(Align2::CENTER_BOTTOM, vec2(0.0, -48.0)).order(egui::Order::Foreground).show(ctx, |ui| {
            egui::Frame::new().fill(PANEL).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(10)).inner_margin(egui::Margin::symmetric(14, 9)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&text).color(TEXT));
                    if undoable && plain_button(ui, "Скасувати").clicked() {
                        undo = true;
                    }
                    if plain_button(ui, "x").clicked() {
                        close = true;
                    }
                });
            });
        });
        if undo {
            self.message = self.st.undo_last();
            self.toast_seen = (self.message.clone(), self.st.undo_count);
            self.toast = Some((self.message.clone(), std::time::Instant::now(), false));
        } else if close {
            self.toast = None;
        }
    }

    /// «Конструкції»: пропозиції записів у глосарій за вже перекладеними рядками; «Додати», «Показати» (перший рядок), «Не зараз».
    fn mine_window(&mut self, ctx: &egui::Context) {
        let Some(list) = self.mine_win.clone() else { return };
        let mut open = true;
        let mut add: Option<usize> = None;
        let mut show: Option<usize> = None;
        let mut no: Option<usize> = None;
        let shown: Vec<&transly_core::mine::ConstructionSuggestion> = list.iter().filter(|x| !self.mine_no.contains(&x.en)).collect();
        dlg("Конструкції").open(&mut open).collapsible(false).default_width(560.0).default_height(460.0).show(ctx, |ui| {
            if shown.is_empty() {
                ui.add_space(8.0);
                ui.label(RichText::new("Нових конструкцій не знайдено: або їх немає, або всі вже в глосарії.").color(MUTE));
                return;
            }
            ui.label(RichText::new("Звороти, які ваші рядки вже передають одним словом. Додайте запис у глосарій, і QA стежитиме за цим словом.").color(MUTE));
            ui.add_space(6.0);
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                for (i, x) in shown.iter().take(20).enumerate() {
                    egui::Frame::new().fill(PANEL2).stroke(Stroke::new(1.0_f32, LINE)).corner_radius(CornerRadius::same(8)).inner_margin(egui::Margin::symmetric(12, 9)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(&x.en).strong().color(TEXT));
                            ui.label(RichText::new("→").color(MUTE));
                            ui.label(RichText::new(&x.uk).strong().color(TEXT));
                        });
                        ui.label(RichText::new(format!("так уже перекладено в {} рядках", x.rows.len())).size(11.5).color(MUTE));
                        ui.horizontal(|ui| {
                            if primary_button(ui, "Додати").clicked() {
                                add = Some(i);
                            }
                            if plain_button(ui, &format!("Показати {}", x.rows.len())).clicked() {
                                show = Some(i);
                            }
                            if plain_button(ui, "Не зараз").clicked() {
                                no = Some(i);
                            }
                        });
                    });
                    ui.add_space(6.0);
                }
            });
        });
        if let Some(i) = add {
            let x = shown[i].clone();
            self.message = self.st.add_term(&x.en, &x.uk);
            self.mine_win = Some(self.st.mine_suggestions());
        } else if let Some(i) = show {
            let x = shown[i].clone();
            if let Some(r) = x.rows.first() {
                if self.st.open_ref(&r.file, &r.key) {
                    self.draft_for = None;
                    self.cell_edit = None;
                    self.message = format!("«{}»: показано перший із {} рядків", x.en, x.rows.len());
                }
            }
        } else if let Some(i) = no {
            self.mine_no.insert(shown[i].en.clone());
        }
        if !open {
            self.mine_win = None;
        }
    }

    fn menu_goto(&mut self, ui: &mut egui::Ui) {
        menu_style(ui);
        if mi(ui, "Пошук скрізь…  (Ctrl+K)", true).clicked() {
            self.search_win = Some((String::new(), 0));
            ui.close_menu();
        }
        menu_sep(ui);
        use transly_core::queue::QueueKind;
        for (kind, text) in [(QueueKind::Untranslated, "Наступний рядок без перекладу  (Alt+Shift+↓)"), (QueueKind::Error, "Наступна помилка QA  (F8)"), (QueueKind::Advice, "Наступна порада"), (QueueKind::Unreviewed, "Наступний на вичитку"), (QueueKind::SourceChanged, "Наступний зі зміненим оригіналом")] {
            if mi(ui, text, true).clicked() {
                self.message = self.st.jump_queue(kind, true);
                self.draft_for = None;
                self.cell_edit = None;
                ui.close_menu();
            }
        }
    }

    fn menu_view(&mut self, ui: &mut egui::Ui) {
        menu_style(ui);
            if mi(ui, if self.focus { "Режим таблиці" } else { "Режим «Фокус»" }, true).clicked() {
                self.focus = !self.focus;
                ui.close_menu();
            }
            if mi(ui, if self.bottom_open { "Сховати нижню панель" } else { "Показати нижню панель" }, true).clicked() {
                self.bottom_open = !self.bottom_open;
                ui.close_menu();
            }
    }

    fn menu_tools(&mut self, ui: &mut egui::Ui) {
        menu_style(ui);
            if mi(ui, if self.st.syncing() { "Синхронізація триває…" } else { "Синхронізація через GitHub…" }, self.st.is_open()).clicked() {
                self.act_sync();
                ui.close_menu();
            }
            if mi(ui, "Конструкції…", self.st.is_open()).on_hover_text("Звороти на кшталт «take … off», які рядки вже передають одним словом, а в глосарії їх ще немає").clicked() {
                self.mine_win = Some(self.st.mine_suggestions());
                ui.close_menu();
            }
            if mi(ui, if self.st.syncing() { "Синхронізація триває…" } else { "Синхронізація через реле…" }, self.st.is_open()).clicked() {
                self.relay_win = Some(self.st.relay.clone());
                ui.close_menu();
            }
            if mi(ui, "Оновлення…", true).clicked() {
                self.upd.win = true;
                if self.upd.latest.is_none() {
                    self.upd.token = self.token.clone();
                }
                ui.close_menu();
            }
            if mi(ui, "Тексти плагінів…", self.st.is_open()).on_hover_text("Деякі ігри показують текст командами плагінів, а не вікнами повідомлень: позначте, які команди брати").clicked() {
                let (names, asked) = self.st.plugin_choice();
                let mut chosen: std::collections::BTreeSet<String> = names.into_iter().collect();
                if !asked {
                    chosen.extend(self.st.plugin_candidates().into_iter().filter(|c| c.likely).map(|c| c.name));
                }
                self.plug_win = Some(chosen);
                ui.close_menu();
            }
            if mi(ui, "Активність…", self.st.is_open()).clicked() {
                self.activity_win = true;
                ui.close_menu();
            }
            if mi(ui, "Оновити за глосарієм…", self.st.last_term_change.is_some()).clicked() {
                self.open_term_sync();
                ui.close_menu();
            }
            if mi(ui, "Перенесення рядків…", self.st.is_open()).clicked() {
                self.wrap_win = Some((self.st.wrap_settings(), "Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.".into(), false));
                ui.close_menu();
            }
            if mi(ui, "Правила QA…", self.st.is_open()).clicked() {
                self.qar_win = true;
                ui.close_menu();
            }
            if mi(ui, "Гілки перекладу…", self.st.is_open()).clicked() {
                self.br_win = Some(String::new());
                ui.close_menu();
            }
            if mi(ui, "Групи рядків…", self.st.is_open()).clicked() {
                self.groups_win = Some(String::new());
                ui.close_menu();
            }
            if mi(ui, "Мовці…", self.st.is_open()).clicked() {
                self.spk_win = Some(self.st.speaker_candidates());
                ui.close_menu();
            }
            if mi(ui, "Плагіни…", true).clicked() {
                self.act_plugins();
                ui.close_menu();
            }
    }

    fn menu_actions(&mut self, ui: &mut egui::Ui) {
        menu_style(ui);
            let f = self.st.file;
            if mi(ui, "Надіслати чернетки файлу", true).clicked() {
                self.message = self.st.bulk_send(f);
                ui.close_menu();
            }
            if mi(ui, "Надіслати всі чернетки проєкту", true).clicked() {
                self.message = self.st.bulk_send(None);
                ui.close_menu();
            }
            if mi(ui, "Вичитати надіслані файлу", true).clicked() {
                self.message = self.st.bulk_approve(f);
                ui.close_menu();
            }
            if mi(ui, "Вичитати всі надіслані", true).clicked() {
                self.message = self.st.bulk_approve(None);
                ui.close_menu();
            }
            menu_sep(ui);
            if mi(ui, "Прибрати тестовий плагін із гри", true).clicked() {
                self.message = self.st.remove_jump_plugin().unwrap_or_else(|e| e);
                ui.close_menu();
            }
            if mi(ui, "Скасувати останню дію", true).clicked() {
                self.message = self.st.undo_last();
                self.draft_for = None;
                ui.close_menu();
            }
            if mi(ui, "Повторити скасоване", true).clicked() {
                self.message = self.st.redo_last();
                self.draft_for = None;
                ui.close_menu();
            }
            if mi(ui, "Автозаповнення…", true).clicked() {
                self.fill_win = Some(self.st.autofill_proposals(500).into_iter().map(|p| (p, true)).collect());
                ui.close_menu();
            }
            if mi(ui, "Пошук і заміна…", true).clicked() {
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
        egui::TopBottomPanel::bottom("status").exact_height(24.0).show_separator_line(false).frame(egui::Frame::new().fill(Color32::TRANSPARENT).inner_margin(egui::Margin::symmetric(10, 0))).show(ctx, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 14.0;
                let small = |t: String, c: Color32| RichText::new(t).size(11.0).color(c);
                let now = chrono::Utc::now().timestamp_millis() as f64;
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
                    ui.add_space(-8.0);
                    ui.label(small(text, if dot == OK { OK } else { WARN }));
                    if let Some(f) = self.st.file {
                        ui.label(small(self.st.format_label(f).to_string(), MUTE));
                        let stem = self.st.file_names().get(f).cloned().unwrap_or_default().trim_end_matches(".json").to_string();
                        let mut here = format!("Файл: {stem}");
                        if let Some(r) = self.st.row {
                            let st = match self.st.row_view(f, r).2 {
                                RowStatus::Untranslated => "без перекладу",
                                RowStatus::Draft => "чернетка",
                                RowStatus::Sent => "чекає вичитування",
                                RowStatus::Approved => "вичитано",
                            };
                            here += &format!(" · рядок {} з {} · {st}", r + 1, self.st.row_count(f));
                        }
                        ui.label(small(here, MUTE));
                        let bad = self.st.file_issues(f).iter().filter(|i| i.2).count();
                        if bad > 0 {
                            ui.label(small(format!("{bad} проблем QA"), BAD));
                        }
                    }
                    if let Some(ms) = self.st.saved_ms {
                        ui.label(small(format!("Копія: {}", transly_core::stamps::ago(ms as f64, now)), MUTE));
                    }
                    match self.st.last_build() {
                        Some((at, rows)) => ui.label(small(format!("Збірка: {} · {} рядків", transly_core::stamps::ago(at as f64, now), fmt_n(rows)), MUTE)),
                        None => ui.label(small("Збірки ще не було".into(), MUTE)),
                    };
                } else {
                    ui.label(small("Гру не відкрито".into(), MUTE));
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 14.0;
                    if self.st.is_open() {
                        let mins = ((now as i64 - self.st.session_start) / 60000).max(0);
                        ui.label(small(format!("Сесія: {} рядків змінено · {mins} хв", self.st.session_edits), MUTE));
                        if let Some(f) = self.st.file {
                            let n = self.st.row_count(f);
                            let c = self.st.filter_counts(f);
                            ui.label(small(format!("Файл: {} / {} вичитано · {} чекають вичитки", c[4], n, c[3]), MUTE));
                        }
                    }
                    if !self.message.is_empty() {
                        ui.label(small(self.message.clone(), MUTE));
                    }
                });
            });
        });
    }

    fn bottom(&mut self, ctx: &egui::Context) {
        if self.focus && !self.scene_mode {
            return;
        }
        let Some(f) = self.st.file else { return };
        // у старому застосунку згорнутої смужки немає зовсім: панель відкривається з меню «Вигляд»
        if !self.bottom_open {
            return;
        }
        let h = 210.0;
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
                        ui.label(RichText::new("   Глосарій порожній: додайте термін у панелі «Пов’язане»").color(MUTE));
                    }
                } else {
                    for (row, msg, is_bad) in issues.iter().take(500) {
                        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::click());
                        if resp.hovered() {
                            ui.painter().rect_filled(rect, CornerRadius::ZERO, GHOST_HOVER);
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
        dlg("Налаштування проєкту").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
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
        dlg("Синхронізація через GitHub").open(&mut open).collapsible(false).resizable(false).default_width(440.0).show(ctx, |ui| {
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

    /// Автообмін із реле: коли налаштовано період і він минув, обмін починається сам (без вікон і повідомлень, крім помилки).
    fn relay_auto(&mut self) {
        let r = &self.st.relay;
        if r.every_min == 0 || !r.configured() || !self.st.is_open() || self.st.syncing() {
            return;
        }
        if state::now_ms() - r.last >= i64::from(r.every_min) * 60_000 {
            if let Err(e) = self.st.start_relay_sync() {
                self.message = e;
                self.st.relay.every_min = 0;
            }
        }
    }

    /// «Синхронізація через реле»: власне сховище між вашими пристроями; усе шифрується паролем, реле бачить лише байти.
    fn relay_window(&mut self, ctx: &egui::Context) {
        let Some(mut cfg) = self.relay_win.clone() else { return };
        let mut open = true;
        let (mut go, mut save) = (false, false);
        dlg("Синхронізація через реле").open(&mut open).collapsible(false).resizable(false).default_width(460.0).show(ctx, |ui| {
            egui::Grid::new("relay_grid").num_columns(2).spacing([14.0, 10.0]).show(ui, |ui| {
                ui.label("Адреса сервера");
                ui.add(egui::TextEdit::singleline(&mut cfg.url).hint_text("https://…").desired_width(280.0));
                ui.end_row();
                ui.label("Пароль синхронізації");
                ui.add(egui::TextEdit::singleline(&mut cfg.passphrase).password(true).desired_width(280.0));
                ui.end_row();
                ui.label("Само, раз на (хв, 0 — вручну)");
                ui.add(egui::DragValue::new(&mut cfg.every_min).range(0..=1440));
                ui.end_row();
            });
            if let Some(p) = transly_platform::relay::url_problem(&cfg.url).filter(|_| !cfg.url.trim().is_empty()) {
                ui.label(RichText::new(p).color(WARN));
            }
            ui.label(RichText::new("Той самий пароль на кожному пристрої дає ту саму «кімнату». Пароль не передається, лише шифрує дані (щонайменше 8 символів). Адреса й пароль лишаються на цьому пристрої, у файл проєкту не потрапляють.").size(11.0).color(MUTE));
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(cfg.configured() && !self.st.syncing(), egui::Button::new(RichText::new("Синхронізувати").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 26.0))).clicked() {
                    go = true;
                }
                if plain_button(ui, "Зберегти").clicked() {
                    save = true;
                }
            });
        });
        if go || save {
            cfg.last = self.st.relay.last;
            self.st.relay = cfg.clone();
            self.st.relay.save();
            if go {
                self.message = match self.st.start_relay_sync() {
                    Ok(()) => "Синхронізація почалась…".into(),
                    Err(e) => e,
                };
            }
            self.relay_win = None;
        } else if !open {
            self.relay_win = None;
        } else {
            self.relay_win = Some(cfg);
        }
    }

    /// Тиха перевірка оновлень при старті (раз за сеанс, не для локальної збірки): знайшла нове — лише повідомлення.
    fn update_auto(&mut self) {
        if self.upd.auto_done || transly_platform::selfupdate::build_id() == "dev" {
            return;
        }
        self.upd.auto_done = true;
        self.upd.silent = true;
        self.update_check();
    }

    fn update_check(&mut self) {
        if self.upd.rx.is_some() {
            return;
        }
        self.upd.status = "Перевіряю…".into();
        let (repo, token) = (self.upd.repo.clone(), self.upd.token.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(UpdMsg::Checked(transly_platform::selfupdate::check_latest(&repo, &token)));
        });
        self.upd.rx = Some(rx);
    }

    fn update_download(&mut self) {
        let Some(asset) = self.upd.latest.as_ref().and_then(|l| l.asset.clone()) else { return };
        if self.upd.rx.is_some() {
            return;
        }
        self.upd.status = "Завантажую оновлення…".into();
        let token = self.upd.token.clone();
        let dir = std::env::temp_dir().join("transly-native-update");
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(UpdMsg::Downloaded(transly_platform::selfupdate::download_new(&asset, &token, &dir)));
        });
        self.upd.rx = Some(rx);
    }

    /// Забирає відповіді потоків оновлення; після завантаження запускає заміну файлу й просить закритися.
    fn update_poll(&mut self, ctx: &egui::Context) {
        let Some(msg) = self.upd.rx.as_ref().and_then(|r| r.try_recv().ok()) else { return };
        self.upd.rx = None;
        match msg {
            UpdMsg::Checked(Err(e)) => {
                self.upd.status = e.clone();
                if !self.upd.silent {
                    self.message = e;
                }
            }
            UpdMsg::Checked(Ok(l)) => {
                let newer = l.newer;
                self.upd.status = if newer { "Є нова версія.".into() } else { "У вас остання версія.".into() };
                if newer && self.upd.silent {
                    self.message = "Є нова версія: відкрийте «Інструменти → Оновлення…»".into();
                } else if !self.upd.silent {
                    self.message = self.upd.status.clone();
                }
                self.upd.latest = Some(l);
            }
            UpdMsg::Downloaded(Err(e)) => {
                self.upd.status = e.clone();
                self.message = e;
            }
            UpdMsg::Downloaded(Ok(path)) => {
                // зберегти проєкт, запустити помічника (він підмінить файл після закриття) і закритися
                let _ = self.st.save_project();
                match transly_platform::selfupdate::spawn_replace(&path, true) {
                    Ok(()) => {
                        self.upd.status = "Оновлення встановиться, коли застосунок закриється; він запуститься знову.".into();
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                    Err(e) => {
                        self.upd.status = e.clone();
                        self.message = e;
                    }
                }
            }
        }
        self.upd.silent = false;
    }

    /// «Оновлення…»: версія збірки, перевірка, завантаження й встановлення (файл підміняється після закриття, застосунок стартує знову).
    fn update_window(&mut self, ctx: &egui::Context) {
        self.update_poll(ctx);
        self.update_auto();
        if self.upd.rx.is_some() {
            ctx.request_repaint_after(std::time::Duration::from_millis(300));
        }
        if !self.upd.win {
            return;
        }
        let mut open = true;
        let (mut check, mut install) = (false, false);
        let busy = self.upd.rx.is_some();
        let can_install = self.upd.latest.as_ref().is_some_and(|l| l.newer && l.asset.is_some()) && !busy;
        dlg("Оновлення").open(&mut open).collapsible(false).resizable(false).default_width(440.0).show(ctx, |ui| {
            let id = transly_platform::selfupdate::build_id();
            ui.label(RichText::new(format!("Версія збірки: {}", if id == "dev" { "локальна".to_string() } else { id.chars().take(7).collect() })).color(MUTE));
            ui.add_space(6.0);
            egui::Grid::new("upd_grid").num_columns(2).spacing([14.0, 10.0]).show(ui, |ui| {
                ui.label("Репозиторій зі збірками");
                ui.add(egui::TextEdit::singleline(&mut self.upd.repo).desired_width(240.0));
                ui.end_row();
                ui.label("Токен (лише для приватного)");
                ui.add(egui::TextEdit::singleline(&mut self.upd.token).password(true).desired_width(240.0));
                ui.end_row();
            });
            if let Some(l) = &self.upd.latest {
                ui.add_space(6.0);
                let when = chrono::DateTime::parse_from_rfc3339(&l.release.published).map(|d| d.with_timezone(&chrono::Local).format("%d.%m.%Y %H:%M").to_string()).unwrap_or_default();
                ui.label(RichText::new(format!("Останній реліз: {}{}", l.release.sha.chars().take(7).collect::<String>(), if when.is_empty() { String::new() } else { format!(" · {when}") })).color(TEXT));
                if let Some((name, _, size)) = &l.asset {
                    ui.label(RichText::new(format!("Файл: {name} ({:.1} МБ)", *size as f64 / 1_048_576.0)).size(11.5).color(MUTE));
                }
            }
            if !self.upd.status.is_empty() {
                ui.add_space(6.0);
                ui.label(RichText::new(&self.upd.status).color(MUTE));
            }
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(!busy, egui::Button::new("Перевірити зараз")).clicked() {
                    check = true;
                }
                if ui.add_enabled(can_install, egui::Button::new(RichText::new("Завантажити й встановити").color(Color32::WHITE)).fill(accent_solid())).clicked() {
                    install = true;
                }
            });
        });
        if check {
            self.update_check();
        }
        if install {
            self.update_download();
        }
        if !open {
            self.upd.win = false;
        }
    }

    /// «Тексти плагінів»: команди плагінів (код 356), що трапляються в грі; позначені несуть текст для гравця й потрапляють у таблицю.
    fn plug_window(&mut self, ctx: &egui::Context) {
        let Some(mut chosen) = self.plug_win.clone() else { return };
        let cands = self.st.plugin_candidates();
        let (saved, _) = self.st.plugin_choice();
        let known: std::collections::HashSet<&str> = cands.iter().map(|c| c.name.as_str()).collect();
        let keep: Vec<String> = saved.iter().filter(|n| !known.contains(n.as_str())).cloned().collect();
        let mut open = true;
        let (mut apply, mut cancel) = (false, false);
        dlg("Тексти плагінів").open(&mut open).collapsible(false).default_width(520.0).default_height(440.0).show(ctx, |ui| {
            ui.label(RichText::new("Деякі ігри показують текст не у вікнах повідомлень, а командами плагінів (спливаючі репліки, пункти меню). Позначте команди, чий текст треба перекладати. Що саме в них, видно з прикладів.").color(MUTE));
            ui.add_space(6.0);
            if cands.is_empty() {
                ui.label(RichText::new("У цій грі не знайдено команд плагінів із текстом.").color(MUTE));
            }
            egui::ScrollArea::vertical().auto_shrink([false, true]).max_height(300.0).show(ui, |ui| {
                for c in &cands {
                    let mut on = chosen.contains(&c.name);
                    ui.horizontal(|ui| {
                        if ui.checkbox(&mut on, "").changed() {
                            if on {
                                chosen.insert(c.name.clone());
                            } else {
                                chosen.remove(&c.name);
                            }
                        }
                        ui.vertical(|ui| {
                            ui.label(RichText::new(&c.name).strong().color(TEXT));
                            ui.label(RichText::new(format!("{} з текстом{}{}", c.with_text, if c.with_text < c.count { format!(" із {}", c.count) } else { String::new() }, if c.likely { " · схоже на текст для гравця" } else { "" })).size(11.5).color(MUTE));
                            for x in c.samples.iter().take(3) {
                                ui.label(RichText::new(format!("«{}»", x.replace('\n', " "))).size(11.5).color(DIM));
                            }
                        });
                    });
                    ui.add_space(4.0);
                }
            });
            if !keep.is_empty() {
                ui.label(RichText::new(format!("Також увімкнено раніше: {}.", keep.join(", "))).color(MUTE));
            }
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if primary_button(ui, "Застосувати").clicked() {
                    apply = true;
                }
                if plain_button(ui, "Скасувати").clicked() {
                    cancel = true;
                }
            });
        });
        if apply {
            let mut names = keep.clone();
            names.extend(chosen.iter().cloned());
            self.message = self.st.set_plugin_commands(&names);
            self.draft_for = None;
            self.cell_edit = None;
            self.plug_win = None;
        } else if cancel || !open {
            self.plug_win = None;
        } else {
            self.plug_win = Some(chosen);
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
        dlg("Плагіни").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
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
        dlg("Пошук і заміна в перекладах").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
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
        dlg("Автозаповнення").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
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
        dlg("Збірка в гру").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
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
        dlg("Імпорт").open(&mut open).collapsible(false).default_width(520.0).show(ctx, |ui| {
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
        dlg("Мовці").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
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
        dlg("Довідкова мова").open(&mut open).collapsible(false).resizable(false).default_width(440.0).show(ctx, |ui| {
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
        dlg("Групи рядків").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
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
        dlg("Гілки перекладу").open(&mut open).collapsible(false).default_width(480.0).show(ctx, |ui| {
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
        dlg("Правила QA").open(&mut open).collapsible(false).default_width(620.0).default_height(440.0).show(ctx, |ui| {
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
        dlg("Перенесення рядків").open(&mut open).collapsible(false).default_width(560.0).show(ctx, |ui| {
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
        dlg(format!("Злиття гілки «{src}»")).open(&mut open).collapsible(false).default_width(680.0).default_height(460.0).show(ctx, |ui| {
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
        dlg("Назва гілки").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
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
        dlg(format!("Оновити за глосарієм: {} → {}", change.old.join(", "), change.next)).open(&mut open).collapsible(false).default_width(720.0).default_height(480.0).show(ctx, |ui| {
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
        dlg("Активність").open(&mut open).collapsible(false).default_width(640.0).default_height(460.0).show(ctx, |ui| {
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
        dlg("Гарячі клавіші").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
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
        // вибраний рядок у таблиці позначений; у «Редагуванні» зʼявляється поле з кнопкою надсилання
        h.state_mut().st.row = Some(0);
        h.run();
        assert_eq!(h.state().st.row, Some(0));
        h.get_by_label_contains("Hero");
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.run();
        assert!(h.get_all_by_label("Надіслати").count() >= 1, "кнопка є в редакторі");
    }

    #[test]
    fn the_length_filter_keeps_only_translated_rows_far_from_the_original() {
        let data = game("lenfilter");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let f = app.st.file.unwrap_or(0);
        assert!(!app.st.file_has_speakers(f));
        let all = app.st.visible_len(f);
        app.st.edit(f, 0, "Герой, дуже-дуже-дуже довгий переклад короткого слова");
        app.st.len_filter = 1;
        let far = app.st.visible_len(f);
        assert!(far >= 1 && far < all, "лишились лише перекладені рядки з великим відхиленням");
        app.st.len_filter = 0;
        assert_eq!(app.st.visible_len(f), all);
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
    fn a_table_cell_is_edited_in_place_and_enter_saves_and_moves_on() {
        let data = game("cell");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        app.draft = "Герой".into();
        app.draft_for = Some((0, 0));
        app.cell_edit = Some((0, 0));
        app.cell_focus = true;
        let mut h = harness(app);
        h.run();
        press(&mut h, egui::Modifiers::NONE, egui::Key::Enter);
        h.run();
        h.run();
        assert_eq!(h.state().st.target_of(0, 0), "Герой");
        assert_eq!(h.state().st.row, Some(1), "Enter веде до наступного рядка");
        assert_eq!(h.state().cell_edit, Some((0, 1)));
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        assert_eq!(h.state().cell_edit, None);
    }

    #[test]
    fn a_scene_line_is_typed_in_its_card_and_saved_when_the_field_loses_focus() {
        let data = game("scenecard");
        let dir = data.clone();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let l = [cmd(101, r#""",0,0,2,"Оповідач""#), cmd(401, r#""The hall is silent.""#), cmd(0, "")].join(",");
        std::fs::write(dir.join("Map001.json"), format!(r#"{{"displayName":"Зал","events":[null,{{"id":1,"name":"Зал","x":1,"y":1,"pages":[{{"conditions":{{}},"list":[{l}],"trigger":0}}]}}]}}"#)).unwrap();
        let mut app = App::default();
        app.st.open_game(&dir).unwrap();
        let f = app.st.file_names().iter().position(|n| n == "Map001.json").unwrap();
        app.st.file = Some(f);
        app.st.row = app.st.scene_view(f, 1).map(|v| v.lines[0].row);
        app.scene_mode = true;
        let mut h = harness(app);
        h.run();
        let row = h.state().st.row.unwrap();
        // набраний текст лежить у чернетці сцени й потрапляє в проєкт при надсиланні
        h.state_mut().scene_draft = Some((row, "У залі тихо.".into()));
        h.run();
        h.get_by_label(&format!("Надіслати репліку {}", row + 1)).click();
        h.run();
        assert_eq!(h.state().st.target_of(f, row), "У залі тихо.");
        assert!(h.state().scene_draft.is_none());
        assert_eq!(h.state().st.progress().sent, 1);
        assert_eq!(h.state().st.map_title(f).as_deref(), Some("Зал"));
        h.get_by_label("Вичитати сцену").click();
        h.run();
        assert_eq!(h.state().st.progress().approved, 1, "«Вичитати сцену» затверджує надіслані репліки");
    }

    #[test]
    fn ticked_rows_are_sent_together() {
        let data = game("ticks");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.edit(0, 0, "Герой");
        app.st.edit(0, 1, "Хоробрий");
        let mut h = harness(app);
        h.run();
        h.get_by_label("Вибрати всі видимі рядки").click();
        h.run();
        assert_eq!(h.state().checked.1.len(), 4);
        h.get_by_label("Надіслати вибрані").click();
        h.run();
        assert_eq!(h.state().st.progress().sent, 2, "надіслано лише чернетки з вибраних");
        assert!(h.state().checked.1.is_empty());
        // після масової дії сповіщення має «Скасувати»
        h.run();
        h.get_by_label("Скасувати").click();
        h.run();
        assert_eq!(h.state().st.progress().sent, 0, "«Скасувати» у сповіщенні повертає надіслане");
    }

    #[test]
    fn jumping_to_the_next_untranslated_row_wraps_and_clears_filters() {
        let data = game("jump");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.edit(0, 0, "Герой");
        app.st.edit(0, 1, "Хоробрий");
        app.st.row = Some(0);
        app.st.search = "Wise".into();
        let mut h = harness(app);
        h.run();
        press(&mut h, egui::Modifiers { alt: true, shift: true, ..Default::default() }, egui::Key::ArrowDown);
        h.run();
        assert_eq!(h.state().st.row, Some(2), "перший рядок без перекладу після поточного");
        assert!(h.state().st.search.is_empty(), "фільтри скинуто, щоб рядок було видно");
        assert!(h.state().message.contains("Без перекладу: 1 з 2"), "{}", h.state().message);
        h.state_mut().st.edit(0, 2, "Маг");
        h.state_mut().st.edit(0, 3, "Мудрий");
        press(&mut h, egui::Modifiers::NONE, egui::Key::F8);
        h.run();
        assert_eq!(h.state().message, "Помилок QA немає");
    }

    #[test]
    fn search_everywhere_finds_rows_and_enter_opens_the_hit() {
        let data = game("searchall");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.edit(0, 0, "Герой");
        let hits = app.st.search_all("герой", 8);
        assert_eq!(hits.rows.len(), 1, "шукає й у перекладах");
        assert_eq!(app.st.search_all("hero", 8).rows_total, 1);
        assert_eq!(app.st.search_all("", 8).files.len(), 1);
        app.search_win = Some(("wise".into(), 0));
        let mut h = harness(app);
        h.run();
        press(&mut h, egui::Modifiers::NONE, egui::Key::Enter);
        h.run();
        assert_eq!(h.state().st.row, Some(3), "відкрито рядок із Wise");
        assert!(h.state().search_win.is_none());
        // Ctrl+K відкриває вікно, Esc закриває
        press(&mut h, egui::Modifiers::COMMAND, egui::Key::K);
        h.run();
        assert!(h.state().search_win.is_some());
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        assert!(h.state().search_win.is_none());
    }

    #[test]
    fn contributions_are_voted_ticked_and_dropped() {
        let data = game("contrib");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.submit(0, 0, "Герой").unwrap();
        app.st.submit(0, 0, "Воїн").unwrap();
        let list = app.st.contributions(0, 0);
        assert_eq!(list.len(), 2, "кожен надісланий текст — окремий внесок");
        let old = list.iter().find(|(v, _)| v.text == "Герой").unwrap().0.clone();
        app.st.vote_variant(0, 0, &old.id, 1);
        assert_eq!(app.st.contributions(0, 0).iter().find(|(v, _)| v.id == old.id).unwrap().1.up, 1);
        app.st.vote_variant(0, 0, &old.id, 1);
        assert_eq!(app.st.contributions(0, 0).iter().find(|(v, _)| v.id == old.id).unwrap().1.up, 0, "той самий голос ще раз знімає його");
        // галочка на старому внеску: переклад іде в рядок і рядок вичитано
        app.st.tick_variant(0, 0, &old.id).unwrap();
        assert_eq!(app.st.target_of(0, 0), "Герой");
        assert_eq!(app.st.progress().approved, 1);
        // знята картка зникає зі списку
        let other = app.st.contributions(0, 0).into_iter().find(|(v, _)| v.text == "Воїн").unwrap().0;
        app.st.drop_variant(0, 0, &other.id);
        assert!(app.st.contributions(0, 0).iter().all(|(v, _)| v.text != "Воїн"));
    }

    #[test]
    fn constructions_are_proposed_and_added_to_the_glossary() {
        // самі пропозиції перевіряють золоті вектори ядра; тут — вікно: «Додати» пише запис у глосарій, «Не зараз» ховає картку
        let data = game("mine");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let sug = |en: &str, uk: &str| transly_core::mine::ConstructionSuggestion { en: en.into(), uk: uk.into(), rows: vec![transly_core::mine::MineRef { file: "Actors.json".into(), key: "[1].name".into() }] };
        app.mine_win = Some(vec![sug("take … off", "зняти"), sug("put … on", "одягти")]);
        let mut h = harness(app);
        h.run();
        h.get_all_by_label("Не зараз").next().unwrap().click();
        h.run();
        assert_eq!(h.state().mine_no.len(), 1);
        assert_eq!(h.get_all_by_label("Додати").count(), 1, "відкладена картка зникла");
        h.get_all_by_label("Додати").next().unwrap().click();
        h.run();
        assert_eq!(h.state().st.terms().len(), 1, "запис додано в глосарій");
    }

    #[test]
    fn the_relay_window_saves_the_settings_and_refuses_a_bad_address() {
        let data = game("relay");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.relay_win = Some(state::RelayCfg { url: "not a url".into(), passphrase: "correct horse battery".into(), every_min: 0, last: 0 });
        let mut h = harness(app);
        h.run();
        h.get_by_label("Зберегти").click();
        h.run();
        assert!(h.state().relay_win.is_none());
        assert_eq!(h.state().st.relay.passphrase, "correct horse battery");
        assert!(!h.state().st.relay.configured(), "адреса не схожа на адресу");
        assert_eq!(h.state_mut().st.start_relay_sync().unwrap_err(), "Адреса сервера має починатися з https:// (для власної мережі можна http://)");
        h.state_mut().st.relay.url = "https://relay.example".into();
        assert!(h.state().st.relay.configured());
    }

    #[test]
    fn the_update_window_checks_the_repository_name_without_the_network() {
        let mut app = App::default();
        app.upd.win = true;
        app.upd.repo = "не-репозиторій".into();
        let mut h = harness(app);
        h.run();
        h.get_by_label("Перевірити зараз").click();
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            h.run();
            if h.state().upd.rx.is_none() {
                break;
            }
        }
        assert_eq!(h.state().upd.status, "Репозиторій вкажіть як «власник/назва»");
        assert!(h.state().upd.latest.is_none());
    }

    #[test]
    fn plugin_command_texts_join_the_table_when_chosen_and_stay_after_reopening() {
        let base = std::env::temp_dir().join(format!("transly-ui-plug-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |t: &str| format!(r#"{{"code":356,"indent":0,"parameters":["GabText {t}"]}}"#);
        let l = [cmd("Hello there, my friend"), cmd("Welcome to the old town"), cmd("Where did you come from today"), cmd("The road is long and dark"), r#"{"code":0,"indent":0,"parameters":[]}"#.to_string()].join(",");
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"Зал","events":[null,{{"id":1,"name":"Зал","x":1,"y":1,"pages":[{{"conditions":{{}},"list":[{l}],"trigger":0}}]}}]}}"#)).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let rows = |a: &App| a.st.file_names().iter().position(|n| n == "Map001.json").map_or(0, |f| a.st.row_count(f));
        // перше відкриття: схожі на текст команди беруться самі (як у старому застосунку), і про це сказано
        let with = rows(&app);
        assert!(app.st.last_note.contains("GabText"), "{}", app.st.last_note);
        let cands = app.st.plugin_candidates();
        assert!(cands.iter().any(|c| c.name == "GabText" && c.with_text == 4), "{:?}", cands.iter().map(|c| (&c.name, c.with_text)).collect::<Vec<_>>());
        // у вікні вибір можна зняти: тексти команди йдуть із таблиці
        app.plug_win = Some(Default::default());
        let mut h = harness(app);
        h.run();
        h.get_by_label("Застосувати").click();
        h.run();
        assert!(rows(h.state()) < with, "без команди її текстів у таблиці менше");
        h.state_mut().plug_win = Some(["GabText".to_string()].into_iter().collect());
        h.run();
        h.get_by_label("Застосувати").click();
        h.run();
        assert_eq!(rows(h.state()), with);
        // після повторного відкриття вибір лишається (він у налаштуваннях проєкту)
        h.state_mut().st.save_project().unwrap();
        let after = rows(h.state());
        let mut again = App::default();
        again.st.open_game(&data).unwrap();
        assert_eq!(rows(&again), after);
    }

    #[test]
    fn strands_show_glossary_terms_with_their_state_and_game_names_with_their_translation() {
        use transly_core::strands::StrandState;
        let base = std::env::temp_dir().join(format!("transly-ui-strands-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"Harold","nickname":"","profile":"","note":""}]"#).unwrap();
        std::fs::write(data.join("Items.json"), r#"[null,{"id":1,"name":"Sword","description":"Harold swings the sword of light","note":""}]"#).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.add_term("sword", "меч");
        let fi = app.st.file_names().iter().position(|n| n == "Items.json").unwrap();
        let ri = (0..app.st.row_count(fi)).find(|r| app.st.source_of(fi, *r).starts_with("Harold swings")).unwrap();
        let before = app.st.strands(fi, ri);
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].0.state, StrandState::Pending, "ще не перекладено");
        app.st.edit(fi, ri, "Гарольд змахує мечем світла");
        assert_eq!(app.st.strands(fi, ri)[0].0.state, StrandState::Ok, "«меч» є в перекладі (у формі «мечем»)");
        app.st.edit(fi, ri, "Гарольд змахує клинком світла");
        assert_eq!(app.st.strands(fi, ri)[0].0.state, StrandState::Missing);
        let names = app.st.game_names_in(fi, ri);
        assert!(names.iter().any(|(g, _)| g.name == "Harold"), "ім'я з бази даних Actors знайдено в описі");
        app.st.row = Some(ri);
        app.rail = 3;
        let mut h = harness(app);
        h.run();
    }

    #[test]
    fn icons_and_faces_come_from_the_game_images() {
        use state::Pic;
        let base = std::env::temp_dir().join(format!("transly-ui-pics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("MyGame");
        let data = root.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(root.join("img").join("system")).unwrap();
        std::fs::write(data.join("Items.json"), r#"[null,{"id":1,"name":"Potion","description":"Heals","iconIndex":5,"note":"<Picture: potion_big>"}]"#).unwrap();
        image::RgbaImage::from_pixel(512, 64, image::Rgba([200, 30, 30, 255])).save(root.join("img").join("system").join("IconSet.png")).unwrap();
        let mut app = App::default();
        app.st.open_game(&root).unwrap();
        let fi = app.st.file_names().iter().position(|n| n == "Items.json").unwrap();
        let ri = (0..app.st.row_count(fi)).find(|r| app.st.source_of(fi, *r) == "Potion").unwrap();
        let pics = app.st.pics_of(fi, ri);
        assert!(pics.contains(&Pic::Icon { n: 5, label: "Potion".into() }), "{pics:?}");
        assert!(pics.iter().any(|p| matches!(p, Pic::Picture { name, .. } if name == "potion_big")));
        assert!(app.st.game_image("img/system/IconSet.png").is_some());
        assert!(app.st.game_image("img/pictures/potion_big.png").is_none(), "немає файлу — немає картинки");
        app.st.row = Some(ri);
        app.focus = true;
        let mut h = harness(app);
        h.run();
        assert!(h.state().pic_tex.get("icon:5").is_some_and(|t| t.is_some()), "піктограму вирізано з IconSet.png");
        assert!(h.state().pic_tex.get("picture:potion_big").is_some_and(|t| t.is_none()));
    }

    #[test]
    fn message_codes_are_shown_the_way_the_game_window_shows_them() {
        let who = |n: usize| (n == 1).then(|| "Гарольд".to_string());
        let job = game_job(r"\C[2]Увага!\C[0] \N[1], йди\.\! далі \V[3] \ ", 14.0, &who);
        let text: String = job.sections.iter().map(|s| &job.text[s.byte_range.clone()]).collect::<Vec<_>>().concat();
        assert_eq!(text, r"Увага! Гарольд, йди далі \V[3] \ ", "імена підставлено, коди часу прибрано, інші коди лишились");
        assert_eq!(job.sections[0].format.color, Color32::from_rgb(0xff, 0x78, 0x4c), r"\C[2] фарбує текст");
        assert_eq!(job.sections[1].format.color, TEXT, r"\C[0] повертає колір");
    }

    /// Перевірка на справжній грі (нічого не пише в теку гри й проєкт): `TRANSLY_GAME=<тека> cargo test -p transly-app --release real_game_deep -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_game_deep() {
        use std::time::Instant;
        let Some(dir) = std::env::var_os("TRANSLY_GAME").map(std::path::PathBuf::from) else { return };
        let t0 = Instant::now();
        let mut app = App::default();
        app.st.open_game(&dir).unwrap();
        let names = app.st.file_names();
        let total: usize = (0..names.len()).map(|f| app.st.row_count(f)).sum();
        println!("ВІДКРИТО: {} файлів, {total} рядків за {:.1} с", names.len(), t0.elapsed().as_secs_f32());
        println!("  примітка відкриття: {:?}", app.st.last_note);
        println!("  проєкт: терміни {}, прогрес {:?}", app.st.terms().len(), app.st.progress());
        // найбільший файл і мапа
        let big = (0..names.len()).max_by_key(|f| app.st.row_count(*f)).unwrap();
        let map = (0..names.len()).filter(|f| names[*f].starts_with("Map")).max_by_key(|f| app.st.row_count(*f)).unwrap();
        println!("  найбільший файл {} ({}), найбільша мапа {} ({})", names[big], app.st.row_count(big), names[map], app.st.row_count(map));
        // вікно в усіх режимах
        app.st.file = Some(map);
        app.st.row = Some(0);
        let mut h = harness(app);
        let frame = |h: &mut Harness<'static, App>, label: &str| {
            h.run();
            let t = Instant::now();
            for _ in 0..3 {
                h.run();
            }
            println!("  кадр «{label}» (усталений, середній): {:.0} мс", t.elapsed().as_secs_f32() * 1000.0 / 3.0);
        };
        frame(&mut h, "таблиця");
        h.state_mut().focus = true;
        frame(&mut h, "редагування");
        h.state_mut().focus = false;
        h.state_mut().scene_mode = true;
        frame(&mut h, "сцена");
        h.state_mut().scene_mode = false;
        let sc = h.state().st.scenes_list(map);
        println!("  сцен у мапі: {}, перша: {:?}", sc.len(), sc.first());
        // пошук, черги, QA
        let t = Instant::now();
        let hits = h.state().st.search_all("the", 8);
        println!("  пошук «the»: {} збігів за {:.0} мс", hits.rows_total, t.elapsed().as_secs_f32() * 1000.0);
        for kind in transly_core::queue::QueueKind::ALL {
            let t = Instant::now();
            let msg = h.state_mut().st.jump_queue(kind, true);
            println!("  перехід «{}»: {msg} ({:.0} мс)", kind.label().1, t.elapsed().as_secs_f32() * 1000.0);
        }
        let t = Instant::now();
        let issues = h.state().st.file_issues(big).len();
        println!("  QA найбільшого файлу: {issues} приміток за {:.0} мс", t.elapsed().as_secs_f32() * 1000.0);
        let t = Instant::now();
        let mine = h.state().st.mine_suggestions();
        println!("  конструкції: {} пропозицій за {:.1} с", mine.len(), t.elapsed().as_secs_f32());
        let cands = h.state().st.plugin_candidates();
        println!("  команд плагінів з текстом: {:?}", cands.iter().take(6).map(|c| (c.name.clone(), c.with_text, c.likely)).collect::<Vec<_>>());
        // назви з гри й нитки на реальному рядку
        let t = Instant::now();
        let mut with_names = 0;
        for r in 0..h.state().st.row_count(map).min(400) {
            if !h.state().st.game_names_in(map, r).is_empty() {
                with_names += 1;
            }
        }
        println!("  назви з гри знайдено у {with_names} з 400 рядків мапи за {:.0} мс", t.elapsed().as_secs_f32() * 1000.0);
        // картинки: герої й предмети
        for f in ["Actors.json", "Items.json", "Enemies.json"] {
            if let Some(fi) = h.state().st.file_names().iter().position(|n| n == f) {
                let n = (0..h.state().st.row_count(fi)).filter(|r| !h.state().st.pics_of(fi, *r).is_empty()).count();
                let with_file = (0..h.state().st.row_count(fi)).filter(|r| h.state().st.pics_of(fi, *r).iter().any(|p| match p {
                    state::Pic::Icon { .. } => h.state().st.game_image("img/system/IconSet.png").is_some(),
                    state::Pic::Face { name, .. } => h.state().st.game_image(&format!("img/faces/{name}.png")).is_some(),
                    state::Pic::Enemy { name, .. } => h.state().st.game_image(&format!("img/enemies/{name}.png")).is_some() || h.state().st.game_image(&format!("img/sv_enemies/{name}.png")).is_some(),
                    state::Pic::Picture { .. } => false,
                })).count();
                println!("  {f}: рядків із картинкою {n}, з них файл знайдено {with_file}");
            }
        }
        // збірка в пам'яті (нічого не пишеться): скільки рядків піде в гру
        let choice = state::BuildChoice { only_approved: false, include_drafts: true, block_errors: false };
        match h.state().st.build_preview(&choice) {
            Ok((a, b, c)) => println!("  збірка (перегляд): у грі {a}, поза збіркою {b}, {c}"),
            Err(e) => println!("  збірка (перегляд): {e}"),
        }
        let rss = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &format!("(Get-Process -Id {}).WorkingSet64", std::process::id())]).output().map(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().unwrap_or(0.0) / 1048576.0).unwrap_or(0.0);
        println!("  підсумок: {:.1} с, пам'ять {rss:.0} МБ", t0.elapsed().as_secs_f32());
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
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.state_mut().draft = "Герой".into();
        h.state_mut().draft_for = Some((0, 0));
        h.run();
        // кнопка «Надіслати» є і в панелі інструментів, і в редакторі
        h.get_all_by_label("Надіслати").last().unwrap().click();
        h.run();
        assert_eq!(h.state().st.progress().sent, 1);
        assert_eq!(h.state().message, "Надіслано");
    }

    /// «Робоче вікно» (`html[data-pane]`): остання панель, куди клацнули; кнопка смужки зліва вмикає своє вікно.
    #[test]
    fn the_working_pane_follows_the_last_click() {
        let data = game("panes");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.run();
        h.run();
        let click = |h: &mut Harness<'static, App>, x: f32, y: f32| {
            let p = pos2(x, y);
            h.input_mut().events.push(egui::Event::PointerMoved(p));
            for pressed in [true, false] {
                h.input_mut().events.push(egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed, modifiers: egui::Modifiers::NONE });
            }
            h.run();
            h.run();
        };
        assert_eq!(h.state().pane, Pane::Centre, "спершу працюємо в центрі");
        click(&mut h, 150.0, 600.0);
        assert_eq!(h.state().pane, Pane::Rows);
        click(&mut h, 1100.0, 600.0);
        assert_eq!(h.state().pane, Pane::Right);
        click(&mut h, 650.0, 600.0);
        assert_eq!(h.state().pane, Pane::Centre);
        // кнопка смужки «Файли гри» вмикає вікно файлів
        h.get_by_label("Панель: Файли гри").click();
        h.run();
        assert_eq!((h.state().rail, h.state().pane), (0, Pane::Files));
    }

    /// Числа з веб-версії (computed style `#b-save`, `.saveb`): кнопка надсилання в редакторі 36×36.
    #[test]
    fn the_send_button_in_the_editor_is_36_by_36_like_the_web_one() {
        let data = game("sendsize");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.state_mut().draft_for = Some((0, 0));
        h.run();
        let r = h.get_all_by_label("Надіслати").last().unwrap().bounding_box().unwrap();
        assert_eq!(((r.x1 - r.x0).round(), (r.y1 - r.y0).round()), (36.0, 36.0), "{r:?}");
    }

    /// Кнопка «Коментувати» в полі обговорення — 36×36 (веб `.cm-bar .saveb`); палітра авторів — шість кольорів `colorOf` з `discuss.ts`.
    #[test]
    fn the_comment_button_is_36_by_36_and_authors_get_the_web_palette() {
        let data = game("cmsize");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        app.st.comment(0, 0, "Привіт");
        let mut h = harness(app);
        h.run();
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.state_mut().right_secs[1][2] = true;
        h.state_mut().draft_for = Some((0, 0));
        h.run();
        let r = h.get_by_label("Коментувати").bounding_box().unwrap();
        assert_eq!(((r.x1 - r.x0).round(), (r.y1 - r.y0).round()), (36.0, 36.0), "{r:?}");
        // значення з веба: colorOf('Ви') = COLORS[hash % 6]; хеш `h = h*31 + код` за модулем 2^32
        let web = |name: &str| -> usize { let mut hsh: u32 = 0; for u in name.encode_utf16() { hsh = hsh.wrapping_mul(31).wrapping_add(u32::from(u)); } hsh as usize % 6 };
        let pal = [(0x7a, 0x62, 0xd8), (0x3d, 0x8b, 0xd9), (0x2f, 0x9e, 0x7f), (0xc0, 0x80, 0x3a), (0xc2, 0x5b, 0x8a), (0x6f, 0x7f, 0x8c)];
        for n in ["Ви", "Хтось", "Artem", "Олена"] {
            let c = layout::who_color(n);
            assert_eq!((c.r(), c.g(), c.b()), pal[web(n)], "{n}");
        }
    }

    /// Ліва панель «Пов’язане» — глосарій: «＋ Додати» відкриває форму, «Скасувати» закриває; чип «Конструкції» лишає лише записи з пропуском.
    #[test]
    fn the_glossary_panel_opens_its_form_and_filters_by_kind() {
        let data = game("glpanel");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.add_term("Hero", "Герой");
        app.st.add_term("take … off", "зняти");
        let mut h = harness(app);
        h.state_mut().rail = 3;
        h.run();
        assert!(h.state().gl_form.is_none());
        h.get_by_label("Додати запис").click();
        h.run();
        assert!(h.state().gl_form.is_some());
        h.get_by_label("Скасувати").click();
        h.run();
        assert!(h.state().gl_form.is_none());
        h.get_by_label("Вид записів: Конструкції").click();
        h.run();
        assert_eq!(h.state().gl_show, 2);
        // картка запису: «Змінити» відкриває форму цього запису
        h.get_by_label("Змінити: take … off").click();
        h.run();
        assert_eq!(h.state().gl_form.as_ref().and_then(|f| f.was.as_deref()), Some("take … off"));
    }

    /// Ширини рядків у egui для порівняння з веб-виміром (`TRANSLY_WIDTHS` — JSON `[[сімейство, розмір, текст], …]`).
    #[test]
    #[ignore]
    fn text_widths() {
        let Ok(cases) = std::env::var("TRANSLY_WIDTHS") else { return };
        let v: serde_json::Value = serde_json::from_str(&cases).unwrap();
        let mut h = harness(App::default());
        h.run();
        for c in v.as_array().unwrap() {
            let (fam, size, text) = (c[0].as_str().unwrap(), c[1].as_f64().unwrap() as f32, c[2].as_str().unwrap());
            let font = match fam { "mono" => mp(size), "w500" => ipw(size, 500), "w600" => ipw(size, 600), _ => ip(size) };
            let w = h.ctx.fonts(|f| f.layout_no_wrap(text.to_string(), font, egui::Color32::WHITE).size().x);
            println!("W {fam} {size} {text:?} {w:.2}");
        }
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
        h.state_mut().checked = (0, [0usize, 1].into_iter().collect());
        h.run();
        h.render().unwrap().save(dir.join("table-checked.png")).unwrap();
        h.state_mut().checked = (0, Default::default());
        h.state_mut().st.submit(0, 0, "Герой").unwrap();
        h.state_mut().st.submit(0, 0, "Воїн").unwrap();
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
        h.state_mut().st.row = Some(1);
        h.state_mut().scene_mode = true;
        h.run();
        h.render().unwrap().save(dir_out.join("scene.png")).unwrap();
        h.state_mut().scene_mode = false;
        {
            let fi = h.state().st.file.unwrap();
            h.state_mut().st.edit(fi, 2, "Привіт? Тут хтось є?");
            h.state_mut().st.row = Some(1);
            h.state_mut().focus = true;
            h.state_mut().rail = 1;
        }
        h.set_size(egui::vec2(1600.0, 900.0));
        h.run();
        h.render().unwrap().save(dir_out.join("edit.png")).unwrap();
        h.state_mut().focus = false;
        h.state_mut().qar_win = true;
        h.state_mut().wrap_win = Some((h.state().st.wrap_settings(), "Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг.".into(), false));
        h.state_mut().groups_win = Some(String::new());
        h.run();
        h.render().unwrap().save(dir.join("windows.png")).unwrap();
    }

    /// Знімок, зроблений так, щоб його можна було накласти на справжній скріншот старого застосунку (1917×1198, «Редагування»).
    #[test]
    #[ignore]
    fn shot_like_reference() {
        let Some(dir_out) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir_out).unwrap();
        let base = std::env::temp_dir().join(format!("transly-ui-ref-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let en = base.join("Fear & Hunger 2 Termina").join("data");
        let ru = base.join("ru").join("data");
        let pl = base.join("pl").join("data");
        for d in [&en, &ru, &pl] {
            std::fs::create_dir_all(d).unwrap();
        }
        let names = ["Caligura [right leg]", "Caligura [left leg]", "Caligura [penis]", "Caligura [torso]", "Platoon [torso]", "Platoon [cannon]", "Platoon [right arm]", "Platoon [left arm]", "Gull bro 1 [torso]", "Gull bro 1 [head]", "Gull bro 1 [right arm]", "Gull bro 1 [torso]", "Ratkin [right arm]", "Cocoon [right arm]", "Marcoh [right arm]", "Daan [right arm]"];
        let mk = |f: &dyn Fn(usize, &str) -> String| format!("[null,{}]", names.iter().enumerate().map(|(i, n)| format!(r#"{{"id":{},"name":"{}","note":"","actions":[],"traits":[]}}"#, i + 1, f(i, n))).collect::<Vec<_>>().join(","));
        std::fs::write(en.join("Enemies.json"), mk(&|_, n| n.to_string())).unwrap();
        std::fs::write(ru.join("Enemies.json"), mk(&|_, n| n.replace("Platoon", "Взвод").replace("right arm", "правая рука"))).unwrap();
        std::fs::write(pl.join("Enemies.json"), mk(&|_, n| n.replace("Platoon", "Pluton").replace("right arm", "prawa ręka"))).unwrap();
        let mut app = App::default();
        app.st.open_game(&en).unwrap();
        app.st.project.as_mut().unwrap().settings.insert("hue".into(), serde_json::json!(48));
        app.st.import_reference(&ru, "ru").unwrap();
        app.st.import_reference(&pl, "pl").unwrap();
        let tr = ["Калігура [права нога]", "Калігура [ліва нога]", "", "Калігура [торс]", "", "Звідня [гармата]", "", "", "", "", "", "", "Щуролюд [права рука]", "Кокон [права рука]", "Марко [права рука]", "Даан [права рука]"];
        for (i, t) in tr.iter().enumerate() {
            if !t.is_empty() {
                app.st.edit(0, i, t);
            }
        }
        app.st.row = Some(6);
        app.focus = true;
        app.rail = 1;
        let mut h = Harness::builder().with_size(egui::vec2(1533.6, 958.4)).with_pixels_per_point(1.25).build_state(|ctx, app: &mut App| {
            theme::apply(ctx);
            app.frame(ctx);
        }, app);
        h.run();
        h.render().unwrap().save(dir_out.join("ref-edit.png")).unwrap();
        // таблиця при масштабі 1,0 (1360×800, як макет у CSS-пікселях)
        h.state_mut().focus = false;
        h.state_mut().rail = 0;
        h.state_mut().st.row = Some(6);
        h.set_size(egui::vec2(1360.0, 800.0));
        h.run();
        h.render().unwrap().save(dir_out.join("ref-table.png")).unwrap();
    }

    /// Знімки для порівняння з веб-версією на спільних даних: `TRANSLY_FIXTURE=<тека з ParityGame і project.json> TRANSLY_SHOTS=<тека> cargo test -p transly-app parity_shots -- --ignored`.
    #[test]
    #[ignore]
    fn parity_shots() {
        let (Some(fix), Some(out)) = (std::env::var_os("TRANSLY_FIXTURE").map(std::path::PathBuf::from), std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from)) else { return };
        std::fs::create_dir_all(&out).unwrap();
        let mut app = App::default();
        app.st.open_game(&fix.join("ParityGame").join("data")).unwrap();
        app.st.open_project_file(&fix.join("project.json")).unwrap();
        let names = app.st.file_names();
        let actors = names.iter().position(|n| n.starts_with("Actors")).unwrap_or(0);
        let enemies = names.iter().position(|n| n.starts_with("Enemies")).unwrap_or(0);
        let map = names.iter().position(|n| n.starts_with("Map001")).unwrap_or(0);
        app.st.file = Some(actors);
        let mut h = Harness::builder().with_size(egui::vec2(1360.0, 800.0)).build_state(|ctx, app: &mut App| {
            theme::apply(ctx);
            app.frame(ctx);
        }, app);
        let shot = |h: &mut Harness<'static, App>, n: &str| {
            h.run();
            h.render().unwrap().save(out.join(format!("{n}.png"))).unwrap();
        };
        shot(&mut h, "01-table-nosel");
        h.state_mut().st.row = Some(1);
        shot(&mut h, "02-table-row");
        h.state_mut().st.file = Some(enemies);
        h.state_mut().st.row = Some(0);
        shot(&mut h, "03-table-enemies");
        h.state_mut().checked = (enemies, [2usize].into_iter().collect());
        shot(&mut h, "04-table-checked");
        h.state_mut().checked = (enemies, Default::default());
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        shot(&mut h, "05-edit");
        h.state_mut().rail = 2;
        shot(&mut h, "06-edit-scenes");
        h.state_mut().rail = 3;
        shot(&mut h, "07-edit-related");
        h.state_mut().right_secs = [[true, false, false]; 2];
        shot(&mut h, "08-right-activity");
        h.state_mut().right_secs = [[false, false, true]; 2];
        shot(&mut h, "09-right-comments");
        // той самий рядок із записами історії й гілкою обговорення (щоб видно було самі стрічки, а не порожні стани)
        {
            let (f, r) = (h.state().st.file.unwrap_or(0), h.state().st.row.unwrap_or(0));
            let st = &mut h.state_mut().st;
            st.edit(f, r, "Селянин, перша версія");
            let _ = st.submit(f, r, "Селянин, друга версія тексту");
            st.comment(f, r, "Чи не краще «Селюк»? Тут говорить грубіший персонаж, тож варто перевірити тон.");
            let root = st.threads(f, r)[0].id.clone();
            st.reply(f, r, &root, "Перевірив: тон підходить, лишаю як є.");
            st.comment(f, r, "Друге питання про рід.");
        }
        h.state_mut().right_secs = [[true, false, false]; 2];
        shot(&mut h, "08b-right-activity-filled");
        h.state_mut().right_secs = [[false, false, true]; 2];
        shot(&mut h, "09b-right-comments-filled");
        // меню: головне (гамбургер), вкладене «Файл» і «Дії» — клік по координатах
        let click_at = |h: &mut Harness<'static, App>, x: f32, y: f32| {
            let p = pos2(x, y);
            for pressed in [true, false] {
                h.input_mut().events.push(egui::Event::PointerMoved(p));
                h.input_mut().events.push(egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed, modifiers: egui::Modifiers::NONE });
            }
            h.run();
            h.run();
        };
        h.state_mut().focus = false;
        h.run();
        click_at(&mut h, 50.0, 20.0);
        shot(&mut h, "13-menu-main");
        click_at(&mut h, 80.0, 62.0);
        shot(&mut h, "14-menu-file");
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        click_at(&mut h, 1304.0, 20.0);
        shot(&mut h, "15-menu-actions");
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        // діалоги: налаштування проєкту, збірка, автозаповнення, гарячі клавіші
        h.state_mut().act_settings();
        shot(&mut h, "16-dlg-settings");
        h.state_mut().settings = None;
        h.state_mut().build_win = Some(h.state().st.build_defaults());
        shot(&mut h, "17-dlg-build");
        h.state_mut().build_win = None;
        let fill = h.state().st.autofill_proposals(500).into_iter().map(|p| (p, true)).collect();
        h.state_mut().fill_win = Some(fill);
        shot(&mut h, "18-dlg-autofill");
        h.state_mut().fill_win = None;
        h.state_mut().keys_win = true;
        shot(&mut h, "19-dlg-keys");
        h.state_mut().keys_win = false;
        // глосарій у лівій панелі (таблиця, значок «Пов’язане») і з відкритою формою
        h.state_mut().focus = false;
        h.run();
        h.state_mut().rail = 3;
        shot(&mut h, "11-glossary");
        h.state_mut().gl_form = Some(glossary_panel::GlForm { qa: true, ..Default::default() });
        shot(&mut h, "12-glossary-form");
        h.state_mut().gl_form = None;
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        h.state_mut().right_secs = [[false, true, false]; 2];
        h.state_mut().focus = false;
        h.state_mut().st.file = Some(map);
        h.state_mut().st.row = Some(1);
        h.state_mut().scene_mode = true;
        h.state_mut().rail = 2;
        shot(&mut h, "10-scene");
    }
}
