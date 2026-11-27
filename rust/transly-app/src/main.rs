//! Transly (нативна версія), етап 3. Вигляд перенесено зі старого інтерфейсу (`mockup/workspace.html`, `app/src/ui/theme.css`):
//! рядок меню, панель інструментів, смуга інструментів, дерево файлів, сітка рядків із вкладкою, хлібними крихтами й фільтрами,
//! інспектор рядка праворуч і рядок стану. Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform`.

// у випуску без чорного вікна консолі
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod glossary_panel;
mod dialog;
mod icons;
mod stshell;
mod layout;
mod links_dialog;
mod plugins;
mod state;
mod theme;
mod winchrome;

use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, FontId, Rect, RichText, Sense, Stroke, StrokeKind};
use state::{AppState, Filter, RowStatus};
use theme::*;
pub(crate) use dialog::{dlg, dlg_footer};

/// Вікно «Оновити за глосарієм»: зміна терміна й рядки (пропозиція, вибрано, вибір форми на кожен проміжок).
type TermSyncWin = (transly_core::termsync::TermChange, Vec<(transly_core::termsync::TermProposal, bool, Vec<i64>)>);

fn main() -> eframe::Result {
    let opts = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 800.0]).with_min_inner_size([1000.0, 600.0]).with_title("Transly").with_decorations(!winchrome::own_chrome_chosen()), ..Default::default() };
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

/// Що відрізняє підрахунок у «Знайти й замінити»: версія змін, запит, заміна, регістр, ціле слово.
type FindKey = (u64, String, String, bool, bool);

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
    gl_mem_asked: bool,
    rows_scroll_to: Option<bool>,
    /// Виділення рядків таблиці протягуванням по номерах і рядок, від якого тягне Shift; куди прокрутити таблицю, поки вказівник біля краю.
    drag_sel: Option<layout::DragSel>,
    sel_last: Option<usize>,
    grid_scroll: Option<f32>,
    /// Для якого (файл, рядок) таблицю вже прокручено так, щоб рядок було видно.
    grid_seen: (usize, Option<usize>),
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
    /// Загальні налаштування («Файл → Налаштування…»): чернетка, що правиться у вікні.
    app_set: Option<state::SettingsView>,
    find_count: Option<(FindKey, usize)>,
    nav_proj: stshell::StNav,
    nav_app: stshell::StNav,
    reset_arm: Option<std::time::Instant>,
    esc_at: Option<std::time::Instant>,
    imp_terms: String,
    imp_tm: String,
    fill_win: Option<Vec<(transly_core::autofill::Proposal, bool)>>,
    links_win: Option<links_dialog::LinksWin>,
    /// Власний заголовок вікна (кнопки в застосунку) чи системний.
    chrome_own: bool,
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
    mine_win: bool,
    /// Слова, додані кнопкою «Додати всі певні» в автословнику: «Скасувати» прибирає саме їх.
    auto_added: Vec<String>,
    /// Рядки, де перекладач вибрав «Лишити так» для підказки узгодженості (до закриття застосунку): (файл, рядок, слово).
    guard_off: std::collections::HashSet<(usize, usize, String)>,
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
    /// Чи відкрита ліва колонка (клік по активній кнопці смужки ховає її) і ширини колонок цього кадру (ліва, права).
    left_open: bool,
    panel_w: (f32, f32),
    /// Останній ввід — клавіша Tab (а не клік): тоді навколо віджета з фокусом малюється кільце, як `:focus-visible` у вебі.
    kb_nav: bool,
    /// Віджет, що мав фокус у попередньому кадрі (щоб помітити зміну фокусу).
    last_focus: Option<egui::Id>,
    /// Гілка, у якій відкрито поле відповіді, і текст відповіді; коментар, що чекає другого кліку «Видалити»; чи розкрито «Розв’язані».
    reply_to: Option<String>,
    reply_text: String,
    del_confirm: Option<String>,
    /// Коментар, що правиться, і його текст у полі.
    cm_editing: Option<String>,
    cm_edit_text: String,
    /// Записи історії, показані проти поточного тексту («Порівняти з поточним»), і для якого рядка.
    hist_cmp: std::collections::HashSet<usize>,
    hist_for: Option<(usize, usize)>,
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
    status: String,
    latest: Option<transly_platform::selfupdate::Latest>,
    rx: Option<std::sync::mpsc::Receiver<UpdMsg>>,
    /// Перевірка при старті вже була; поточна відповідь тиха (без повідомлення, коли нового нема).
    auto_done: bool,
    silent: bool,
}

impl Default for UpdUi {
    fn default() -> Self {
        UpdUi { win: false, repo: transly_platform::selfupdate::update_repo().into(), status: String::new(), latest: None, rx: None, auto_done: false, silent: false }
    }
}

/// Кольори ниток рядка (`--s0…--s5` у вебі).
/// Колір тексту примари (не збереженого, підказаного перекладу).
pub(crate) const GHOST_INK: Color32 = Color32::from_rgb(0x8c, 0x92, 0x9b);
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
        App { st: AppState::default(), last_save: std::time::Instant::now(), draft: String::new(), draft_for: None, message: String::new(), gl_query: String::new(), gl_show: 0, gl_form: None, gl_del: None, gl_mem_asked: false, rows_scroll_to: None, drag_sel: None, sel_last: None, grid_scroll: None, grid_seen: (usize::MAX, None), keys_win: false, rail: 0, run_cfg: 0, tree_closed: Default::default(), scene_mode: false, keep_edit: None, activity_win: false, tsync_win: None, wrap_win: None, qar_win: false, br_win: None, merge_win: None, rename_win: None, groups_win: None, ref_win: None, spk_win: None, import_win: None, build_win: None, app_set: None, find_count: None, nav_proj: stshell::StNav::new("look"), nav_app: stshell::StNav::new("general"), reset_arm: None, esc_at: None, imp_terms: String::new(), imp_tm: String::new(), fill_win: None, links_win: None, chrome_own: winchrome::own_chrome_chosen(), find_win: None, plugins_win: false, sync_win: None, settings: None, btab: 0, bottom_open: false, focus: false, was_edit: 0, pic_tex: Default::default(), plug_win: None, upd: UpdUi::default(), relay_win: None, mine_win: false, auto_added: Vec::new(), guard_off: Default::default(), toast: None, toast_seen: (String::new(), 0), search_win: None, checked: (0, Default::default()), scene_draft: None, cell_edit: None, cell_focus: false, right_secs: [[false, true, false], [false, true, false]], comment: String::new(), pane: Pane::Centre, left_open: true, panel_w: (306.0, 396.0), kb_nav: false, last_focus: None, reply_to: None, reply_text: String::new(), del_confirm: None, cm_editing: None, cm_edit_text: String::new(), hist_cmp: Default::default(), hist_for: None, closed_open: false, token: String::new() }
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
/// Підсвічення вікна, як `.ide` у вебі: еліпс `radii` від `center` (верх вікна), прозорість `.16` у центрі, `.075` на 48 % радіуса, нуль на краю.
/// Вершини непрозорі: колір тла `ground` змішано з `c` у гамма-просторі, як це робить CSS (прозорі вершини різні бекенди змішують по-різному, і світіння
/// виходило втричі яскравішим). Малювати слід одразу над суцільним тлом.
fn glow(painter: &egui::Painter, center: egui::Pos2, radii: egui::Vec2, c: Color32, ground: Color32) {
    use egui::epaint::{Mesh, Vertex, WHITE_UV};
    let mix = |a: f32| {
        let f = |g: u8, t: u8| (g as f32 * (1.0 - a) + t as f32 * a).round() as u8;
        Color32::from_rgb(f(ground.r(), c.r()), f(ground.g(), c.g()), f(ground.b(), c.b()))
    };
    let mut mesh = Mesh::default();
    mesh.vertices.push(Vertex { pos: center, uv: WHITE_UV, color: mix(0.16 * theme::GLOW_GAIN) });
    let n = 64usize;
    // кільця: 48 % радіуса (.075) і край (0); нижня половина еліпса
    for (scale, alpha) in [(0.48_f32, 0.075_f32 * theme::GLOW_GAIN), (1.0, 0.0)] {
        for i in 0..=n {
            let t = std::f32::consts::PI * i as f32 / n as f32;
            mesh.vertices.push(Vertex { pos: pos2(center.x + radii.x * scale * t.cos(), center.y + radii.y * scale * t.sin()), uv: WHITE_UV, color: mix(alpha) });
        }
    }
    for i in 0..n {
        let (a0, a1) = (1 + i as u32, 2 + i as u32);
        mesh.indices.extend([0, a0, a1]);
        let (b0, b1) = (1 + (n as u32 + 1) + i as u32, 2 + (n as u32 + 1) + i as u32);
        mesh.indices.extend([a0, b0, b1, a0, b1, a1]);
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

/// Текст, скорочений з «…» до ширини `max_w` (шрифт верхньої панелі 13), щоб таблетки не виштовхували перемикач режимів.
fn fit_text(ui: &egui::Ui, text: &str, max_w: f32) -> String {
    let width = |s: &str| ui.painter().layout_no_wrap(s.to_string(), ip(13.0), TEXT).size().x;
    if width(text) <= max_w {
        return text.to_string();
    }
    let mut chars: Vec<char> = text.chars().collect();
    while chars.len() > 1 {
        chars.pop();
        let s: String = chars.iter().collect::<String>() + "…";
        if width(&s) <= max_w {
            return s;
        }
    }
    "…".to_string()
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
        ui.painter().rect_filled(rect, CornerRadius::same(8), over_ground_at(rect.center(), 0.07));
    }
    if let Some(letters) = avatar {
        let c = pos2(rect.left() + pad_l + 13.0, rect.center().y);
        theme::set_glow_x(c.x + 60.0); // як `--gx` у вебі: середина аватара + 60
        // піктограма проєкту — закруглений квадрат 26×26 (радіус 8, як кнопки), а не коло
        ui.painter().rect_filled(Rect::from_center_size(c, vec2(26.0, 26.0)), CornerRadius::same(8), accent_solid());
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

/// Те саме, що `pop`, але список вирівняно за правим краєм кнопки й має задану ширину (так у вебі відкривається дзвоник): відступ від кнопки 6.
fn pop_right(ui: &egui::Ui, resp: &egui::Response, id: &str, width: f32, add: impl FnOnce(&mut egui::Ui)) {
    let pid = ui.make_persistent_id(id);
    if resp.clicked() {
        ui.memory_mut(|m| m.toggle_popup(pid));
    }
    if !ui.memory(|m| m.is_popup_open(pid)) {
        return;
    }
    let frame = egui::Frame::popup(ui.style());
    let inner = width - frame.total_margin().sum().x;
    let area = egui::Area::new(pid).kind(egui::UiKind::Popup).order(egui::Order::Foreground).fixed_pos(resp.rect.right_bottom() + vec2(0.0, 6.0)).pivot(Align2::RIGHT_TOP).show(ui.ctx(), |ui| {
        frame.show(ui, |ui| {
            menu_style(ui);
            ui.set_width(inner);
            add(ui);
        });
    });
    // як `CloseOnClick`: клік будь-де, крім самої кнопки (клік по пункту теж закриває список), і Esc
    let _ = area;
    if ui.input(|i| i.key_pressed(egui::Key::Escape)) || resp.clicked_elsewhere() {
        ui.memory_mut(|m| m.close_popup());
    }
}

/// Число на дзвонику (`.bellb b`): праворуч 2, зверху 3, висота 14, заокруглення 7, не вужче 14, відступи 3; колір акценту, а коли є помилка QA — червоний.
fn bell_badge(ui: &egui::Ui, button: Rect, n: usize, bad: bool) {
    let g = ui.painter().layout_no_wrap(n.to_string(), mp(10.0), Color32::WHITE);
    let w = (g.size().x + 6.0).max(14.0);
    let r = Rect::from_min_size(pos2(button.right() - 2.0 - w, button.top() + 3.0), vec2(w, 14.0));
    ui.painter().rect_filled(r, CornerRadius::same(7), if bad { BAD } else { theme::accent_solid() });
    ui.painter().galley(r.center() - g.size() / 2.0, g, Color32::WHITE);
}

/// Заголовок розділу в списку (`.pj-h`): відступи 6 зверху, 2 знизу, 10 ліворуч, 12 пікселів, приглушений.
fn inbox_head(ui: &mut egui::Ui, text: &str) {
    let g = ui.painter().layout_no_wrap(text.to_string(), ip(12.0), MUTE);
    let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 6.0 + g.size().y + 2.0), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, text));
    ui.painter().galley(pos2(r.left() + 10.0, r.top() + 6.0), g, MUTE);
}

/// Пункт списку сповіщень (`.cfgpop button`): відступи 8×10, назва (вага 500) зі значком 16 і приглушений рядок під нею (12 пікселів, міжрядкова 1,35).
fn inbox_item(ui: &mut egui::Ui, icon: Option<&str>, title: &str, sub: &str) -> egui::Response {
    let w = ui.available_width();
    let lead = if icon.is_some() { 16.0 + 8.0 } else { 0.0 };
    let tg = ui.painter().layout(title.to_string(), ipw(13.0, 500), TEXT, w - 20.0 - lead);
    let sg = (!sub.is_empty()).then(|| ui.painter().layout(sub.to_string(), ip(12.0), MUTE, w - 20.0));
    let title_h = tg.size().y.max(16.0);
    let sub_h = sg.as_ref().map_or(0.0, |g| 2.0 + g.size().y.max(12.0 * 1.35));
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 8.0 + title_h + sub_h + 8.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, if sub.is_empty() { title.to_string() } else { format!("{title}: {sub}") }));
    if resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(8), over_color(PANEL, Color32::WHITE, 0.07));
    }
    let top = rect.top() + 8.0;
    if let Some(ic) = icon {
        icons::paint(ui, Rect::from_min_size(pos2(rect.left() + 10.0, top + (title_h - 16.0) / 2.0), vec2(16.0, 16.0)), ic, MUTE);
    }
    ui.painter().galley(pos2(rect.left() + 10.0 + lead, top + (title_h - tg.size().y) / 2.0), tg, TEXT);
    if let Some(g) = sg {
        ui.painter().galley(pos2(rect.left() + 10.0, top + title_h + 2.0), g, MUTE);
    }
    resp
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
    v.widgets.hovered.weak_bg_fill = over_color(PANEL, Color32::WHITE, 0.07);
    v.widgets.hovered.bg_fill = over_color(PANEL, Color32::WHITE, 0.07);
    v.widgets.open.weak_bg_fill = over_color(PANEL, Color32::WHITE, 0.07);
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
        ui.painter().rect_filled(rect, CornerRadius::same(8), over_color(PANEL, Color32::WHITE, 0.07));
    }
    ui.painter().galley(pos2(rect.left() + 12.0, rect.center().y - ng.size().y / 2.0), ng, if enabled { TEXT } else { DIM });
    if !sc.is_empty() {
        ui.painter().galley(pos2(rect.right() - 12.0 - sg.size().x, rect.center().y - sg.size().y / 2.0), sg, MUTE);
    }
    resp
}

/// Сторінка «Небезпечна зона» (спільна для обох вікон налаштувань): попередження й кнопка скидання з підтвердженням другим кліком. Повертає `true`, коли кнопку натиснуто.
fn danger_page(ui: &mut egui::Ui, armed: bool) -> bool {
    stshell::warn_banner(ui, true, "Скинути проєкт", "Видаляє весь переклад, глосарій та імпортовану пам’ять у цьому застосунку. Назва, колір і папка гри лишаються. Відновити неможливо: спершу збережіть проєкт у файл.");
    let label = if armed { "Так, видалити весь переклад" } else { "Скинути проєкт…" };
    let b = ui.add(egui::Button::new(RichText::new(label).color(if armed { Color32::WHITE } else { Color32::from_rgb(0xff, 0x9a, 0xa5) })).fill(if armed { BAD } else { BTN }).stroke(Stroke::new(1.0_f32, theme::over(BG, BAD, 0.60))).min_size(vec2(0.0, 28.0)));
    if armed {
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(300));
    }
    b.clicked()
}

fn label_caps(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text.to_uppercase()).size(10.5).color(MUTE));
}

fn primary_button(ui: &mut egui::Ui, text: &str) -> egui::Response {
    ui.add(egui::Button::new(RichText::new(text).color(Color32::WHITE)).fill(accent_solid()).stroke(Stroke::new(1.0_f32, accent_hover())).min_size(vec2(0.0, 28.0)))
}

fn plain_button(ui: &mut egui::Ui, text: &str) -> egui::Response {
    ui.add(egui::Button::new(text).min_size(vec2(0.0, 28.0)))
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
    /// Відкрито діалог: у вебі тоді жодне вікно не світиться («діалог не змінює робоче вікно, але гасить підсвітку»).
    pub(crate) fn any_dialog(&self) -> bool {
        self.keys_win
            || self.activity_win
            || self.qar_win
            || self.plugins_win
            || self.upd.win
            || self.tsync_win.is_some()
            || self.wrap_win.is_some()
            || self.br_win.is_some()
            || self.merge_win.is_some()
            || self.rename_win.is_some()
            || self.groups_win.is_some()
            || self.ref_win.is_some()
            || self.spk_win.is_some()
            || self.import_win.is_some()
            || self.build_win.is_some()
            || self.fill_win.is_some()
            || self.links_win.is_some()
            || self.find_win.is_some()
            || self.sync_win.is_some()
            || self.settings.is_some()
            || self.app_set.is_some()
            || self.plug_win.is_some()
            || self.relay_win.is_some()
            || self.mine_win
            || self.search_win.is_some()
    }

    /// Вікно «світиться» (вибране в ньому кольору теми): воно робоче й ніякого діалогу відкрито немає.
    pub(crate) fn lit(&self, pane: Pane) -> bool {
        self.pane == pane && !self.any_dialog()
    }

    /// Клавіатурний фокус: кільце кольору теми 2 px навколо віджета, на який перейшли клавішею Tab (`:focus-visible`), і «робоче вікно» за місцем фокусу.
    fn focus_ring(&mut self, ctx: &egui::Context) {
        let tab = ctx.input(|i| i.events.iter().any(|e| matches!(e, egui::Event::Key { key: egui::Key::Tab, pressed: true, .. })));
        if ctx.input(|i| i.pointer.any_pressed()) {
            self.kb_nav = false;
        } else if tab {
            self.kb_nav = true;
        }
        let focused = ctx.memory(|m| m.focused());
        let Some(id) = focused else {
            self.last_focus = None;
            return;
        };
        let Some(resp) = ctx.read_response(id) else { return };
        // робоче вікно: фокус перейшов у панель
        if self.last_focus != Some(id) {
            self.last_focus = Some(id);
            if self.kb_nav {
                let rect_of = |name: &str| ctx.data(|d| d.get_temp::<Rect>(egui::Id::new(name)));
                let c = resp.rect.center();
                if rect_of("pane-left").is_some_and(|r| r.contains(c)) {
                    self.pane = pane_of_rail(self.rail);
                } else if rect_of("pane-right").is_some_and(|r| r.contains(c)) {
                    self.pane = Pane::Right;
                } else if rect_of("pane-centre").is_some_and(|r| r.contains(c)) {
                    self.pane = Pane::Centre;
                }
            }
        }
        // кільце — лише від клавіатури (клік його не вмикає), як `:focus-visible`
        if self.kb_nav {
            ctx.layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::new("focus-ring"))).rect_stroke(resp.rect.expand(1.0), CornerRadius::same(8), Stroke::new(2.0_f32, accent()), egui::StrokeKind::Outside);
        }
    }

    /// Один кадр інтерфейсу (окремо від `eframe`, щоб його можна було ганяти в тестах).
    fn frame(&mut self, ctx: &egui::Context) {
        theme::sync_weights(ctx);
        // ширини колонок цього кадру: закрита колонка не займає місця, і полотно розтягується
        let right_open = self.right_secs[usize::from(self.focus && !self.scene_mode)].iter().any(|b| *b);
        self.panel_w = layout::panel_widths(ctx.screen_rect().width(), self.left_open, right_open);
        ctx.data_mut(|d| d.insert_temp(egui::Id::new("panel-w"), self.panel_w));
        self.focus_ring(ctx);
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
        // підсвічення від значка проєкту (відтінок теми) на всьому тлі: еліпс 520×190 від верху вікна, згасає до нуля, як `.ide` у вебі (merge.css)
        glow(&ctx.layer_painter(egui::LayerId::background()), pos2(theme::glow_center().0, theme::glow_center().1), vec2(theme::GLOW_RADII.0, theme::GLOW_RADII.1), accent(), GROUND);
        self.st.begin_frame();
        self.hotkeys(ctx);
        let title = self.st.project.as_ref().map_or("Transly".to_string(), transly_core::projname::project_title);
        // поки відкрито налаштування проєкту, колір пробується на всьому застосунку одразу; скасували — повертається збережений
        let hue = match &self.settings {
            Some(v) => self.st.settings_preview(v).2,
            None => transly_core::theme::theme_hue(&title, self.st.project.as_ref().and_then(|p| p.settings.get("hue"))),
        };
        if theme::set_hue(hue) {
            theme::apply_style(ctx);
        }
        self.topbar(ctx);
        if self.chrome_own {
            self.window_edges(ctx);
        }
        self.st.remember_row();
        if let Some(after) = self.st.inbox_step(std::time::Duration::from_millis(6)) {
            if after.is_zero() {
                ctx.request_repaint();
            } else {
                ctx.request_repaint_after(after);
            }
        }
        self.statusbar(ctx);
        self.bottom(ctx);
        self.settings_window(ctx);
        self.app_settings_window(ctx);
        self.sync_window(ctx);
        self.relay_window(ctx);
        self.relay_auto();
        self.plug_window(ctx);
        self.update_window(ctx);
        self.plugins_window(ctx);
        self.find_window(ctx);
        self.fill_window(ctx);
        self.links_window(ctx);
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
        if self.left_open {
            if self.focus || self.scene_mode {
                // «Редагування» й «Сцена»: рядки чи сцени ліворуч, редактор посередині
                self.rows_panel(ctx);
            } else {
                self.left_panel(ctx);
            }
        }
        self.right_panel(ctx);
        self.editor(ctx);
        if self.st.take_ghost_more() {
            ctx.request_repaint();
        }
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
        // примара вибраного рядка в таблиці: Tab приймає й веде далі, Enter приймає (поки в жодному полі нема курсора й діалогу нема)
        if self.st.is_open() && self.cell_edit.is_none() && !self.focus && !self.scene_mode && !self.any_dialog() && ctx.memory(|m| m.focused().is_none()) {
            if let Some((f, r)) = self.st.file.zip(self.st.row) {
                if self.st.ghost_of(f, r).is_some() {
                    let tab = ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Tab));
                    let enter = !tab && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter));
                    if tab || enter {
                        self.st.accept_ghost(f, r);
                        self.draft_for = None;
                        self.message = "Примару прийнято (чернетка)".into();
                        if tab {
                            self.st.step_row(1);
                        }
                    }
                }
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
        egui::TopBottomPanel::top("topbar").exact_height(40.0).show_separator_line(false).frame(egui::Frame::new().fill(Color32::TRANSPARENT).inner_margin(egui::Margin::symmetric(6, 0))).show(ctx, |ui| {
            // власний заголовок: смуга перетягування й три кнопки справа; решта панелі не заходить на місце кнопок
            if self.chrome_own {
                if self.any_dialog() {
                    // як у вебі (`html.dlg-open .wdrag`, кнопки вікна над підложкою): поки відкрито діалог, смуга перетягування й кнопки лежать над ним
                    egui::Area::new(egui::Id::new("window-controls-above")).order(egui::Order::Tooltip).fixed_pos(pos2(0.0, 0.0)).interactable(true).show(ctx, |ui| {
                        ui.set_clip_rect(ctx.screen_rect());
                        // область займає всю верхню панель: тільки так шар лежить під вказівником над підложкою діалогу
                        ui.allocate_exact_size(vec2(ctx.screen_rect().width(), 40.0), Sense::hover());
                        self.window_controls(ctx, ui);
                    });
                } else {
                    self.window_controls(ctx, ui);
                }
            }
            let mut inner;
            let ui: &mut egui::Ui = if self.chrome_own {
                let r = ui.max_rect();
                inner = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_max(r.min, pos2(r.right() - winchrome::WCTL_W, r.bottom()))).layout(*ui.layout()));
                &mut inner
            } else {
                ui
            };
            // поля 6 з обох боків: кнопка ≡ стоїть на одній лінії з кнопками лівої смужки (x 6…34), а крайня права — з правою смужкою
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                let can = self.st.is_open();
                // головне меню (логотипа більше немає: перше в рядку; місце меню ще обирається, див. макети верхньої панелі)
                let menu_resp = egui::menu::menu_custom_button(ui, egui::Button::image(icons::image("menu", MUTE, 16.0)).frame(false).min_size(vec2(28.0, 28.0)), |ui| {
                    menu_style(ui);
                    ui.menu_button("Файл", |ui| self.menu_file(ui));
                    ui.menu_button("Перехід", |ui| self.menu_goto(ui));
                    ui.menu_button("Вигляд", |ui| self.menu_view(ui));
                    ui.menu_button("Інструменти", |ui| self.menu_tools(ui));
                });
                menu_resp.response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Головне меню"));
                menu_resp.response.on_hover_text("Головне меню");
                // проєкт
                // усе зліва від перемикача режимів вміщується в межах до нього: довгі назви проєкту й гілки скорочуються
                let budget = (layout::seg_x_at(self.panel_w.0) - 10.0 - ui.cursor().left()).max(60.0);
                let (proj_extra, branch_extra) = (62.0, 54.0);
                let proj_max = if can { ((budget - proj_extra - branch_extra - 4.0) * 0.6).max(30.0) } else { (budget - proj_extra).max(30.0) };
                let name = fit_text(ui, &self.st.project.as_ref().map_or("Transly".to_string(), transly_core::projname::project_title), proj_max);
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
                    let br_budget = (layout::seg_x_at(self.panel_w.0) - 10.0 - ui.cursor().left() - branch_extra).max(30.0);
                    let br = fit_text(ui, &self.st.current_branch(), br_budget);
                    let resp = pill(ui, None, Some("branch"), &br, true, false);
                    if resp.clicked() {
                        self.br_win = Some(String::new());
                    }
                }
                // перемикач режимів: прикріплений до лівого верхнього кута полотна (x = межа полотна + 6), без рамки; усе інше підлаштовується під нього
                ui.add_space((layout::seg_x_at(self.panel_w.0) - ui.cursor().left()).max(4.0));
                {
                    let modes = [("table", "Таблиця: усі рядки файлу", !self.focus && !self.scene_mode), ("edit", "Редагування: один рядок", self.focus && !self.scene_mode), ("scene", "Сцена: репліки подій поспіль", self.scene_mode)];
                    ui.spacing_mut().item_spacing.x = 6.0;
                    for (i, (ic, tip, on)) in modes.into_iter().enumerate() {
                        let (r, _) = ui.allocate_exact_size(vec2(28.0, 28.0), Sense::hover());
                        let resp = layout::rail_button(ui, r, ui.id().with(("seg", i)), ic, on && can, self.lit(Pane::Centre), can);
                        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, can, tip));
                        if resp.on_hover_text(tip).clicked() {
                            self.focus = i == 1;
                            self.scene_mode = i == 2;
                            self.pane = Pane::Centre;
                        }
                    }
                    ui.spacing_mut().item_spacing.x = 4.0;
                }
                ui.add_space(10.0);
                if can {
                    let p = self.st.progress();
                    let pc = |n: usize| (n * 100).checked_div(p.total).unwrap_or(0);
                    let sw = ctx.screen_rect().width();
                    // у вузькому вікні прогрес поступається: спершу текст стискається до відсотка, потім шкала коротшає (перемикач режимів — ніколи)
                    let (r, _) = ui.allocate_exact_size(vec2(if sw > 1180.0 { 120.0 } else if sw > 1050.0 { 100.0 } else { 70.0 }, 5.0), Sense::hover());
                    ui.painter().rect_filled(r, CornerRadius::same(R1), TRACK);
                    let mut x = r.left();
                    for (n, col) in [(p.approved, OK), (p.sent, INFO), (p.draft, WARN)] {
                        let w = if p.total > 0 { r.width() * n as f32 / p.total as f32 } else { 0.0 };
                        ui.painter().rect_filled(Rect::from_min_size(pos2(x, r.top()), vec2(w, 5.0)), CornerRadius::ZERO, col);
                        x += w;
                    }
                    let done = p.draft + p.sent + p.approved;
                    let full = format!("Перекладено {}% ({} з {}) · надіслано {}% · вичитано {}%", pc(done), fmt_n(done), fmt_n(p.total), pc(p.sent), pc(p.approved));
                    if sw > 1180.0 {
                        ui.label(RichText::new(full).monospace().size(10.0).color(MUTE));
                    } else if sw > 1050.0 {
                        ui.label(RichText::new(format!("{}%", pc(done))).monospace().size(10.0).color(MUTE)).on_hover_text(full);
                    } else {
                        ui.add(egui::Label::new("").sense(Sense::hover())).on_hover_text(full);
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    if icons::button(ui, "keys", "Гарячі клавіші", false, MUTE).clicked() {
                        self.keys_win = !self.keys_win;
                    }
                    let resp = icons::button(ui, "menu", "Дії: масові дії, скасування, автозаповнення, пошук і заміна", false, MUTE);
                    pop(ui, &resp, "actpop", |ui| self.menu_actions(ui));
                    // сповіщення: як у старому дзвоник між «Запустити» і «Дії», з числом пунктів
                    let bell = icons::button(ui, "bell", "Сповіщення: що потребує уваги й що змінили інші", false, MUTE);
                    let (count, bad) = self.st.inbox.badge();
                    if count > 0 {
                        bell_badge(ui, bell.rect, count, bad);
                    }
                    pop_right(ui, &bell, "inboxpop", 340.0, |ui| self.inbox_menu(ui));
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
            if mi(ui, "Налаштування…", self.st.is_open()).clicked() {
                self.app_set = self.st.settings_view();
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
                self.st.switch_file(hits.files[p].0);
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
        if !self.mine_win {
            return;
        }
        let (list, running) = self.st.mine_cards();
        if running {
            ctx.request_repaint_after(std::time::Duration::from_millis(150));
        }
        let mut open = true;
        let mut add: Option<usize> = None;
        let mut show: Option<usize> = None;
        let mut no: Option<usize> = None;
        let shown: Vec<&transly_core::mine::ConstructionSuggestion> = list.iter().filter(|x| !self.st.is_dismissed("mine", &x.en)).collect();
        dlg("Конструкції").open(&mut open).collapsible(false).default_width(560.0).default_height(460.0).show(ctx, |ui| {
            if shown.is_empty() {
                ui.add_space(8.0);
                ui.label(RichText::new(if running { "Шукаю конструкції…" } else { "Нових конструкцій не знайдено: або їх немає, або всі вже в глосарії." }).color(MUTE));
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
        } else if let Some(i) = show {
            let x = shown[i].clone();
            let rows: Vec<transly_core::groups::RowRef> = x.rows.iter().map(|r| transly_core::groups::RowRef { file: r.file.clone(), key: r.key.clone() }).collect();
            self.message = self.st.show_rows(&format!("«{}»: так уже перекладено", x.en), &rows);
            self.draft_for = None;
            self.cell_edit = None;
        } else if let Some(i) = no {
            let en = shown[i].en.clone();
            self.st.dismiss("mine", &en);
        }
        if !open {
            self.mine_win = false;
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
            menu_sep(ui);
            if mi(ui, if self.chrome_own { "Системний заголовок вікна" } else { "Власний заголовок вікна" }, true).on_hover_text("Смуга з кнопками «Згорнути», «Розгорнути» і «Закрити»: своя в застосунку чи системна від Windows").clicked() {
                let ctx = ui.ctx().clone();
                self.toggle_chrome(&ctx);
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
                self.mine_win = true;
                ui.close_menu();
            }
            if mi(ui, if self.st.syncing() { "Синхронізація триває…" } else { "Синхронізація через реле…" }, self.st.is_open()).clicked() {
                self.relay_win = Some(self.st.relay.clone());
                ui.close_menu();
            }
            if mi(ui, "Оновлення…", true).clicked() {
                self.upd.win = true;
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

    /// Список сповіщень (`#inboxpop`): «Потребує уваги», «Нове від інших» і «Позначити нове прочитаним»; порожній — «Усе гаразд». Клік по пункту показує його рядки.
    fn inbox_menu(&mut self, ui: &mut egui::Ui) {
        use transly_core::inbox::InboxKind;
        let items = self.st.inbox.items.clone();
        if items.is_empty() {
            inbox_head(ui, "Усе гаразд");
            let g = ui.painter().layout("Немає помилок QA, чернеток і рядків на вичитку, нових змін від інших теж.".to_string(), ip(13.0), MUTE, ui.available_width() - 24.0);
            let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), g.size().y + 14.0), Sense::hover());
            ui.painter().galley(pos2(r.left() + 12.0, r.top() + 4.0), g, MUTE);
            return;
        }
        let (state, news): (Vec<_>, Vec<_>) = items.iter().partition(|i| !i.news);
        let mut open: Option<&transly_core::inbox::InboxItem> = None;
        let mut read = false;
        let icon = |k: InboxKind| match k {
            InboxKind::Error => "warn",
            InboxKind::Draft => "pencil",
            InboxKind::Unreviewed => "check",
            InboxKind::Source => "refresh",
            InboxKind::Replies => "cmt",
            InboxKind::Others => "person",
        };
        if !state.is_empty() {
            inbox_head(ui, "Потребує уваги");
            for i in &state {
                if inbox_item(ui, Some(icon(i.kind)), &i.title, &i.sub).clicked() {
                    open = Some(i);
                }
            }
        }
        if !news.is_empty() {
            if !state.is_empty() {
                menu_sep(ui);
            }
            inbox_head(ui, "Нове від інших");
            for i in &news {
                if inbox_item(ui, Some(icon(i.kind)), &i.title, &i.sub).clicked() {
                    open = Some(i);
                }
            }
            menu_sep(ui);
            if inbox_item(ui, None, "Позначити нове прочитаним", "").clicked() {
                read = true;
            }
        }
        if read || open.is_some() {
            // і мишею, і з клавіатури пункт закриває список
            ui.memory_mut(|m| m.close_popup());
        }
        if read {
            self.st.inbox_mark_read();
        } else if let Some(i) = open {
            self.message = self.st.show_rows(&i.title, &i.rows);
            self.draft_for = None;
            self.cell_edit = None;
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
                    // знайдено нову збірку — одна кнопка: завантажити, підмінити файл і запустити знову
                    if self.upd.latest.as_ref().is_some_and(|l| l.newer && l.asset.is_some()) {
                        let busy = self.upd.rx.is_some();
                        let g = ui.painter().layout_no_wrap(if busy { "Оновлюю…".to_string() } else { "Є нова версія · Оновити".to_string() }, ip(11.5), Color32::WHITE);
                        let (r, resp) = ui.allocate_exact_size(vec2(g.size().x + 20.0, 20.0), Sense::click());
                        ui.painter().rect_filled(r, CornerRadius::same(8), if busy { over_color(BG, accent(), 0.5) } else if resp.hovered() { accent_hover() } else { accent_solid() });
                        ui.painter().galley(pos2(r.left() + 10.0, r.center().y - g.size().y / 2.0), g, Color32::WHITE);
                        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, !busy, "Оновити застосунок"));
                        if resp.on_hover_text("Завантажити нову збірку, замінити файл і запустити застосунок знову (проєкт буде збережено)").clicked() && !busy {
                            self.update_download();
                        }
                    }
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

    /// Дерево сторінок «Налаштувань проєкту»: усе, що стосується самого проєкту (воно лежить у `project.json`). Загальні налаштування — окреме вікно, сторінки не повторюються.
    const PROJECT_PAGES: &'static [stshell::Group] = &[
        ("Проєкт", &[("look", "Назва й вигляд", "palette"), ("branches", "Гілки", "branch"), ("folder", "Папка гри", "files"), ("file", "Файл", "file")]),
        ("Переклад", &[("lang", "Мови", "globe"), ("links", "Однакові рядки", "link")]),
        ("Перевірка", &[("qa", "Правила QA", "check-sq"), ("wrap", "Перенесення рядків", "wrap")]),
        ("Глосарій і пам’ять", &[("terms", "Імпорт глосарію", "book"), ("tm", "Імпорт пам’яті перекладів", "db")]),
        ("Підключення", &[("github", "GitHub", "cloud")]),
        ("Обережно", &[("danger", "Небезпечна зона", "warn")]),
    ];

    /// Дерево сторінок «Налаштувань»: те, що стосується застосунку й вас, а не окремого проєкту.
    const APP_PAGES: &'static [stshell::Group] = &[
        ("Застосунок", &[("general", "Загальні", "sliders"), ("look", "Вигляд", "scene"), ("update", "Оновлення застосунку", "refresh")]),
        ("Синхронізація", &[("server", "Власний сервер", "server")]),
    ];

    /// Записує в проєкт усе, що правиться в «Налаштуваннях проєкту» (вигляд, мови, перевірка, однакові рядки); «Ваше ім'я» належить загальним налаштуванням.
    fn apply_project(&mut self, v: &state::SettingsView) {
        if let Some(mut base) = self.st.settings_view() {
            base.name_from = v.name_from.clone();
            base.title = v.title.clone();
            base.icon_text = v.icon_text.clone();
            base.hue = v.hue;
            base.tolerance_pct = v.tolerance_pct;
            base.block_errors = v.block_errors;
            base.link_mode = v.link_mode.clone();
            base.source_lang = v.source_lang.clone();
            base.target_lang = v.target_lang.clone();
            base.line_limit = v.line_limit;
            self.st.apply_settings(&base);
        }
    }

    /// Записує лише «Загальні» налаштування (ваше ім'я в коментарях та історії).
    fn apply_general(&mut self, v: &state::SettingsView) {
        if let Some(mut base) = self.st.settings_view() {
            base.who = v.who.clone();
            self.st.apply_settings(&base);
        }
    }

    /// Кнопки сторінок налаштувань, що відкривають окремі вікна й дії (одне місце для обох вікон налаштувань).
    fn settings_go(&mut self, g: &str) {
        match g {
            "project" => self.settings = self.st.settings_view(),
            "folder" => self.open_dialog(),
            "plug" => {
                let (names, asked) = self.st.plugin_choice();
                let mut chosen: std::collections::BTreeSet<String> = names.into_iter().collect();
                if !asked {
                    chosen.extend(self.st.plugin_candidates().into_iter().filter(|c| c.likely).map(|c| c.name));
                }
                self.plug_win = Some(chosen);
            }
            "spk" => self.spk_win = Some(self.st.speaker_candidates()),
            "ref" => self.ref_win = Some(String::new()),
            "qa" => self.qar_win = true,
            "wrap" => self.wrap_win = Some((self.st.wrap_settings(), "Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.".into(), false)),
            "github" => self.act_sync(),
            "relay" => self.relay_win = Some(self.st.relay.clone()),
            "branches" => self.br_win = Some(String::new()),
            "save" => self.message = self.st.save_project().map(|p| format!("Збережено: {p}")).unwrap_or_else(|e| e),
            "open" => {
                if let Some(p) = rfd::FileDialog::new().add_filter("Проєкт Transly", &["json"]).pick_file() {
                    self.message = self.st.open_project_file(&p).unwrap_or_else(|e| e);
                    self.draft_for = None;
                }
            }
            _ => self.upd.win = true,
        }
    }

    /// Підтвердження «Скинути проєкт»: перший клік зводить кнопку, другий (не раніше ніж за 1,2 с і не пізніше ніж за 6 с) скидає (`armed` у `project-settings.ts`).
    fn reset_clicked(&mut self) {
        let now = std::time::Instant::now();
        match self.reset_arm {
            Some(t) if now.duration_since(t).as_millis() >= 1200 && now.duration_since(t).as_secs() < 6 => {
                self.reset_arm = None;
                self.settings = None;
                self.app_set = None;
                self.message = self.st.reset_project().unwrap_or_else(|e| e);
                self.draft_for = None;
            }
            Some(t) if now.duration_since(t).as_secs() < 6 => {}
            _ => self.reset_arm = Some(now),
        }
    }

    /// «Налаштування проєкту»: вікно `.st-dlg` зі сторінками «Назва й вигляд», «Гілки», «Папка гри», «GitHub», «Мови», «Небезпечна зона»; «Зберегти / Застосувати / Скасувати».
    fn settings_window(&mut self, ctx: &egui::Context) {
        let Some(mut v) = self.settings.clone() else { return };
        let saved = self.st.settings_view();
        let dirty = saved.as_ref().is_some_and(|s| s.project_differs(&v));
        let (title, letters, hue) = self.st.settings_preview(&v);
        let auto_letters = self.st.settings_preview(&state::SettingsView { icon_text: String::new(), ..v.clone() }).1;
        let branches: Vec<(String, usize, bool, String)> = self.st.branches_view().into_iter().map(|(n, r, c)| { let from = self.st.branch_from(&n); (n, r, c, from) }).collect();
        let folder = self.st.dir.as_ref().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
        let refs = self.st.reference_langs();
        let mut nav = std::mem::replace(&mut self.nav_proj, stshell::StNav::new("look"));
        let (mut apply, mut save, mut cancel) = (false, false, false);
        let mut branch_act: Option<(String, u8)> = None;
        let mut new_branch = false;
        let mut go: Option<&'static str> = None;
        let (mut import_terms, mut import_tm) = (false, false);
        let (mut imp_terms, mut imp_tm) = (std::mem::take(&mut self.imp_terms), std::mem::take(&mut self.imp_tm));
        let mut reset_click = false;
        let armed = self.reset_arm.is_some_and(|t| t.elapsed().as_secs() < 6);
        let esc_armed = self.esc_at.is_some_and(|t| t.elapsed().as_secs() < 4);
        let esc = stshell::StShell { key: "project", aria: "Налаштування проєкту", crumb: title.clone(), height: 700.0, groups: Self::PROJECT_PAGES, search: true, dirty, esc_armed }.show(
            ctx,
            &mut nav,
            |ui, page| match page {
                "look" => {
                    // «Так проєкт виглядає в шапці й у меню»: картка 12×14 з рамкою, значок 40, назва 15/600
                    let w = ui.available_width();
                    let tg = ui.painter().layout_no_wrap(title.clone(), ipw(15.0, 600), TEXT);
                    let sg = ui.painter().layout_no_wrap("Так проєкт виглядає в шапці й у меню".to_string(), ip(12.0), MUTE);
                    let (card, cresp) = ui.allocate_exact_size(vec2(w, 12.0 + 40.0 + 12.0 + 2.0), Sense::hover());
                    cresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, format!("Проєкт: {title}")));
                    ui.painter().rect(card, CornerRadius::same(10), BG, Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                    let av = Rect::from_min_size(pos2(card.left() + 15.0, card.top() + 13.0), vec2(40.0, 40.0));
                    ui.painter().rect_filled(av, CornerRadius::same(8), accent_solid());
                    ui.painter().text(av.center(), Align2::CENTER_CENTER, &letters, mp(if letters.chars().count() > 1 { 14.0 } else { 16.0 }), Color32::WHITE);
                    let tx = av.right() + 12.0;
                    let th = tg.size().y + sg.size().y;
                    let ty = card.center().y - th / 2.0;
                    ui.painter().with_clip_rect(Rect::from_min_max(pos2(tx, card.top()), pos2(card.right() - 14.0, card.bottom()))).galley(pos2(tx, ty), tg.clone(), TEXT);
                    ui.painter().galley(pos2(tx, ty + tg.size().y), sg, MUTE);
                    ui.add_space(10.0);
                    stshell::sub(ui, "Назва проєкту", false, |ui| {
                        ui.spacing_mut().item_spacing.y = 6.0;
                        let (fname, gname) = (v.folder_name.clone(), v.game_title.clone());
                        let sample = |text: &str, none: &str| if text.is_empty() { RichText::new(none) } else { RichText::new(text) };
                        stshell::radio(ui, &mut v.name_from, "folder", "З папки гри", Some(sample(&fname, "папку ще не обрано")), !fname.is_empty());
                        stshell::radio(ui, &mut v.name_from, "game", "З назви в грі", Some(sample(&gname, "гра не називає себе")), !gname.is_empty());
                        ui.horizontal(|ui| {
                            stshell::radio(ui, &mut v.name_from, "custom", "Своя назва", None, true);
                            let r = stshell::input(ui, &mut v.title, "наприклад, Покинута хатина", ui.available_width());
                            r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::TextEdit, true, "Назва, написана вручну"));
                            if r.changed() && !v.title.trim().is_empty() {
                                v.name_from = "custom".into();
                            }
                        });
                        stshell::hint(ui, "Назва лише підпис: переклад, злиття й синхронізація від неї не залежать, тож її можна міняти будь-коли.");
                    });
                    stshell::sub(ui, "Значок і колір", true, |ui| {
                        stshell::grid_row(ui, "Літери значка (1–2)", |ui| {
                            let mut t = v.icon_text.clone();
                            let r = stshell::input(ui, &mut t, "", ui.available_width());
                            v.icon_text = t.chars().take(2).collect();
                            r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::TextEdit, true, "Літери значка"));
                        });
                        stshell::hint(ui, &if v.icon_text.trim().is_empty() { format!("Порожньо: перші літери назви ({auto_letters}).") } else { "Свої літери: вони не залежать від назви.".to_string() });
                        stshell::grid_row(ui, "Колір акценту", |ui| {
                            let mut h = hue as f32;
                            let sl = stshell::hue_slider(ui, &mut h);
                            sl.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Slider, true, "Колір акценту"));
                            if sl.changed() {
                                v.hue = Some(h.round() as u32);
                            }
                        });
                        ui.horizontal(|ui| {
                            let (sw, _) = ui.allocate_exact_size(vec2(16.0, 16.0), Sense::hover());
                            ui.painter().circle_filled(sw.center(), 8.0, accent());
                            ui.label(RichText::new(if v.hue.is_none() { format!("Колір береться з назви проєкту: {hue}°") } else { format!("Обрано вручну: {hue}°") }).size(12.0).color(MUTE));
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if ui.add_enabled(v.hue.is_some(), egui::Button::new("Як за назвою").min_size(vec2(0.0, 28.0))).clicked() {
                                    v.hue = None;
                                }
                            });
                        });
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 8.0;
                            for preset in [185u32, 215, 245, 275, 305, 335] {
                                let tk = transly_core::theme::theme_tokens(preset);
                                let c = tk.get("--accent").map_or(accent(), |hx| u32::from_str_radix(hx.trim_start_matches('#'), 16).map_or(accent(), |n| Color32::from_rgb((n >> 16) as u8, (n >> 8) as u8, n as u8)));
                                let (r, resp) = ui.allocate_exact_size(vec2(26.0, 26.0), Sense::click());
                                resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, preset == hue, format!("Відтінок {preset}°")));
                                ui.painter().circle_filled(r.center(), 13.0, c);
                                if preset == hue {
                                    ui.painter().circle_stroke(r.center(), 12.0, Stroke::new(2.0_f32, TEXT));
                                }
                                if resp.clicked() {
                                    v.hue = Some(preset);
                                }
                            }
                        });
                        stshell::hint(ui, "Колір береться з холодної частини кола, щоб його не сплутати зі статусами. Він міняється в усьому застосунку одразу і лишається, коли ви збережете.");
                    });
                }
                "branches" => {
                    // таблиця «Гілка / Від / Рядків / Дії» (`.pjs-brt`): рядки 36 заввишки з лінією знизу, поточна підсвічена
                    let w = ui.available_width();
                    let cols = [w * 0.30, w * 0.18, w * 0.16, w * 0.36];
                    let (hr, _) = ui.allocate_exact_size(vec2(w, 32.0), Sense::hover());
                    let mut x = hr.left() + 10.0;
                    for (i, t) in ["Гілка", "Від", "Рядків", ""].into_iter().enumerate() {
                        ui.painter().text(pos2(x, hr.center().y), Align2::LEFT_CENTER, t, ip(12.0), MUTE);
                        x += cols[i];
                    }
                    ui.painter().hline(hr.x_range(), hr.bottom() - 0.5, Stroke::new(1.0_f32, LINE));
                    ui.spacing_mut().item_spacing.y = 0.0;
                    for (n, rows, cur, from) in &branches {
                        let (r, _) = ui.allocate_exact_size(vec2(w, 40.0), Sense::hover());
                        if *cur {
                            ui.painter().rect_filled(r, CornerRadius::ZERO, theme::over(BG, accent(), 0.12));
                        }
                        ui.painter().hline(r.x_range(), r.bottom() - 0.5, Stroke::new(1.0_f32, LINE));
                        let mut x = r.left() + 10.0;
                        icons::paint(ui, Rect::from_center_size(pos2(x + 8.0, r.center().y), vec2(16.0, 16.0)), "branch", MUTE);
                        ui.painter().text(pos2(x + 24.0, r.center().y), Align2::LEFT_CENTER, n, ipw(13.0, 500), TEXT);
                        x += cols[0];
                        ui.painter().text(pos2(x, r.center().y), Align2::LEFT_CENTER, from, ip(13.0), TEXT);
                        x += cols[1];
                        ui.painter().text(pos2(x, r.center().y), Align2::LEFT_CENTER, format!("{rows} {}", transly_core::plural::plural_form(*rows as i64, ["рядок", "рядки", "рядків"])), ip(13.0), TEXT);
                        // дії праворуч: «поточна ✓» або «Перемкнути», «Перейменувати…», «Видалити»
                        let mut ui2 = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_max(pos2(r.right() - cols[3], r.top()), pos2(r.right() - 10.0, r.bottom()))).layout(egui::Layout::right_to_left(egui::Align::Center)));
                        ui2.spacing_mut().item_spacing.x = 6.0;
                        if n != "main" && !*cur && ui2.add(egui::Button::new("Видалити").min_size(vec2(0.0, 24.0))).clicked() {
                            branch_act = Some((n.clone(), 2));
                        }
                        if n != "main" && ui2.add(egui::Button::new("Перейменувати…").min_size(vec2(0.0, 24.0))).clicked() {
                            branch_act = Some((n.clone(), 3));
                        }
                        if *cur {
                            ui2.label(RichText::new("поточна ✓").size(12.0).color(OK));
                        } else if ui2.add(egui::Button::new("Перемкнути").min_size(vec2(0.0, 24.0))).clicked() {
                            branch_act = Some((n.clone(), 0));
                        }
                    }
                    ui.add_space(16.0);
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "+ Нова гілка…").clicked() {
                            new_branch = true;
                        }
                        if ui.add_enabled(branches.len() > 1, egui::Button::new("Злити гілку…").min_size(vec2(0.0, 28.0))).clicked() {
                            go = Some("branches");
                        }
                    });
                }
                "folder" => {
                    ui.label(RichText::new("Папка гри цього проєкту").size(12.5).color(TEXT));
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        let w = ui.available_width() - 8.0 - 90.0;
                        let (r, _) = ui.allocate_exact_size(vec2(w.max(120.0), 30.0), Sense::hover());
                        ui.painter().rect(r, CornerRadius::same(R2), theme::over(BG, Color32::WHITE, 0.03), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                        ui.painter().with_clip_rect(r.shrink2(vec2(10.0, 0.0))).text(pos2(r.left() + 10.0, r.center().y), Align2::LEFT_CENTER, &folder, ip(12.5), TEXT);
                        if plain_button(ui, "Змінити…").clicked() {
                            go = Some("folder");
                        }
                    });
                    stshell::hint(ui, "Папка запам’ятовується для проєкту й відновлюється під час запуску. Її назва стає назвою проєкту, поки ви не оберете іншу.");
                }
                "file" => {
                    stshell::hint(ui, "Проєкт зберігається поруч із грою. Файл проєкту можна передати на інший пристрій або відкрити з нього.");
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Зберегти проєкт у файл").clicked() {
                            go = Some("save");
                        }
                        if plain_button(ui, "Імпортувати з файлу…").clicked() {
                            go = Some("open");
                        }
                    });
                }
                "lang" => {
                    stshell::sub(ui, "Мови гри", false, |ui| {
                        stshell::grid_row(ui, "Мова оригіналу", |ui| {
                            let w = ui.available_width();
                            stshell::input(ui, &mut v.source_lang, "", w);
                        });
                        stshell::grid_row(ui, "Мова перекладу", |ui| {
                            let w = ui.available_width();
                            stshell::input(ui, &mut v.target_lang, "", w);
                        });
                    });
                    stshell::sub(ui, "Тексти плагінів", false, |ui| {
                        stshell::hint(ui, "Частина ігор показує текст командами плагінів, а не вікнами повідомлень.");
                        stshell::acts(ui, |ui| {
                            if plain_button(ui, "Обрати команди з текстом…").clicked() {
                                go = Some("plug");
                            }
                        });
                    });
                    stshell::sub(ui, "Мовці", false, |ui| {
                        stshell::hint(ui, "Імен мовців у грі на RPG Maker MV немає. Їх можна визначити за обличчям персонажа й подією.");
                        stshell::acts(ui, |ui| {
                            if plain_button(ui, "Визначити мовців…").clicked() {
                                go = Some("spk");
                            }
                        });
                    });
                    stshell::sub(ui, "Довідкові мови", true, |ui| {
                        stshell::hint(ui, "Додайте ту саму гру іншими мовами (наприклад, російською, польською): кожна з’явиться під оригіналом як підказка. Мов можна додати скільки завгодно. Рядки вирівнюються автоматично, навіть якщо в тій версії є додані чи прибрані репліки.");
                        ui.label(RichText::new(if refs.is_empty() { "Довідок ще немає".to_string() } else { refs.join(", ").to_uppercase() }).size(12.0).color(MUTE));
                        stshell::acts(ui, |ui| {
                            if plain_button(ui, "Додати мову: обрати папку довідкової версії…").clicked() {
                                go = Some("ref");
                            }
                        });
                    });
                }
                "links" => {
                    stshell::grid_row(ui, "Автозаповнення однакових рядків після «Надіслати»", |ui| {
                        let name = |m: &str| match m {
                            "auto" => "заповнювати порожні й самому оновлювати різні (вичитані не чіпає)",
                            "off" => "не заповнювати",
                            _ => "заповнювати порожні чернетками, про різні питати (рекомендовано)",
                        };
                        egui::ComboBox::from_id_salt("link-mode").width(ui.available_width() - 8.0).wrap_mode(egui::TextWrapMode::Truncate).selected_text(name(&v.link_mode)).show_ui(ui, |ui| {
                            for m in ["ask", "auto", "off"] {
                                ui.selectable_value(&mut v.link_mode, m.to_string(), name(m));
                            }
                        });
                    });
                    stshell::hint(ui, "Порожні зв’язані рядки заповнюються одразу після надсилання чернетками з позначкою «авто» (цю дію можна відмінити в повідомленні). Вичитаний рядок і рядок, який ви змінили пізніше, не перезаписуються без вашого вибору.");
                }
                "qa" => {
                    stshell::grid_row(ui, "Радити, коли переклад відрізняється від оригіналу понад, % (від 5 до 100)", |ui| {
                        let w = ui.available_width();
                        let r = stshell::number(ui, egui::DragValue::new(&mut v.tolerance_pct).range(5.0..=100.0).speed(5.0), w);
                        r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::DragValue, true, "Допуск довжини, %"));
                    });
                    stshell::grid_row(ui, "Найдовший рядок (0 — без межі)", |ui| {
                        let w = ui.available_width();
                        stshell::number(ui, egui::DragValue::new(&mut v.line_limit).range(0.0..=500.0), w);
                    });
                    stshell::check(ui, &mut v.block_errors, "Не надсилати рядок із помилкою QA");
                    stshell::grid_row(ui, "Правила перевірки тексту (літери, пробіли, апостроф, коди)", |ui| {
                        if plain_button(ui, "Налаштувати…").clicked() {
                            go = Some("qa");
                        }
                    });
                    stshell::hint(ui, "Які перевірки ввімкнено й що вони вважають помилкою чи порадою. Довжина тексту не обмежується: застосунок лише радить.");
                }
                "wrap" => {
                    stshell::grid_row(ui, "Перенесення рядків у повідомленнях гри", |ui| {
                        if plain_button(ui, "Налаштувати…").clicked() {
                            go = Some("wrap");
                        }
                    });
                    stshell::hint(ui, "Коли й за якою шириною рядки розбиваються, чи переносяться слова з дефісом, коли попереджати про четвертий рядок.");
                }
                "terms" => {
                    stshell::hint(ui, "З файлу: таблиця Google Sheets, збережена як веб-сторінка (.html), або .csv / .tsv із колонками «Оригінал», «Переклад 1…», «Опис», «Розділ».");
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Імпортувати з файлу…").clicked() {
                            if let Some(p) = rfd::FileDialog::new().add_filter("Текст і таблиці", &["txt", "tsv", "csv", "html", "htm"]).pick_file() {
                                imp_terms = std::fs::read_to_string(p).unwrap_or_default();
                                import_terms = !imp_terms.trim().is_empty();
                            }
                        }
                    });
                    stshell::hint(ui, "Або вставте рядки «англійською, табуляція, українською»:");
                    ui.add(egui::TextEdit::multiline(&mut imp_terms).desired_rows(4).desired_width(ui.available_width()));
                    stshell::acts(ui, |ui| {
                        if ui.add_enabled(!imp_terms.trim().is_empty(), egui::Button::new("Імпортувати вставлені терміни").min_size(vec2(0.0, 28.0))).clicked() {
                            import_terms = true;
                        }
                    });
                }
                "tm" => {
                    stshell::hint(ui, "Рядки «оригінал, табуляція, переклад».");
                    ui.add(egui::TextEdit::multiline(&mut imp_tm).desired_rows(7).desired_width(ui.available_width()));
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Завантажити з файлу…").clicked() {
                            if let Some(p) = rfd::FileDialog::new().add_filter("Текст і таблиці", &["txt", "tsv", "csv"]).pick_file() {
                                imp_tm = std::fs::read_to_string(p).unwrap_or_default();
                            }
                        }
                        if ui.add_enabled(!imp_tm.trim().is_empty(), egui::Button::new("Імпортувати пари").min_size(vec2(0.0, 28.0))).clicked() {
                            import_tm = true;
                        }
                    });
                }
                "github" => {
                    stshell::warn_banner(ui, false, "Токен лишається тільки на цьому пристрої", "Дайте йому доступ лише до репозиторію з перекладом (право «Contents: Read and write»). Він не потрапляє у файл проєкту.");
                    stshell::hint(ui, "Переклад зберігається у вашому репозиторії GitHub (краще приватному) звичайними файлами, а історія комітів показує, що й коли змінилося. Створіть репозиторій із файлом README, потім токен: GitHub → Settings → Developer settings → Fine-grained tokens.");
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Налаштування GitHub…").clicked() {
                            go = Some("github");
                        }
                    });
                }
                _ => {
                    if danger_page(ui, armed) {
                        reset_click = true;
                    }
                }
            },
            |ui| {
                if stshell::bar_button(ui, "Скасувати", false, true).clicked() {
                    cancel = true;
                }
                if stshell::bar_button(ui, "Застосувати", false, dirty).clicked() {
                    apply = true;
                }
                if stshell::bar_button(ui, "Зберегти", true, true).clicked() {
                    save = true;
                }
            },
        );
        self.nav_proj = nav;
        self.imp_terms = imp_terms;
        self.imp_tm = imp_tm;
        if import_terms {
            self.message = self.st.import_terms_table(&self.imp_terms.clone());
            self.imp_terms.clear();
        }
        if import_tm {
            self.message = self.st.import_memory(&self.imp_tm.clone());
            self.imp_tm.clear();
        }
        if reset_click {
            self.reset_clicked();
            if self.settings.is_none() {
                return;
            }
        }
        if let Some((n, k)) = branch_act {
            self.branch_action(n, k);
        }
        if new_branch {
            self.br_win = Some(String::new());
        }
        // кнопки сторінок, що відкривають окремі вікна: це вікно на цей час закривається (як `away` у вебі), зміни спершу застосовуються
        if let Some(g) = go {
            if dirty {
                self.apply_project(&v);
            }
            self.settings = None;
            self.settings_go(g);
            return;
        }
        if (save || apply) && v.name_from == "custom" && v.title.trim().is_empty() {
            // як у вебі: своя назва обрана, а написати забули
            self.message = "Напишіть свою назву або виберіть іншу".into();
            save = false;
            apply = false;
        }
        if save || apply {
            self.apply_project(&v);
            if apply {
                self.message = "Збережено".into();
            }
        }
        if save || cancel {
            self.settings = None;
        } else if esc && (!dirty || esc_armed) {
            self.settings = None;
            self.esc_at = None;
        } else {
            if esc {
                self.esc_at = Some(std::time::Instant::now());
            }
            self.settings = Some(v);
        }
    }

    /// «Налаштування» (Файл → Налаштування…): вікно `.st-dlg` із пошуком і групами сторінок. Лише те, що стосується застосунку й вас («Загальні», «Вигляд» вікна, «Оновлення», «Власний сервер»);
    /// усе про сам проєкт (назва, мови, перевірка, глосарій, гілки, GitHub, скидання) — у «Налаштуваннях проєкту».
    fn app_settings_window(&mut self, ctx: &egui::Context) {
        let Some(mut v) = self.app_set.clone() else { return };
        let saved = self.st.settings_view();
        let dirty = saved.as_ref().is_some_and(|s| s.general_differs(&v));
        let version = {
            let id = transly_platform::selfupdate::build_id();
            if id == "dev" { "локальна".to_string() } else { id.chars().take(7).collect() }
        };
        let mut nav = std::mem::replace(&mut self.nav_app, stshell::StNav::new("general"));
        let (mut apply, mut save, mut cancel) = (false, false, false);
        let mut go: Option<&'static str> = None;
        let esc_armed = self.esc_at.is_some_and(|t| t.elapsed().as_secs() < 4);
        let mut sysbar = false;
        let own_chrome = self.chrome_own;
        let esc = stshell::StShell { key: "app", aria: "Налаштування", crumb: String::new(), height: 640.0, groups: Self::APP_PAGES, search: true, dirty, esc_armed }.show(
            ctx,
            &mut nav,
            |ui, page| match page {
                "general" => {
                    stshell::grid_row(ui, "Ваше ім’я в коментарях та історії", |ui| {
                        let mut t = v.who.clone();
                        let r = stshell::input(ui, &mut t, "", ui.available_width());
                        v.who = t.chars().take(40).collect();
                        r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::TextEdit, true, "Хто перекладає"));
                    });
                    stshell::grid_row(ui, "Мова інтерфейсу", |ui| {
                        ui.label("Українська");
                    });
                    stshell::hint(ui, "Інші мови додаються як розширення (мовні пакети).");
                    stshell::sub(ui, "Проєкт", true, |ui| {
                        stshell::hint(ui, "Назва, мови, перевірка, однакові рядки, глосарій і пам’ять, гілки, папка гри, GitHub і скидання налаштовуються окремо для кожного проєкту.");
                        stshell::acts(ui, |ui| {
                            if plain_button(ui, "Налаштування проєкту…").clicked() {
                                go = Some("project");
                            }
                        });
                    });
                }
                "look" => {
                    let mut sys = !own_chrome;
                    if stshell::check(ui, &mut sys, "Системний заголовок вікна").changed() {
                        sysbar = true;
                    }
                    stshell::hint(ui, "Запасний варіант: якщо власного заголовка не видно або його кнопки не працюють. Застосовується одразу.");
                }
                "update" => {
                    stshell::hint(ui, &format!("Версія збірки: {version}"));
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Перевірити оновлення зараз").clicked() {
                            go = Some("update");
                        }
                    });
                }
                _ => {
                    stshell::warn_banner(ui, false, "Для адреси в інтернеті потрібен https", "Дані шифруються паролем на пристроях: сервер лише передає їх і забуває. Адреса в домашній мережі може бути й http.");
                    stshell::hint(ui, "Власний сервер для обміну між вашими пристроями: адреса, пароль і період. Він не залежить від проєкту.");
                    stshell::acts(ui, |ui| {
                        if plain_button(ui, "Налаштування сервера…").clicked() {
                            go = Some("relay");
                        }
                    });
                }
            },
            |ui| {
                if stshell::bar_button(ui, "Скасувати", false, true).clicked() {
                    cancel = true;
                }
                if stshell::bar_button(ui, "Застосувати", false, dirty).clicked() {
                    apply = true;
                }
                if stshell::bar_button(ui, "Зберегти", true, true).clicked() {
                    save = true;
                }
            },
        );
        self.nav_app = nav;
        if sysbar {
            self.toggle_chrome(ctx);
        }
        // кнопки сторінок, що відкривають окремі вікна: це вікно на цей час закривається (як `away` у вебі), зміни спершу застосовуються
        if let Some(g) = go {
            if dirty {
                self.apply_general(&v);
            }
            self.app_set = None;
            self.settings_go(g);
            return;
        }
        if save || apply {
            self.apply_general(&v);
            if apply {
                self.message = "Збережено".into();
            }
        }
        if save || cancel {
            self.app_set = None;
        } else if esc && (!dirty || esc_armed) {
            self.app_set = None;
            self.esc_at = None;
        } else {
            if esc {
                self.esc_at = Some(std::time::Instant::now());
            }
            self.app_set = Some(v);
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
                stshell::check(ui, &mut cfg.originals, "");
                ui.end_row();
            });
            ui.label(RichText::new("Токен не зберігається: його треба вводити в кожному сеансі.").size(11.0).color(MUTE));
            dlg_footer(ui, |ui| {
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
                if ui.add_enabled(cfg.configured() && !self.st.syncing(), egui::Button::new(RichText::new("Синхронізувати").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
        let repo = self.upd.repo.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(UpdMsg::Checked(transly_platform::selfupdate::check_latest(&repo, "")));
        });
        self.upd.rx = Some(rx);
    }

    fn update_download(&mut self) {
        let Some(asset) = self.upd.latest.as_ref().and_then(|l| l.asset.clone()) else { return };
        if self.upd.rx.is_some() {
            return;
        }
        self.upd.status = "Завантажую оновлення…".into();
        let dir = std::env::temp_dir().join("transly-native-update");
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(UpdMsg::Downloaded(transly_platform::selfupdate::download_new(&asset, "", &dir)));
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
                    self.message = "Є нова версія: натисніть «Оновити» праворуч внизу".into();
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
                if can_install && ui.add(egui::Button::new(RichText::new("Оновити й перезапустити").color(Color32::WHITE)).fill(accent_solid())).clicked() {
                    install = true;
                }
                if ui.add_enabled(!busy, egui::Button::new("Перевірити зараз")).clicked() {
                    check = true;
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
                        if stshell::check(ui, &mut on, "").changed() {
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
            dlg_footer(ui, |ui| {
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
                        if stshell::check(ui, &mut on, "").changed() {
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
        // кількість рахується лише коли змінилися запит, прапорці чи сам переклад (на сотні тисяч рядків це не для кожного кадру)
        let key = (self.st.rev, find.clone(), repl.clone(), case, word);
        let count = match &self.find_count {
            Some((k, n)) if *k == key => *n,
            _ => {
                let n = self.st.run_replace(std::slice::from_ref(&step), false).unwrap_or(0);
                self.find_count = Some((key, n));
                n
            }
        };
        dlg("Знайти й замінити в перекладах").open(&mut open).collapsible(false).resizable(false).default_width(420.0).show(ctx, |ui| {
            // як `tools-dialogs.ts`: сітка «Знайти / Замінити на» (1,4fr / 1fr), прапорці рядками, блок підсумку
            stshell::grid_row(ui, "Знайти", |ui| {
                let w = ui.available_width();
                stshell::input(ui, &mut find, "", w);
            });
            stshell::grid_row(ui, "Замінити на", |ui| {
                let w = ui.available_width();
                stshell::input(ui, &mut repl, "", w);
            });
            stshell::check(ui, &mut word, "Лише ціле слово");
            stshell::check(ui, &mut case, "Враховувати регістр");
            stshell::sum_box(ui, &if find.is_empty() { "Введіть, що шукати".to_string() } else { format!("Буде змінено рядків: {count}") });
            dlg_footer(ui, |ui| {
                if ui.add_enabled(count > 0, egui::Button::new(RichText::new("Замінити все").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
                            stshell::check(ui, on, "");
                            ui.vertical(|ui| {
                                ui.label(RichText::new(&p.source).color(SRC_TEXT));
                                ui.label(RichText::new(&p.target).color(TEXT));
                            });
                        });
                        ui.separator();
                    }
                });
            }
            dlg_footer(ui, |ui| {
                let n = list.iter().filter(|x| x.1).count();
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("Записати чернетками ({n})")).color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
            stshell::check(ui, &mut c.only_approved, "Лише вичитані рядки");
            ui.add_enabled(!c.only_approved, egui::Checkbox::new(&mut c.include_drafts, "Додати чернетки (щоб перевірити переклад у грі)"));
            stshell::check(ui, &mut c.block_errors, "Рядки з помилкою QA лишати мовою оригіналу");
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
            dlg_footer(ui, |ui| {
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
            dlg_footer(ui, |ui| {
                if ui.add_enabled(!text.trim().is_empty(), egui::Button::new(RichText::new("Імпортувати").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
            dlg_footer(ui, |ui| {
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
            dlg_footer(ui, |ui| {
                if ui.add_enabled(!lang.trim().is_empty(), egui::Button::new(RichText::new("Обрати папку…").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
                if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(RichText::new("Створити").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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
                if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(RichText::new("Створити з поточної").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
                    create = true;
                }
            });
        });
        if let Some((n, k)) = act {
            self.branch_action(n, k);
        }
        if create {
            self.message = self.st.create_branch(&name).map(|_| format!("Гілка «{}»", name.trim())).unwrap_or_else(|e| e);
            name.clear();
        }
        if open {
            self.br_win = Some(name);
        }
    }

    /// Дія над гілкою зі списку: 0 — перемкнутись, 1 — злити сюди, 2 — видалити, 3 — перейменувати.
    fn branch_action(&mut self, n: String, k: u8) {
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
            stshell::check(ui, &mut face, "Поруч портрет персонажа");
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
            dlg_footer(ui, |ui| {
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
            dlg_footer(ui, |ui| {
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
                        stshell::check(ui, on, &format!("{} · {}", p.file, if p.conf.level == "high" { "впевнено" } else { "перевірте" }));
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
            dlg_footer(ui, |ui| {
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new("Оновити вибрані").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
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

    /// Індекс слів для вживання записів і пошук конструкцій ідуть у фонових потоках, а панель глосарія, поки вони не готові, просить перемальовування
    /// (`Harness::run` тоді вичерпує кроки). Тести з глосарієм чекають на них наперед: на повільній машині CI потоки не встигають за кілька кадрів.
    fn warm_usage(app: &App) {
        if let Some(t) = app.st.glossary_terms().first() {
            for _ in 0..1000 {
                if app.st.usage_counts(t).is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        for _ in 0..1000 {
            if !app.st.mine_cards().1 && !app.st.auto_dict().1 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
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

    /// Рядки з однаковою конструкцією («Take … off» усюди передано одним словом): гра на кілька описів предметів, усі надіслано.
    fn construction_game(tag: &str) -> App {
        let base = std::env::temp_dir().join(format!("transly-ui-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let things = ["ring", "hat", "cloak", "boots", "gloves"];
        let items: Vec<String> = things.iter().enumerate().map(|(i, t)| format!(r#"{{"id":{},"name":"Thing {}","description":"Take the {t} off","note":""}}"#, i + 1, i + 1)).collect();
        std::fs::write(data.join("Items.json"), format!("[null,{}]", items.join(","))).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        for r in 0..app.st.row_count(0) {
            let src = app.st.source_of(0, r);
            if let Some(t) = src.strip_prefix("Take the ").and_then(|x| x.strip_suffix(" off")) {
                let uk = match t { "ring" => "каблучку", "hat" => "капелюх", "cloak" => "плащ", "boots" => "чоботи", _ => "рукавички" };
                app.st.submit(0, r, &format!("Зніми {uk}")).unwrap();
            }
        }
        app
    }

    /// Конструкції шукаються у фоні й пропонуються: у вікні «Конструкції» й у глосарії (чип «Конструкції»); «Додати» пише запис, «Не зараз» ховає картку.
    #[test]
    fn constructions_are_found_in_the_background_and_added_to_the_glossary() {
        let app = construction_game("mine");
        let list = loop {
            let (list, running) = app.st.mine_cards();
            if !running {
                break list;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        assert_eq!(list.len(), 1, "{list:?}");
        assert_eq!(list[0].en, "take … off");
        assert_eq!(list[0].rows.len(), 5);
        let mut app = app;
        app.mine_win = true;
        let mut h = harness(app);
        h.run();
        h.get_by_label_contains("так уже перекладено в 5 рядках");
        h.get_by_label("Не зараз").click();
        h.run();
        assert!(h.state().st.is_dismissed("mine", "take … off"));
        h.get_by_label_contains("Нових конструкцій не знайдено");
        h.state_mut().st.clear_dismissed();
        h.run();
        h.get_by_label("Додати").click();
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

    /// Проєкт для сповіщень: «Герой» без керівних кодів (помилка QA), «Маг» — чернетка з коментарем Олі.
    fn bell_game() -> (App, usize, usize) {
        let base = std::env::temp_dir().join(format!("transly-ui-bell-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"\\C[2]Hero\\C[0]","nickname":"","profile":"Brave","note":""},{"id":2,"name":"Mage","nickname":"","profile":"Wise","note":""}]"#).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let row = |app: &App, src: &str| app.st.views[0].units.iter().position(|u| u.source == src).unwrap_or_else(|| panic!("нема рядка {src}"));
        let (hero, mage) = (row(&app, "\\C[2]Hero\\C[0]"), row(&app, "Mage"));
        app.st.edit(0, hero, "Герой");
        app.st.edit(0, mage, "Маг");
        app.st.project.as_mut().unwrap().settings.insert("who".into(), serde_json::json!("Оля"));
        app.st.comment(0, mage, "Глянь, будь ласка");
        app.st.project.as_mut().unwrap().settings.insert("who".into(), serde_json::json!("Ви"));
        (app, hero, mage)
    }

    /// Дзвоник: число пунктів на кнопці (червоне, коли є помилка QA), список «Потребує уваги» / «Нове від інших», клік по пункту лишає в таблиці
    /// його рядки, «Позначити нове прочитаним» прибирає новини, а коли нічого немає — «Усе гаразд».
    #[test]
    fn the_bell_counts_what_needs_attention_and_shows_the_rows_of_an_item() {
        use transly_core::inbox::InboxKind;
        let (mut app, hero, _mage) = bell_game();
        for _ in 0..100 {
            if app.st.inbox_step(std::time::Duration::from_millis(50)).is_none() {
                break;
            }
        }
        let kinds: Vec<InboxKind> = app.st.inbox.items.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, [InboxKind::Error, InboxKind::Replies, InboxKind::Draft], "{:?}", app.st.inbox.items);
        assert_eq!(app.st.inbox.badge(), (3, true));
        let mut h = harness(app);
        h.run();
        // бейдж не заважає кнопці: вона лишається в тому ж місці й знаходиться за підказкою
        let bell = h.get_by_label("Сповіщення: що потребує уваги й що змінили інші");
        bell.click();
        h.run();
        h.get_by_label_contains("Потребує уваги");
        h.get_by_label_contains("Нове від інших");
        h.get_by_label_contains("Оля: 1 новий коментар");
        // пункт з помилкою відкриває її рядок і лишає в таблиці лише рядки пункту
        h.get_by_label_contains("1 помилка QA").click();
        h.run();
        assert_eq!(h.state().st.row, Some(hero));
        assert_eq!(h.state().st.rows_filter.as_ref().map(|r| r.title.as_str()), Some("1 помилка QA"));
        assert_eq!(h.state().st.visible_len(0), 1);
        assert_eq!(h.state().message, "Показано лише: 1 помилка QA");
        // список закрився; «Ще» дає скинути набір
        h.run();
        assert!(h.query_by_label_contains("Нове від інших").is_none());
        h.state_mut().st.rows_filter = None;
        assert_eq!(h.state().st.visible_len(0), 4);
        // «Позначити нове прочитаним» прибирає новини, а стан лишається
        h.get_by_label("Сповіщення: що потребує уваги й що змінили інші").click();
        h.run();
        h.get_by_label("Позначити нове прочитаним").click();
        h.run();
        let kinds: Vec<InboxKind> = h.state().st.inbox.items.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, [InboxKind::Error, InboxKind::Draft]);
        assert_eq!(h.state().st.inbox.badge(), (2, true));
        // коли нічого немає — «Усе гаразд», а числа на кнопці немає
        let mut quiet = App::default();
        quiet.st.open_game(&game("bell-quiet")).unwrap();
        let mut h = harness(quiet);
        h.run();
        assert_eq!(h.state().st.inbox.badge(), (0, false));
        h.get_by_label("Сповіщення: що потребує уваги й що змінили інші").click();
        h.run();
        h.get_by_label_contains("Усе гаразд");
    }

    /// Знайшли нову збірку — у рядку стану з'являється одна кнопка «Оновити» (без токена й репозиторію).
    #[test]
    fn a_newer_build_shows_one_update_button_in_the_status_bar() {
        use transly_core::update::{ReleaseAsset, ReleaseInfo};
        let mut app = App::default();
        let release = ReleaseInfo { sha: "abcdef1".into(), published: "2026-11-26T10:00:00Z".into(), assets: vec![ReleaseAsset { name: "Transly-native.exe".into(), url: "https://api.github.com/x".into(), size: 1.0, digest: None }] };
        app.upd.latest = Some(transly_platform::selfupdate::Latest { asset: Some(("Transly-native.exe".into(), "https://api.github.com/x".into(), 1)), release, newer: true });
        let mut h = harness(app);
        h.run();
        h.get_by_label("Оновити застосунок");
        // у вікні «Оновлення» немає ні поля репозиторію, ні токена
        h.state_mut().upd.win = true;
        h.run();
        assert!(h.query_by_label("Токен (лише для приватного)").is_none() && h.query_by_label("Репозиторій зі збірками").is_none());
        h.get_by_label("Оновити й перезапустити");
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
        let mine = loop {
            let (list, running) = h.state().st.mine_cards();
            if !running {
                break list;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
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

    /// Вікна налаштувань — як у вебі: «Налаштування проєкту» зі сторінками «Назва й вигляд», «Гілки»…, «Налаштування» з пошуком і групами; «Зберегти / Застосувати / Скасувати».
    #[test]
    fn the_settings_windows_have_pages_and_save_like_the_web_ones() {
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
        for page in ["Назва й вигляд", "Гілки", "Папка гри", "Файл", "Мови", "Однакові рядки", "Правила QA", "Перенесення рядків", "Імпорт глосарію", "Імпорт пам’яті перекладів", "GitHub", "Небезпечна зона"] {
            h.get_by_label(page);
        }
        // загальне («Ваше ім'я», вікно, оновлення, сервер) у проєкті не лежить
        assert!(h.query_by_label("Хто перекладає").is_none() && h.query_by_label("Власний сервер").is_none() && h.query_by_label("Оновлення застосунку").is_none());
        h.get_by_label("Гілки").click();
        h.run();
        h.get_by_label("+ Нова гілка…");
        assert_eq!(h.state().nav_proj.cur, "branches");
        // «Правила QA»: допуск довжини, найдовший рядок і прапорець правляться тут, і «Зберегти» записує їх у проєкт
        h.get_by_label("Правила QA").click();
        h.run();
        h.get_by_label("Допуск довжини, %");
        let before = h.state().st.settings_view().unwrap().block_errors;
        h.get_by_label("Не надсилати рядок із помилкою QA").click();
        h.run();
        assert!(h.state().settings.as_ref().unwrap().block_errors != h.state().st.settings_view().unwrap().block_errors, "зміна чекає на «Застосувати»");
        h.get_all_by_label("Зберегти").last().unwrap().click();
        h.run();
        assert!(h.state().settings.is_none());
        assert_eq!(h.state().st.settings_view().unwrap().block_errors, !before, "«Зберегти» записало прапорець у проєкт");
        // «Налаштування»: дерево з пошуком; лише загальне; «Застосувати» мертва, поки нема змін
        h.state_mut().app_set = h.state().st.settings_view();
        h.run();
        h.get_by_label("Налаштування");
        h.get_by_label("Пошук налаштувань");
        for page in ["Загальні", "Вигляд", "Оновлення застосунку", "Власний сервер"] {
            h.get_by_label(page);
        }
        for page in ["Правила QA", "Імпорт глосарію", "GitHub", "Небезпечна зона", "Гра і мови", "Папка гри"] {
            assert!(h.query_by_label(page).is_none(), "«{page}» — сторінка проєкту, у загальних її немає");
        }
        h.get_by_label("Хто перекладає").click();
        h.get_by_label("Хто перекладає").type_text("Артем");
        h.run();
        h.get_all_by_label("Зберегти").last().unwrap().click();
        h.run();
        assert!(h.state().app_set.is_none());
        assert!(h.state().st.settings_view().unwrap().who.ends_with("Артем"), "ім'я записано: {:?}", h.state().st.settings_view().map(|v| v.who));
        // пошук залишає лише збіги й переходить до першого з них
        h.state_mut().app_set = h.state().st.settings_view();
        h.run();
        h.get_by_label("Пошук налаштувань").click();
        h.get_by_label("Пошук налаштувань").type_text("сервер");
        h.run();
        h.run();
        assert_eq!(h.state().nav_app.cur, "server");
        assert!(h.query_by_label("Оновлення застосунку").is_none(), "решта сторінок сховалась");
        // Esc із незмінним станом закриває
        press(&mut h, egui::Modifiers::NONE, egui::Key::Escape);
        h.run();
        assert!(h.state().app_set.is_none());
    }

    /// Групи дерева складаються й розкриваються кліком по заголовку, в обох вікнах однаково; сторінки мають піктограми.
    #[test]
    fn the_groups_of_both_settings_trees_fold() {
        let data = game("fold");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.settings = app.st.settings_view();
        let mut h = harness(app);
        h.run();
        h.run();
        h.get_by_label("Правила QA");
        h.get_by_label("Перевірка").click();
        h.run();
        assert!(h.query_by_label("Правила QA").is_none() && h.query_by_label("Перенесення рядків").is_none(), "згорнуту групу сховано");
        h.get_by_label("Назва й вигляд");
        h.get_by_label("Перевірка").click();
        h.run();
        h.get_by_label("Правила QA");
        // у загальних те саме
        h.state_mut().settings = None;
        h.state_mut().app_set = h.state().st.settings_view();
        h.run();
        h.run();
        h.get_by_label("Оновлення застосунку");
        h.get_by_label("Застосунок").click();
        h.run();
        assert!(h.query_by_label("Оновлення застосунку").is_none());
        h.get_by_label("Синхронізація");
        // кожна сторінка має піктограму
        let icons = |g: &[stshell::Group]| g.iter().all(|(_, p)| p.iter().all(|(_, _, i)| !i.is_empty()));
        assert!(icons(App::PROJECT_PAGES) && icons(App::APP_PAGES));
    }

    /// Сторінки не повторюються: кожне налаштування лежить в одному вікні (проєкт — у проєкті, застосунок — у загальних).
    #[test]
    fn project_and_general_settings_do_not_share_pages() {
        let ids = |g: &[stshell::Group]| g.iter().flat_map(|(_, p)| p.iter().map(|(i, _, _)| *i)).collect::<std::collections::HashSet<_>>();
        let (p, a) = (ids(App::PROJECT_PAGES), ids(App::APP_PAGES));
        // «look» названо однаково, але в проєкті це «Назва й вигляд», а в загальних — «Вигляд» вікна: різні сторінки; решта не збігається
        let shared: Vec<_> = p.intersection(&a).collect();
        assert_eq!(shared, vec![&"look"], "спільний лише ідентифікатор look (різний зміст): {shared:?}");
        let titles = |g: &[stshell::Group]| g.iter().flat_map(|(_, p)| p.iter().map(|(_, t, _)| *t)).collect::<std::collections::HashSet<_>>();
        assert!(titles(App::PROJECT_PAGES).is_disjoint(&titles(App::APP_PAGES)), "назви сторінок не повторюються");
    }

    /// «Скинути проєкт»: перший клік зводить кнопку («Так, видалити…»), другий (за 1,2 с…6 с) стирає переклад, назва й колір лишаються.
    #[test]
    fn resetting_the_project_asks_twice_and_keeps_the_look() {
        let data = game("reset");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.edit(0, 0, "Герой");
        let mut v = app.st.settings_view().unwrap();
        v.title = "Моя назва".into();
        v.name_from = "custom".into();
        app.st.apply_settings(&v);
        assert_eq!(app.st.progress().draft, 1);
        app.settings = app.st.settings_view();
        app.nav_proj.cur = "danger";
        let mut h = harness(app);
        h.run();
        h.get_by_label("Скинути проєкт…").click();
        h.run();
        h.get_by_label("Так, видалити весь переклад");
        assert!(h.state().reset_arm.is_some());
        // надто швидкий другий клік (до 1,2 с) нічого не робить
        h.get_by_label("Так, видалити весь переклад").click();
        h.run();
        assert_eq!(h.state().st.progress().draft, 1, "швидкий клік не стирає");
        // після паузи — стирає
        h.state_mut().reset_arm = Some(std::time::Instant::now() - std::time::Duration::from_millis(2000));
        h.run();
        h.get_by_label("Так, видалити весь переклад").click();
        h.run();
        assert_eq!(h.state().st.progress().draft, 0, "переклад скинуто");
        assert_eq!(transly_core::projname::project_title(h.state().st.project.as_ref().unwrap()), "Моя назва", "назва лишилась");
        assert!(h.state().settings.is_none());
    }

    /// Налаштування проєкту — вигляд: звідки назва, свої літери значка, колір акценту (готові відтінки й повзунок); колір пробується одразу, «Скасувати» його повертає,
    /// «Зберегти» записує назву, літери й колір у проєкт.
    #[test]
    fn the_project_settings_set_the_name_icon_and_accent() {
        let data = game("look");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let title = |app: &App| transly_core::projname::project_title(app.st.project.as_ref().unwrap());
        assert_eq!(title(&app), "MyGame", "назва береться з папки гри");
        let own_hue = transly_core::theme::theme_hue("MyGame", None);
        let mut h = harness(app);
        h.state_mut().settings = h.state().st.settings_view();
        h.run();
        // картка-перегляд показує те, що буде в шапці
        h.get_by_label("Проєкт: MyGame");
        assert_eq!(h.state().st.settings_preview(h.state().settings.as_ref().unwrap()).2, own_hue);
        // готовий відтінок пробується одразу (тут — у перегляді, кольори застосунку йдуть за ним у `frame`)
        h.get_by_label("Відтінок 305°").click();
        h.run();
        assert_eq!(h.state().settings.as_ref().unwrap().hue, Some(305));
        assert_eq!(h.state().st.settings_preview(h.state().settings.as_ref().unwrap()).2, 305);
        // «Скасувати» нічого не записує
        h.get_by_label("Скасувати").click();
        h.run();
        assert!(h.state().settings.is_none());
        assert!(h.state().st.project.as_ref().unwrap().settings.get("hue").is_none());
        // своя назва, свої літери й відтінок: «Зберегти» записує їх
        h.state_mut().settings = h.state().st.settings_view();
        h.run();
        h.get_by_label("Відтінок 305°").click();
        h.run();
        h.get_by_label("Назва, написана вручну").click();
        h.get_by_label("Назва, написана вручну").type_text("Покинута хатина");
        h.run();
        h.get_by_label("Літери значка").click();
        h.get_by_label("Літери значка").type_text("пх");
        h.run();
        assert_eq!(h.state().settings.as_ref().unwrap().name_from, "custom", "текст у полі обирає «Своя назва»");
        h.get_by_label("Проєкт: Покинута хатина");
        h.get_by_label("Зберегти").click();
        h.run();
        let st = &h.state().st;
        assert_eq!(transly_core::projname::project_title(st.project.as_ref().unwrap()), "Покинута хатина");
        assert_eq!(transly_core::projname::icon_letters(st.project.as_ref().unwrap()), "ПХ");
        assert_eq!(st.project.as_ref().unwrap().settings.get("hue").and_then(|v| v.as_u64()), Some(305));
        // «Як за назвою» повертає колір за назвою, а джерело «З папки гри» — назву з папки
        let mut v = h.state().st.settings_view().unwrap();
        v.hue = None;
        v.name_from = "folder".into();
        v.title.clear();
        v.icon_text.clear();
        h.state_mut().st.apply_settings(&v);
        let p = h.state().st.project.as_ref().unwrap();
        assert_eq!(transly_core::projname::project_title(p), "MyGame");
        assert!(["hue", "title", "iconText", "nameFrom"].iter().all(|k| p.settings.get(*k).is_none()), "типове не пишеться: {:?}", p.settings);
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

    /// Закрита колонка не лишає порожнього місця: полотно розтягується. Права — коли всі її розділи вимкнено, ліва — клік по активній кнопці смужки.
    #[test]
    fn closing_a_side_column_gives_its_room_to_the_canvas() {
        let data = game("closecols");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        h.run();
        let centre = |h: &Harness<'static, App>| h.ctx.data(|d| d.get_temp::<Rect>(egui::Id::new("pane-centre"))).unwrap().width();
        let w0 = centre(&h);
        h.state_mut().right_secs = [[false; 3]; 2];
        h.run();
        h.run();
        let w1 = centre(&h);
        assert!(w1 >= w0 + 350.0, "права колонка закрита: {w0} → {w1}");
        h.get_by_label("Панель: Файли гри").click();
        h.run();
        h.run();
        let w2 = centre(&h);
        assert!(!h.state().left_open && w2 >= w1 + 300.0, "ліва колонка закрита: {w1} → {w2}");
        // перемикач режимів лишається в куті полотна, що з'їхало ліворуч
        let sx = h.get_by_label("Таблиця: усі рядки файлу").bounding_box().unwrap().x0;
        assert_eq!(sx as f32, layout::seg_x_at(0.0));
        // клік по кнопці смужки знову відкриває ліву колонку
        h.get_by_label("Панель: Файли гри").click();
        h.run();
        h.run();
        assert!(h.state().left_open && centre(&h) < w2);
    }

    /// Tab вмикає клавіатурне кільце фокусу, клік вимикає; відкритий діалог гасить підсвітку вікон.
    #[test]
    fn tab_turns_the_keyboard_ring_on_and_a_dialog_puts_the_lights_out() {
        let data = game("kbring");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let mut h = harness(app);
        h.run();
        assert!(!h.state().kb_nav);
        press(&mut h, egui::Modifiers::NONE, egui::Key::Tab);
        h.run();
        assert!(h.state().kb_nav, "Tab вмикає кільце");
        let p = pos2(650.0, 600.0);
        h.input_mut().events.push(egui::Event::PointerMoved(p));
        h.input_mut().events.push(egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed: true, modifiers: egui::Modifiers::NONE });
        h.run();
        assert!(!h.state().kb_nav, "клік вимикає кільце");
        assert!(h.state().lit(Pane::Centre));
        h.state_mut().keys_win = true;
        assert!(!h.state().lit(Pane::Centre), "діалог гасить підсвітку");
        h.state_mut().keys_win = false;
        assert!(h.state().lit(Pane::Centre));
    }

    /// Ліва й права смужки мають першу кнопку на одному рівні з текстом заголовка картки (центр 58, 28×28); перемикач режимів — у верхній панелі,
    /// прикріплений до лівого верхнього кута полотна (x = межа полотна + 6) і не зсувається довгою назвою проєкту.
    #[test]
    fn the_side_rails_start_level_with_the_header_text_and_the_mode_switch_is_pinned_to_the_canvas_corner() {
        let data = game("rails");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        for label in ["Панель: Файли гри", "Права панель: Активність у рядку: хто, коли й що змінював"] {
            let r = h.get_by_label(label).bounding_box().unwrap();
            assert_eq!(((r.y0 + r.y1) / 2.0, r.x1 - r.x0, r.y1 - r.y0), (58.0, 28.0, 28.0), "{label}: {r:?}");
        }
        // кнопка ≡ — на одній вертикалі з кнопками лівої смужки (x 6…34, центр 20), центр по висоті 20
        let menu = h.get_by_label("Головне меню").bounding_box().unwrap();
        let strip = h.get_by_label("Панель: Файли гри").bounding_box().unwrap();
        assert_eq!((menu.x0, menu.x1 - menu.x0, (menu.y0 + menu.y1) / 2.0), (strip.x0, 28.0, 20.0), "{menu:?} {strip:?}");
        let sx = layout::seg_x(1360.0) as f64;
        for (i, label) in ["Таблиця: усі рядки файлу", "Редагування: один рядок", "Сцена: репліки подій поспіль"].iter().enumerate() {
            let r = h.get_by_label(label).bounding_box().unwrap();
            assert_eq!((r.x0, (r.y0 + r.y1) / 2.0, r.x1 - r.x0), (sx + 34.0 * i as f64, 20.0, 28.0), "{label}: {r:?}");
        }
        // довга назва проєкту скорочується й перемикач лишається на місці
        h.state_mut().st.project.as_mut().unwrap().name = "Дуже-дуже довга назва проєкту, що не вміщується".into();
        h.state_mut().st.project.as_mut().unwrap().settings.remove("folderName");
        h.run();
        assert_eq!(h.get_by_label("Таблиця: усі рядки файлу").bounding_box().unwrap().x0, sx);
        h.get_by_label("Редагування: один рядок").click();
        h.run();
        assert!(h.state().focus && h.state().pane == Pane::Centre);
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
        warm_usage(&app);
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

    /// Чип «Конструкції» в глосарії: зверху пропозиції зі знайдених у фоні; «Додати» відкриває форму з готовим шаблоном (нічого не пишеться, поки не збережено),
    /// «Показати 5» лишає в таблиці ці рядки, «Не зараз» ховає картку.
    #[test]
    fn the_construction_chip_offers_the_found_constructions() {
        let app = construction_game("glmine");
        warm_usage(&app);
        loop {
            let (_, running) = app.st.mine_cards();
            if !running {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let mut h = harness(app);
        h.state_mut().rail = 3;
        h.run();
        h.get_by_label("Вид записів: Конструкції").click();
        h.run();
        h.get_by_label_contains("Показати 5: take … off").click();
        h.run();
        assert_eq!(h.state().st.rows_filter.as_ref().map(|r| r.title.as_str()), Some("«take … off»: так уже перекладено"));
        assert_eq!(h.state().st.visible_len(0), 5);
        h.get_by_label_contains("Додати: take … off").click();
        h.run();
        let f = h.state().gl_form.as_ref().expect("форма відкрита");
        assert_eq!((f.en.as_str(), f.was.as_deref()), ("take … off", None));
        assert!(h.state().st.terms().is_empty(), "нічого не записано, поки форму не збережено");
        h.get_by_label_contains("Не зараз: take … off").click();
        h.run();
        assert!(h.state().st.is_dismissed("mine", "take … off"));
        assert!(h.query_by_label_contains("Додати: take … off").is_none(), "картка зникла");
    }

    /// Чипи глосарія «Рядки», «Пам’ять», «Розбіжності» відкривають свої списки (не заглушку).
    #[test]
    fn the_glossary_chips_rows_memory_and_differences_switch_the_list() {
        let data = game("glchips");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.add_term("Hero", "Герой");
        warm_usage(&app);
        let mut h = harness(app);
        h.state_mut().rail = 3;
        h.run();
        for (label, idx) in [("Рядки", 3), ("Пам’ять", 4), ("Розбіжності", 5)] {
            h.get_by_label(&format!("Вид записів: {label}")).click();
            h.run();
            h.run();
            assert_eq!(h.state().gl_show, idx, "{label}");
        }
        assert!(h.state().gl_mem_asked, "після «Пам’ять» лічильник пам’яті показується");
    }

    /// Протягування по стовпці номерів виділяє рядки від того, де натиснули, до того, що під вказівником; Ctrl додає до наявного; рух менший за поріг — лише клацання.
    #[test]
    fn dragging_over_the_number_column_selects_rows() {
        let data = game("dragsel");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        let mid = |h: &Harness<'static, App>, name: &str| {
            let b = h.get_by_label_contains(name).bounding_box().unwrap();
            (b.x0 as f32, ((b.y0 + b.y1) / 2.0) as f32)
        };
        let (x0, y_hero) = mid(&h, "Hero");
        let (_, y_mage) = mid(&h, "Mage");
        let (_, y_wise) = mid(&h, "Wise");
        let x = x0 + 17.0;
        let drag = |h: &mut Harness<'static, App>, from: f32, to: f32, mods: egui::Modifiers| {
            h.input_mut().modifiers = mods;
            h.input_mut().events.push(egui::Event::PointerMoved(pos2(x, from)));
            h.step();
            h.input_mut().events.push(egui::Event::PointerButton { pos: pos2(x, from), button: egui::PointerButton::Primary, pressed: true, modifiers: mods });
            h.step();
            // кадри тесту йдуть по чверті секунди, а клацання в egui — це натиск і відпускання за < 0,8 с: для малого руху проміжних кадрів немає
            let steps = if (to - from).abs() < 6.0 { 0 } else { 4 };
            for k in 1..=steps {
                h.input_mut().events.push(egui::Event::PointerMoved(pos2(x, from + (to - from) * k as f32 / steps as f32)));
                h.step();
            }
            h.input_mut().events.push(egui::Event::PointerButton { pos: pos2(x, to), button: egui::PointerButton::Primary, pressed: false, modifiers: mods });
            h.step();
            h.step();
            h.input_mut().modifiers = egui::Modifiers::NONE;
        };
        // від першого рядка до третього: 0, 1, 2 (4 рядки в файлі); смуга вибору лягає на шапку й таблицю не зсуває
        drag(&mut h, y_hero, y_mage, egui::Modifiers::NONE);
        let (_, y_after) = mid(&h, "Hero");
        assert_eq!(y_after, y_hero, "смуга «вибрано» не зсуває рядки");
        h.get_by_label("Скасувати вибір");
        h.get_by_label("З пам’яті вибрані");
        let mut got: Vec<usize> = h.state().checked.1.iter().copied().collect();
        got.sort();
        assert_eq!(got, [0, 1, 2], "{:?}", h.state().checked);
        // нове протягування без Ctrl замінює виділене, з Ctrl — додає
        drag(&mut h, y_wise, y_wise - 1.0, egui::Modifiers::NONE);
        let mut got: Vec<usize> = h.state().checked.1.iter().copied().collect();
        got.sort();
        assert_eq!(got, [0, 1, 2, 3], "рух менший за поріг — клацання: лише перемикає рядок, не замінює виділене: {:?}", h.state().checked);
        h.state_mut().checked.1.clear();
        drag(&mut h, y_hero, y_mage, egui::Modifiers::NONE);
        drag(&mut h, y_wise, y_wise + 20.0, egui::Modifiers::CTRL);
        let mut got: Vec<usize> = h.state().checked.1.iter().copied().collect();
        got.sort();
        assert_eq!(got, [0, 1, 2, 3], "з Ctrl додається до виділеного: {:?}", h.state().checked);
        assert!(h.state().drag_sel.is_none(), "відпустили — протягування скінчилось");
    }

    /// Біля верхнього й нижнього краю таблиці вона листається сама, тим швидше, чим ближче вказівник до краю (як у вебі: зона 48, крок 6 + до 30).
    #[test]
    fn the_table_scrolls_by_itself_near_its_edges_while_dragging() {
        let step = |y: f32| layout::drag_scroll_step(y, 100.0, 500.0);
        assert_eq!(step(300.0), None, "посередині таблиця стоїть");
        assert_eq!(step(452.0), None, "на межі зони ще стоїть");
        assert_eq!(step(476.0), Some(21.0), "половина зони — 6 + 15");
        assert_eq!(step(500.0), Some(36.0), "край — найшвидше");
        assert_eq!(step(560.0), Some(36.0), "за краєм швидкість не росте");
        assert_eq!(step(124.0), Some(-21.0));
        assert_eq!(step(100.0), Some(-36.0));
    }

    /// «З пам’яті» на вибраних рядках: порожній рядок отримує найближчий збіг (від 70 %) із пам’яті перекладів, переведений рядок не чіпається; дію можна скасувати.
    #[test]
    fn the_bulk_memory_button_fills_empty_selected_rows_from_the_memory() {
        let data = game("bulkmem");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.import_memory("Mage\tМаг\nWise\tМудрий");
        let mage = app.st.views[0].units.iter().position(|u| u.source == "Mage").unwrap();
        let wise = app.st.views[0].units.iter().position(|u| u.source == "Wise").unwrap();
        let hero = app.st.views[0].units.iter().position(|u| u.source == "Hero").unwrap();
        app.st.edit(0, wise, "Мудрець");
        let rows: std::collections::HashSet<usize> = [mage, wise, hero].into_iter().collect();
        let msg = app.st.bulk_memory(0, &rows);
        assert_eq!(msg, "Підставлено з пам’яті: 1", "{msg}");
        assert_eq!(app.st.target_of(0, mage), "Маг");
        assert_eq!(app.st.target_of(0, wise), "Мудрець", "переклад уже був — не чіпаємо");
        assert_eq!(app.st.target_of(0, hero), "", "збігу в пам’яті немає");
        assert_eq!(app.st.bulk_memory(0, &rows), "Збігів від 70% для порожніх вибраних рядків немає");
        app.st.undo_last();
        assert_eq!(app.st.target_of(0, mage), "", "«Скасувати» повертає порожній рядок");
    }

    /// Таблиця прокручується до вибраного рядка, коли той далеко: F8, пошук, стрілки; рядок, що вже видно, не стрибає. Файл відкривається на рядку, де його покинули.
    #[test]
    fn the_table_follows_the_selected_row_and_a_file_reopens_where_it_was_left() {
        // чистий розрахунок: у вікні 360 (10 рядків по 36) зі зсувом 720 видно рядки 20–29
        assert_eq!(layout::scroll_to_row(25, 720.0, 360.0), None, "рядок у вікні");
        assert_eq!(layout::scroll_to_row(30, 720.0, 360.0), Some(31.0 * 36.0 - 360.0), "поруч знизу — рівно до краю");
        assert_eq!(layout::scroll_to_row(19, 720.0, 360.0), Some(19.0 * 36.0), "поруч зверху — рівно до краю");
        assert_eq!(layout::scroll_to_row(500, 720.0, 360.0), Some(497.0 * 36.0), "далеко — три рядки від верху");
        assert_eq!(layout::scroll_to_row(1, 7200.0, 360.0), Some(0.0));
        // у застосунку: файл на 200 рядків, F8-перехід на 150-й рядок
        let base = std::env::temp_dir().join(format!("transly-ui-follow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let items: Vec<String> = (1..=200).map(|i| format!(r#"{{"id":{i},"name":"Item{i:03}","description":"","note":""}}"#)).collect();
        std::fs::write(data.join("Items.json"), format!("[null,{}]", items.join(","))).unwrap();
        std::fs::write(data.join("Actors.json"), r#"[null,{"id":1,"name":"Hero","nickname":"","profile":"Brave","note":""}]"#).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let items_f = app.st.views.iter().position(|v| v.name.starts_with("Items")).unwrap();
        let actors_f = app.st.views.iter().position(|v| v.name.starts_with("Actors")).unwrap();
        app.st.file = Some(items_f);
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        assert!(h.query_by_label_contains("Item150").is_none(), "далекий рядок поза вікном");
        h.state_mut().st.row = Some(149);
        h.run();
        h.run();
        h.get_by_label_contains("Item150");
        // рядок 150 вибрано, пішли в інший файл і повернулись: рядок той самий
        h.state_mut().st.switch_file(actors_f);
        h.state_mut().st.remember_row();
        h.run();
        assert_eq!(h.state().st.row, None, "в іншого файлу своєї пам’яті ще немає");
        h.state_mut().st.switch_file(items_f);
        assert_eq!(h.state().st.row, Some(149), "файл відкрився на рядку, де його покинули");
        h.run();
        h.run();
        h.get_by_label_contains("Item150");
    }

    /// «Поширити переклад…» відкриває діалог «Зв’язані рядки»: рядки групи з галочками, «Оновити вибрані» пише еталон лише в позначені; одна дія журналу.
    #[test]
    fn the_links_dialog_spreads_the_reference_to_the_ticked_rows_only() {
        let base = std::env::temp_dir().join(format!("transly-ui-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |t: &str| format!(r#"{{"conditions":{{}},"list":[{},{},{}],"trigger":0}}"#, cmd(101, r#""",0,0,2"#), cmd(401, &format!("\"{t}\"")), cmd(0, ""));
        let ev = |id: i64| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page("Welcome to the village, traveler"));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{},{},{}]}}"#, ev(1), ev(2), ev(3))).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let f = app.st.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let rows: Vec<usize> = (0..app.st.row_count(f)).filter(|r| app.st.source_of(f, *r) == "Welcome to the village, traveler").collect();
        let mut v = app.st.settings_view().unwrap();
        v.link_mode = "off".into();
        app.st.apply_settings(&v);
        // жоден рядок ще не надіслано — діалог каже, чому його немає
        app.open_links("Map001.json", &app.st.key_of(f, rows[0]));
        assert!(app.links_win.is_none());
        assert_eq!(app.message, "Для цих рядків немає чого поширювати: жоден не надіслано");
        app.st.submit(f, rows[0], "Ласкаво просимо, мандрівнику").unwrap();
        app.open_links("Map001.json", &app.st.key_of(f, rows[0]));
        assert_eq!(app.links_win.as_ref().map(|w| w.sync.items.len()), Some(2));
        let mut h = harness(app);
        h.run();
        let boxes = h.get_all_by_label("Оновити Map001").count();
        assert_eq!(boxes, 2, "два рядки до оновлення");
        h.get_by_label_contains("Вибрано 2 з 2");
        // знімаємо позначку з першого з двох: оновиться лише другий
        h.get_all_by_label("Оновити Map001").next().unwrap().click();
        h.run();
        h.get_by_label_contains("Вибрано 1 з 2");
        h.get_by_label("Оновити вибрані").click();
        h.run();
        assert!(h.state().links_win.is_none(), "діалог закрився");
        assert_eq!(h.state().message, "Оновлено зв’язані рядки: 1");
        let filled = rows.iter().filter(|r| h.state().st.target_of(f, **r) == "Ласкаво просимо, мандрівнику").count();
        assert_eq!(filled, 2, "еталон і один оновлений рядок; третій лишився порожнім");
        assert!(!h.state_mut().st.undo_last().is_empty());
        let filled = rows.iter().filter(|r| h.state().st.target_of(f, **r) == "Ласкаво просимо, мандрівнику").count();
        assert_eq!(filled, 1, "«Скасувати» повертає оновлений рядок");
    }

    /// Знімок діалогу «Зв’язані рядки»: `TRANSLY_SHOTS=<тека> cargo test -p transly-app links_shot -- --ignored`.
    #[test]
    #[ignore]
    fn links_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let base = std::env::temp_dir().join(format!("transly-ui-linksshot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |t: &str| format!(r#"{{"conditions":{{}},"list":[{},{},{}],"trigger":0}}"#, cmd(101, r#""",0,0,2"#), cmd(401, &format!("\"{t}\"")), cmd(0, ""));
        let ev = |id: i64| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page("Welcome to the village, traveler"));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{},{},{}]}}"#, ev(1), ev(2), ev(3))).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let f = app.st.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let rows: Vec<usize> = (0..app.st.row_count(f)).filter(|r| app.st.source_of(f, *r) == "Welcome to the village, traveler").collect();
        let mut v = app.st.settings_view().unwrap();
        v.link_mode = "off".into();
        app.st.apply_settings(&v);
        app.st.edit(f, rows[1], "Ласкаво просимо, подорожній");
        app.st.submit(f, rows[0], "Ласкаво просимо, мандрівнику").unwrap();
        app.st.row = Some(rows[0]);
        app.open_links("Map001.json", &app.st.key_of(f, rows[0]));
        let mut h = harness(app);
        h.run();
        h.render().unwrap().save(dir.join("24-links-dialog.png")).unwrap();
    }

    /// Команди вікна, які застосунок надіслав за останній кадр.
    fn window_commands(h: &Harness<'static, App>) -> Vec<egui::ViewportCommand> {
        h.output().viewport_output.get(&egui::ViewportId::ROOT).map(|v| v.commands.clone()).unwrap_or_default()
    }

    /// Власний заголовок вікна: три кнопки на правому краю (36/36/40 × 28, проміжок 2, по центру панелі заввишки 40), решта панелі не заходить на них;
    /// кнопки шлють команди вікна, у розгорнутому вікні друга стає «Відновити розмір»; порожнє місце панелі тягне вікно, подвійний клік розгортає.
    #[test]
    fn the_window_has_its_own_minimize_maximize_and_close_buttons() {
        let mut h = harness(App::default());
        h.run();
        let rect = |h: &Harness<'static, App>, label: &str| {
            let b = h.get_by_label(label).bounding_box().unwrap();
            (b.x0 as f32, b.y0 as f32, b.x1 as f32, b.y1 as f32)
        };
        let (close, max, min) = (rect(&h, "Закрити вікно"), rect(&h, "Розгорнути вікно"), rect(&h, "Згорнути вікно"));
        assert_eq!(close, (1320.0, 6.0, 1360.0, 34.0), "закрити 40×28 до самого краю");
        assert_eq!(max, (1282.0, 6.0, 1318.0, 34.0), "розгорнути 36×28, проміжок 2");
        assert_eq!(min, (1244.0, 6.0, 1280.0, 34.0));
        // решта панелі закінчується до кнопок: найправіша кнопка «Гарячі клавіші» не далі за 1360 − 128
        let keys = rect(&h, "Гарячі клавіші");
        assert!(keys.2 <= 1360.0 - winchrome::WCTL_W + 0.5, "{keys:?}");
        // кнопки шлють команди вікна
        h.get_by_label("Згорнути вікно").click();
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Minimized(true)), "{:?}", window_commands(&h));
        h.get_by_label("Розгорнути вікно").click();
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Maximized(true)));
        h.get_by_label("Закрити вікно").click();
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Close));
        // у розгорнутому вікні — «Відновити розмір»
        h.input_mut().viewports.entry(egui::ViewportId::ROOT).or_default().maximized = Some(true);
        h.run();
        h.get_by_label("Відновити розмір вікна").click();
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Maximized(false)));
        h.input_mut().viewports.entry(egui::ViewportId::ROOT).or_default().maximized = Some(false);
        h.run();
        // тягнемо порожнє місце верхньої панелі: вікно починає рух; подвійний клік розгортає
        let p = pos2(1000.0, 20.0);
        h.input_mut().events.push(egui::Event::PointerMoved(p));
        h.step();
        h.input_mut().events.push(egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed: true, modifiers: egui::Modifiers::NONE });
        h.step();
        h.input_mut().events.push(egui::Event::PointerMoved(pos2(1030.0, 30.0)));
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::StartDrag), "{:?}", window_commands(&h));
        h.input_mut().events.push(egui::Event::PointerButton { pos: pos2(1030.0, 30.0), button: egui::PointerButton::Primary, pressed: false, modifiers: egui::Modifiers::NONE });
        h.step();
        // системний заголовок: кнопок і смуги немає, команда повертає системну рамку
        h.state_mut().chrome_own = true;
        let ctx = h.ctx.clone();
        h.state_mut().toggle_chrome(&ctx);
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Decorations(true)), "{:?}", window_commands(&h));
        h.run();
        assert!(h.query_by_label("Закрити вікно").is_none());
        h.state_mut().toggle_chrome(&ctx);
        h.step();
        assert!(window_commands(&h).contains(&egui::ViewportCommand::Decorations(false)), "{:?}", window_commands(&h));
        h.run();
        h.get_by_label("Закрити вікно");
    }

    /// Краї вікна без системної рамки: на межі 5 px — сторона, у кутах 12 px — кут; всередині нічого.
    #[test]
    fn the_window_edges_pick_the_direction_to_resize() {
        use egui::ResizeDirection as D;
        let win = Rect::from_min_size(pos2(0.0, 0.0), vec2(1000.0, 600.0));
        let at = |x: f32, y: f32| winchrome::edge_at(win, pos2(x, y));
        assert_eq!(at(500.0, 300.0), None);
        assert_eq!(at(500.0, 2.0), Some(D::North));
        assert_eq!(at(500.0, 598.0), Some(D::South));
        assert_eq!(at(2.0, 300.0), Some(D::West));
        assert_eq!(at(998.0, 300.0), Some(D::East));
        assert_eq!(at(2.0, 2.0), Some(D::NorthWest));
        assert_eq!(at(998.0, 2.0), Some(D::NorthEast));
        assert_eq!(at(2.0, 598.0), Some(D::SouthWest));
        assert_eq!(at(998.0, 598.0), Some(D::SouthEast));
        assert_eq!(at(2.0, 8.0), Some(D::NorthWest), "поруч із кутом на боковому краї — теж кут");
        assert_eq!(at(8.0, 2.0), Some(D::NorthWest));
        assert_eq!(at(7.0, 300.0), None, "далі за 5 px від краю вже не край");
    }

    /// Знімок верхньої панелі з власними кнопками вікна: `TRANSLY_SHOTS=<тека> cargo test -p transly-app window_shot -- --ignored`.
    #[test]
    #[ignore]
    fn window_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let data = game("winshot");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        let mut h = harness(app);
        h.run();
        h.get_by_label("Розгорнути вікно").hover();
        h.run();
        h.render().unwrap().save(dir.join("25-window-controls.png")).unwrap();
    }

    /// Примітки QA файлу після правки одного рядка перевіряються лише для нього (повна перевірка файлу на 100 тис. рядків — секунди); результат той самий,
    /// що й після повної перевірки; зміна термінів чи налаштувань скидає кеш.
    #[test]
    fn file_issues_after_a_single_edit_match_a_full_check() {
        let (mut app, hero, mage) = bell_game();
        let rows = |app: &App| -> Vec<(usize, bool)> { app.st.file_issues(0).iter().map(|i| (i.0, i.2)).collect() };
        assert_eq!(rows(&app), [(hero, true)], "«Герой» без керівних кодів — помилка");
        // правка іншого рядка: кеш лишається, помилка героя на місці
        app.st.edit(0, mage, "Чаклун");
        assert_eq!(rows(&app), [(hero, true)]);
        // виправили сам рядок з помилкою: примітка зникла
        app.st.edit(0, hero, "\\C[2]Герой\\C[0]");
        assert!(rows(&app).is_empty(), "{:?}", rows(&app));
        // знову зламали: повернулась
        app.st.edit(0, hero, "Герой");
        assert_eq!(rows(&app), [(hero, true)]);
        // порівняння з повною перевіркою з нуля (кеш скинуто зміною версії не через put)
        let incremental = app.st.file_issues(0);
        app.st.rev += 1;
        assert_eq!(app.st.file_issues(0), incremental, "інкрементальний результат дорівнює повному");
    }

    /// Чип «Автословник»: пари, виведені з надісланих рядків, з картками «Додати» / «Показати N» / «Не зараз»; «Додати всі певні» додає впевнені пари, «Скасувати» прибирає їх.
    #[test]
    fn the_auto_dictionary_chip_offers_learned_pairs() {
        let app = construction_game("autodict");
        warm_usage(&app);
        let mut h = harness(app);
        h.state_mut().rail = 3;
        h.run();
        h.get_by_label("Вид записів: Автословник").click();
        h.run();
        assert_eq!(h.state().gl_show, 6);
        // «take» передано «Зніми» у всіх п'яти рядках: впевнена пара
        let (dict, idx, _) = h.state().st.auto_candidates();
        let take = idx.iter().map(|i| &dict.pairs[*i]).find(|p| p.key == "take").expect("take → зніми");
        assert_eq!((take.rows, take.sure()), (5, true), "{take:?}");
        h.get_by_label_contains("Додати: take → ").click();
        h.run();
        assert_eq!(h.state().st.terms().len(), 1, "запис додано в глосарій");
        // слово вже в глосарії — з пропозицій зникло
        let (_, idx2, _) = h.state().st.auto_candidates();
        assert!(!idx2.iter().any(|i| h.state().st.auto_dict().0.pairs[*i].key == "take"));
        // «Не зараз» ховає назавжди (для проєкту)
        h.state_mut().st.dismiss("auto", "thing");
        assert!(h.state().st.is_dismissed("auto", "thing"));
    }

    /// «Додати всі певні» додає всі впевнені пари одним рухом, «Скасувати» повертає глосарій як було.
    #[test]
    fn adding_all_sure_pairs_can_be_undone() {
        let mut app = construction_game("autosure");
        warm_usage(&app);
        let done = app.st.auto_add_sure();
        assert!(done.contains(&"take".to_string()), "{done:?}");
        let n = app.st.terms().len();
        assert_eq!(n, done.len());
        assert_eq!(app.st.auto_undo(&done), n);
        assert!(app.st.terms().is_empty(), "після «Скасувати» записів нема: {:?}", app.st.terms());
    }

    /// Вивчена пара в рядку: нитка до слова перекладу (з відмінками); у «Пов'язаному» — фішка «Вивчено: …» з «→ У глосарій»; коли перекладу слова немає, під полем
    /// з'являється сторож узгодженості, «Не питати про це слово» його вимикає.
    #[test]
    fn a_learned_pair_gets_a_thread_a_chip_and_a_consistency_guard() {
        let mut app = construction_game("threads");
        warm_usage(&app);
        let ring = (0..app.st.row_count(0)).find(|r| app.st.source_of(0, *r) == "Take the ring off").unwrap();
        app.st.row = Some(ring);
        app.focus = true;
        // «Зніми каблучку»: слово take → зніми знайдено в перекладі
        let th = app.st.learned_threads(0, ring, "Зніми каблучку");
        let t = th.iter().find(|t| t.key == "take").expect("нитка take");
        assert_eq!((t.src, t.dst, t.sure), ((0, 4), Some((0, 5)), true), "{t:?}");
        // «Бери каблучку»: слова нема
        let th = app.st.learned_threads(0, ring, "Бери каблучку");
        assert_eq!(th.iter().find(|t| t.key == "take").unwrap().dst, None);
        let mut h = harness(app);
        h.state_mut().draft = "Зніми каблучку".into();
        h.state_mut().draft_for = Some((0, ring));
        h.run();
        h.get_by_label("Вивчено: take → зніми");
        assert!(h.query_by_label_contains("У вас «take» зазвичай").is_none(), "слово є — сторожа нема");
        h.state_mut().draft = "Бери каблучку".into();
        h.run();
        h.get_by_label_contains("У вас «take» зазвичай «зніми» (5 з 5 рядків)");
        h.get_by_label("Лишити так").click();
        h.run();
        assert!(h.query_by_label_contains("У вас «take» зазвичай").is_none(), "«Лишити так» ховає підказку для цього рядка");
        h.state_mut().guard_off.clear();
        h.run();
        h.get_by_label("Не питати про це слово").click();
        h.run();
        assert!(h.state().st.is_dismissed("guard", "take"));
        assert!(h.query_by_label_contains("У вас «take» зазвичай").is_none());
    }

    /// Примарні пов'язані рядки замість чернеток: у порожній клітинці сірий переклад із підписом, Tab приймає й веде далі, «Прийняти примари (N)» — усі однакові оригінали
    /// файлу одним записом журналу; «Скасувати» повертає порожні рядки. У проєкт примара не пишеться, у відсотки не рахується.
    #[test]
    fn ghost_rows_replace_drafts_and_are_accepted_with_tab_or_in_bulk() {
        let base = std::env::temp_dir().join(format!("transly-ui-ghosts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |t: &str| format!(r#"{{"conditions":{{}},"list":[{},{},{}],"trigger":0}}"#, cmd(101, r#""",0,0,2"#), cmd(401, &format!("\"{t}\"")), cmd(0, ""));
        let ev = |id: i64| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page("Welcome to the village, traveler"));
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"T","events":[null,{},{},{},{}]}}"#, ev(1), ev(2), ev(3), ev(4))).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let f = app.st.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let rows: Vec<usize> = (0..app.st.row_count(f)).filter(|r| app.st.source_of(f, *r) == "Welcome to the village, traveler").collect();
        assert_eq!(rows.len(), 4);
        app.st.submit(f, rows[0], "Ласкаво просимо до села, мандрівнику").unwrap();
        app.st.file = Some(f);
        app.st.row = Some(rows[1]);
        let before = app.st.progress();
        assert_eq!(app.st.twin_ghost_count(f), 3, "три порожні двійники мають примару");
        let mut h = harness(app);
        h.run();
        // у таблиці: рядок з примарою називається «… — примара: …» і є кнопка «Прийняти примари (3)»
        assert_eq!(h.get_all_by_label_contains("— примара: Ласкаво просимо до села, мандрівнику").count(), 3, "три рядки з примарою");
        h.get_by_label("Прийняти примари (3)");
        assert_eq!(h.state().st.progress(), before, "примари не рахуються у відсотках");
        assert!(h.state().st.target_of(f, rows[1]).is_empty());
        // Tab на вибраному рядку приймає примару й веде до наступного рядка
        h.input_mut().events.push(egui::Event::Key { key: egui::Key::Tab, physical_key: None, pressed: true, repeat: false, modifiers: egui::Modifiers::NONE });
        h.step();
        h.run();
        assert_eq!(h.state().st.target_of(f, rows[1]), "Ласкаво просимо до села, мандрівнику");
        assert_eq!(h.state().st.row.map(|r| r > rows[1]), Some(true), "перейшли далі");
        // «Прийняти примари» заповнює решту одним записом
        h.get_by_label_contains("Прийняти примари (2)").click();
        h.run();
        assert_eq!(rows.iter().filter(|r| !h.state().st.target_of(f, **r).is_empty()).count(), 4);
        assert_eq!(h.state().st.twin_ghost_count(f), 0);
        // один запис журналу: «Скасувати» повертає ті два, а не лише останній
        h.state_mut().st.undo_last();
        assert_eq!(rows.iter().filter(|r| !h.state().st.target_of(f, **r).is_empty()).count(), 2);
    }

    /// Примара з пам'яті перекладів: порожній рядок, схожий на перекладені (від 80 %), показує найближчий переклад із підписом «пам'ять N %»; без збігу примари нема.
    #[test]
    fn a_close_memory_match_becomes_a_ghost() {
        use state::GhostFrom;
        let mut app = construction_game("memghost");
        let ring = (0..app.st.row_count(0)).find(|r| app.st.source_of(0, *r) == "Take the ring off").unwrap();
        app.st.edit(0, ring, "");
        assert_eq!(app.st.row_view(0, ring).2, RowStatus::Untranslated);
        app.st.begin_frame();
        // описи інших предметів («Take the hat off», 76 %) нижчі за поріг 80 %: примари нема
        assert!(app.st.ghost_of(0, ring).is_none(), "76 % — ще не примара");
        app.st.import_memory("Take the ring off now\tЗніми каблучку зараз");
        app.st.begin_frame();
        let g = app.st.ghost_of(0, ring).expect("примара з пам'яті");
        assert_eq!(g.text, "Зніми каблучку зараз");
        let GhostFrom::Memory(score) = g.from else { panic!("{g:?}") };
        assert!((80..100).contains(&score), "{score}");
        assert_eq!(g.label("Items.json"), format!("пам’ять {score} %"));
        // назва предмета («Thing 3») на перекладені описи не схожа: примари нема
        let thing = (0..app.st.row_count(0)).find(|r| app.st.source_of(0, *r) == "Thing 3").unwrap();
        assert!(app.st.ghost_of(0, thing).is_none());
        // прийняли: чернетка, а примари більше нема
        assert!(app.st.accept_ghost(0, ring));
        assert!(app.st.ghost_of(0, ring).is_none());
        assert_eq!(app.st.row_view(0, ring).2, RowStatus::Draft);
    }

    /// Підказки пам'яті після правки одного рядка: індекс міняє одну пару (а не будується з нуля), і результат той самий, що після повної перебудови;
    /// стара пара правленого рядка підказкою не лишається.
    #[test]
    fn the_memory_index_follows_single_edits_without_a_rebuild() {
        let app = construction_game("tmfollow");
        let mut app = app;
        let desc = |app: &App, word: &str| (0..app.st.row_count(0)).find(|r| app.st.source_of(0, *r) == format!("Take the {word} off")).unwrap();
        let (ring, hat) = (desc(&app, "ring"), desc(&app, "hat"));
        let texts = |app: &App, r: usize| -> Vec<String> { app.st.tm_matches(0, r).into_iter().map(|m| m.t).collect() };
        // «hat» бачить переклад «ring» як підказку
        assert!(texts(&app, hat).contains(&"Зніми каблучку".to_string()), "{:?}", texts(&app, hat));
        // «ring» перекладено інакше: нова пара є, стара зникла — без повної перебудови (кеш пам'яті лишився вірним)
        app.st.edit(0, ring, "Зніми перстень");
        let after = texts(&app, hat);
        assert!(after.contains(&"Зніми перстень".to_string()) && !after.contains(&"Зніми каблучку".to_string()), "{after:?}");
        // повна перебудова (версія змін зросла не через put) дає те саме
        app.st.rev += 1;
        assert_eq!(texts(&app, hat), after, "інкрементальний індекс дорівнює повному");
        // порожній переклад прибирає пару
        app.st.edit(0, ring, "");
        assert!(!texts(&app, hat).contains(&"Зніми перстень".to_string()));
    }

    /// Вимір на великому проєкті (100 тис. рядків): скільки забирають сповіщення й пошук конструкцій. `cargo test -p transly-app --release big_inbox -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn big_inbox_timing() {
        let base = std::env::temp_dir().join(format!("transly-ui-big-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let items: Vec<String> = (1..=50000).map(|i| format!(r#"{{"id":{i},"name":"Thing number {i}","description":"Take the thing {i} off carefully","note":""}}"#)).collect();
        std::fs::write(data.join("Items.json"), format!("[null,{}]", items.join(","))).unwrap();
        let mut app = App::default();
        let t = std::time::Instant::now();
        app.st.open_game(&data).unwrap();
        println!("  відкрито: {} рядків за {:.2} с", app.st.row_count(0), t.elapsed().as_secs_f32());
        let t = std::time::Instant::now();
        for r in (0..app.st.row_count(0)).step_by(3) {
            app.st.edit(0, r, "Переклад рядка");
        }
        println!("  3-й кожен рядок переведено за {:.2} с", t.elapsed().as_secs_f32());
        let t = std::time::Instant::now();
        let mut steps = 0;
        while app.st.inbox_step(std::time::Duration::from_millis(6)).is_some() {
            steps += 1;
        }
        println!("  сповіщення: {steps} кадрів по 6 мс, разом {:.2} с, пунктів {}", t.elapsed().as_secs_f32(), app.st.inbox.items.len());
        let t = std::time::Instant::now();
        let mut n = 0;
        loop {
            let (list, running) = app.st.mine_cards();
            if !running {
                println!("  конструкції: {} пропозицій", list.len());
                break;
            }
            n += 1;
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        println!("  фоновий пошук конструкцій: {:.2} с ({n} опитувань)", t.elapsed().as_secs_f32());
        // що рахується щокадру, поки вибрано рядок: «Пов'язане» питає про двійників рядка (індекс будується раз, далі береться з кешу)
        let t = std::time::Instant::now();
        let _ = app.st.link_info(0, 10);
        let first = t.elapsed().as_secs_f32() * 1000.0;
        let t = std::time::Instant::now();
        for _ in 0..100 {
            let _ = app.st.link_info(0, 10);
        }
        println!("  link_info (двійники вибраного рядка): перший виклик {first:.0} мс, далі {:.3} мс", t.elapsed().as_secs_f32() * 10.0);
        // що з відомого стану коштує щокадру (вдруге й далі, коли кеші вже є)
        macro_rules! cost {
            ($name:expr, $e:expr) => {{
                let _ = $e;
                let t = std::time::Instant::now();
                for _ in 0..5 {
                    let _ = $e;
                }
                let ms = t.elapsed().as_secs_f32() * 200.0;
                if ms > 0.5 {
                    println!("  щокадру {}: {ms:.1} мс", $name);
                }
            }};
        }
        {
            let s = &app.st;
            let f = 0;
            cost!("progress", s.progress());
            cost!("file_progress", s.file_progress());
            cost!("filter_counts", s.filter_counts(f));
            cost!("visible_len", s.visible_len(f));
            cost!("file_has_speakers", s.file_has_speakers(f));
            cost!("file_speakers", s.file_speakers(f));
            cost!("file_issues", s.file_issues(f));
            cost!("tm_matches", s.tm_matches(f, 500));
            cost!("issues", s.issues(f, 500, ""));
            cost!("strands", s.strands(f, 500));
            cost!("game_names_in", s.game_names_in(f, 500));
            cost!("link_flags", s.link_flags(f, 500));
            cost!("history", s.history(f, 500));
            cost!("threads", s.threads(f, 500));
            cost!("contributions", s.contributions(f, 500));
            cost!("references_of", s.references_of(f, 500));
            cost!("activity", s.activity());
            cost!("last_build", s.last_build());
            cost!("map_title", s.map_title(f));
            cost!("kind_label", s.kind_label(f, 500));
            cost!("source_marks", s.source_marks(f, 500));
            cost!("scenes_list", s.scenes_list(f));
            cost!("scene_view", s.scene_view(f, 500));
            cost!("glossary_terms", s.glossary_terms());
            cost!("link_group_count", s.link_group_count());
            cost!("groups_view", s.groups_view());
            cost!("qa_keep", s.qa_keep());
        }
        // кадр інтерфейсу на цьому проєкті: таблиця, редагування, праві розділи й ліва панель глосарія
        app.st.row = Some(500);
        let mut h = harness(app);
        h.state_mut().focus = false;
        let frame = |h: &mut Harness<'static, App>, label: &str| {
            for _ in 0..3 {
                h.step();
            }
            let t = std::time::Instant::now();
            for _ in 0..10 {
                h.step();
            }
            println!("  кадр «{label}»: {:.0} мс", t.elapsed().as_secs_f32() * 100.0);
        };
        frame(&mut h, "таблиця, ліва — файли");
        // що відбувається після правки одного рядка (Enter у клітинці): версія змін зросла, кеші по всіх рядках скинуто; що саме дорого
        {
            macro_rules! after_edit {
                ($name:expr, $e:expr) => {{
                    h.state_mut().st.edit(0, 600, &format!("Правка для {}", $name));
                    let t = std::time::Instant::now();
                    let _ = $e;
                    println!("  після правки {}: {:.0} мс", $name, t.elapsed().as_secs_f32() * 1000.0);
                }};
            }
            after_edit!("progress", h.state().st.progress());
            after_edit!("visible_len", h.state().st.visible_len(0));
            after_edit!("filter_counts", h.state().st.filter_counts(0));
            after_edit!("file_issues", h.state().st.file_issues(0).len());
            after_edit!("tm_matches", h.state().st.tm_matches(0, 500).len());
            after_edit!("file_progress", h.state().st.file_progress().len());
        }
        for round in 0..3 {
            h.state_mut().st.edit(0, 500 + round, &format!("Нова правка {round}"));
            let t = std::time::Instant::now();
            h.step();
            let first = t.elapsed().as_secs_f32() * 1000.0;
            let t = std::time::Instant::now();
            h.step();
            println!("  кадр одразу після правки: {first:.0} мс, наступний {:.0} мс", t.elapsed().as_secs_f32() * 1000.0);
        }
        h.state_mut().rail = 3;
        frame(&mut h, "таблиця, ліва — глосарій");
        h.state_mut().rail = 0;
        h.state_mut().focus = true;
        frame(&mut h, "редагування");
        // вікна поверх великого проєкту: що додає діалог і сторінки налаштувань до кадру
        h.state_mut().focus = false;
        h.state_mut().build_win = Some(h.state().st.build_defaults());
        frame(&mut h, "діалог «Збірка в гру»");
        h.state_mut().build_win = None;
        h.state_mut().qar_win = true;
        frame(&mut h, "діалог «Правила QA»");
        h.state_mut().qar_win = false;
        h.state_mut().find_win = Some(("Thing number 1".into(), "Предмет".into(), false, false));
        frame(&mut h, "діалог «Знайти й замінити» з текстом");
        h.state_mut().find_win = None;
        h.state_mut().activity_win = true;
        frame(&mut h, "діалог «Активність»");
        h.state_mut().activity_win = false;
        h.state_mut().wrap_win = Some((h.state().st.wrap_settings(), "Приклад довгого рядка для перевірки перенесення слів".into(), false));
        frame(&mut h, "діалог «Перенесення рядків»");
        h.state_mut().wrap_win = None;
        h.state_mut().spk_win = Some(h.state().st.speaker_candidates());
        frame(&mut h, "діалог «Мовці»");
        h.state_mut().spk_win = None;
        h.state_mut().groups_win = Some(String::new());
        frame(&mut h, "діалог «Групи рядків»");
        h.state_mut().groups_win = None;
        h.state_mut().br_win = Some(String::new());
        frame(&mut h, "діалог «Гілки»");
        h.state_mut().br_win = None;
        h.state_mut().mine_win = true;
        frame(&mut h, "діалог «Конструкції»");
        h.state_mut().mine_win = false;
        h.state_mut().plugins_win = true;
        frame(&mut h, "діалог «Плагіни»");
        h.state_mut().plugins_win = false;
        h.state_mut().keys_win = true;
        frame(&mut h, "діалог «Гарячі клавіші»");
        h.state_mut().keys_win = false;
        h.state_mut().import_win = Some((0, String::new()));
        frame(&mut h, "діалог «Імпорт»");
        h.state_mut().import_win = None;
        h.state_mut().search_win = Some(("Thing number".into(), 0));
        frame(&mut h, "«Пошук скрізь» із запитом");
        h.state_mut().search_win = None;
        h.state_mut().fill_win = Some(h.state().st.autofill_proposals(500).into_iter().map(|p| (p, true)).collect());
        frame(&mut h, "діалог «Автозаповнення»");
        h.state_mut().fill_win = None;
        for page in ["look", "branches", "lang", "qa", "terms", "danger"] {
            h.state_mut().settings = h.state().st.settings_view();
            h.state_mut().nav_proj.cur = page;
            frame(&mut h, &format!("налаштування проєкту: {page}"));
        }
        h.state_mut().settings = None;
        h.state_mut().app_set = h.state().st.settings_view();
        h.state_mut().nav_app.cur = "general";
        frame(&mut h, "налаштування загальні");
        h.state_mut().app_set = None;
    }

    /// Знімок чипа «Автословник»: `TRANSLY_SHOTS=<тека> cargo test -p transly-app auto_shot -- --ignored`.
    #[test]
    #[ignore]
    fn auto_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let mut app = construction_game("autoshot");
        app.st.row = Some(0);
        warm_usage(&app);
        let mut h = harness(app);
        h.state_mut().rail = 3;
        h.state_mut().gl_show = 6;
        h.run();
        h.render().unwrap().save(dir.join("26-auto-dictionary.png")).unwrap();
    }

    /// Знімок редагування з вивченими нитками й сторожем: `TRANSLY_SHOTS=<тека> cargo test -p transly-app threads_shot -- --ignored`.
    #[test]
    #[ignore]
    fn threads_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let mut app = construction_game("threadsshot");
        warm_usage(&app);
        let ring = (0..app.st.row_count(0)).find(|r| app.st.source_of(0, *r) == "Take the ring off").unwrap();
        app.st.row = Some(ring);
        app.focus = true;
        let mut h = harness(app);
        h.state_mut().draft = "Зніми каблучку".into();
        h.state_mut().draft_for = Some((0, ring));
        h.run();
        let b = h.get_by_label_contains("Вивчено: take").bounding_box();
        let _ = b;
        h.render().unwrap().save(dir.join("27-threads-ok.png")).unwrap();
        h.state_mut().draft = "Бери каблучку".into();
        h.run();
        h.render().unwrap().save(dir.join("27-threads-guard.png")).unwrap();
    }

    /// Знімок примарних рядків у таблиці й редагуванні: `TRANSLY_SHOTS=<тека> cargo test -p transly-app ghost_shot -- --ignored`.
    #[test]
    #[ignore]
    fn ghost_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let base = std::env::temp_dir().join(format!("transly-ui-ghostshot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let data = base.join("MyGame").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let cmd = |code: i64, p: &str| format!(r#"{{"code":{code},"indent":0,"parameters":[{p}]}}"#);
        let page = |t: &str| format!(r#"{{"conditions":{{}},"list":[{},{},{}],"trigger":0}}"#, cmd(101, r#""",0,0,2"#), cmd(401, &format!("\"{t}\"")), cmd(0, ""));
        let ev = |id: i64, t: &str| format!(r#"{{"id":{id},"name":"EV{id}","x":1,"y":1,"pages":[{}]}}"#, page(t));
        let w = "Welcome to the village, traveler";
        std::fs::write(data.join("Map001.json"), format!(r#"{{"displayName":"Village","events":[null,{},{},{},{},{}]}}"#, ev(1, w), ev(2, "Where is the elder?"), ev(3, w), ev(4, "Take the ring off now"), ev(5, w))).unwrap();
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        let f = app.st.file_names().iter().position(|n| n == "Map001.json").unwrap();
        let rows: Vec<usize> = (0..app.st.row_count(f)).filter(|r| app.st.source_of(f, *r) == w).collect();
        app.st.submit(f, rows[0], "Ласкаво просимо до села, мандрівнику").unwrap();
        app.st.import_memory("Take the ring off\tЗніми каблучку");
        app.st.file = Some(f);
        app.st.row = Some(rows[1]);
        let mut h = harness(app);
        h.run();
        h.render().unwrap().save(dir.join("28-ghost-table.png")).unwrap();
        h.state_mut().focus = true;
        h.run();
        h.render().unwrap().save(dir.join("28-ghost-edit.png")).unwrap();
    }

    /// Діалоги не пересуваються: вони стоять по центру й затемнюють решту вікна (плаваючих вікон, які можна тягати, у застосунку немає).
    #[test]
    fn dialogs_are_fixed_and_cannot_be_dragged_around() {
        let data = game("fixeddlg");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.settings = app.st.settings_view();
        let mut h = harness(app);
        h.run();
        let title = |h: &Harness<'static, App>| {
            let b = h.get_by_label("Налаштування проєкту").bounding_box().unwrap();
            (b.x0 as f32, b.y0 as f32)
        };
        let (x0, y0) = title(&h);
        let from = pos2(x0 + 60.0, y0 + 8.0);
        h.input_mut().events.push(egui::Event::PointerMoved(from));
        h.step();
        h.input_mut().events.push(egui::Event::PointerButton { pos: from, button: egui::PointerButton::Primary, pressed: true, modifiers: egui::Modifiers::NONE });
        h.step();
        for k in 1..=4 {
            h.input_mut().events.push(egui::Event::PointerMoved(from + vec2(30.0 * k as f32, 20.0 * k as f32)));
            h.step();
        }
        h.input_mut().events.push(egui::Event::PointerButton { pos: from + vec2(120.0, 80.0), button: egui::PointerButton::Primary, pressed: false, modifiers: egui::Modifiers::NONE });
        h.step();
        h.run();
        assert_eq!(title(&h), (x0, y0), "діалог лишився на місці");
    }

    /// Діалог — як `.adlg` у вебі (числа знято з живого DOM у 1360×800: «Збірка» — вікно 640 по центру під верхньою панеллю 40; заголовок 15/500 у тілі з відступами 16×18,
    /// без «✕»; внизу рядок кнопок з лінією, нижній край кнопок — на 17 від краю вікна, кнопка «Закрити» ліворуч від головної).
    #[test]
    fn a_dialog_is_laid_out_like_the_web_adlg() {
        let data = game("adlg");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.build_win = Some(app.st.build_defaults());
        let mut h = harness(app);
        h.run();
        h.run();
        let r = h.ctx.memory(|m| m.area_rect(egui::Id::new(("dlg", "Збірка в гру")))).expect("діалог є");
        assert!((r.width() - 640.0).abs() < 1.5, "ширина 640, а є {}", r.width());
        assert!((r.center().x - 680.0).abs() < 1.0, "по центру вікна по горизонталі");
        // по центру частини під верхньою панеллю (40…800)
        assert!((r.center().y - 420.0).abs() < 1.5, "по центру під верхньою панеллю: {}", r.center().y);
        let t = h.get_by_label("Збірка в гру").bounding_box().unwrap();
        assert!((t.x0 as f32 - (r.left() + 19.0)).abs() < 1.0, "заголовок на 19 від краю (рамка 1 + поле 18): {}", t.x0 as f32 - r.left());
        assert!(t.y0 as f32 > r.top() + 17.0 && (t.y0 as f32) < r.top() + 24.0, "заголовок біля 17 від верху: {}", t.y0 as f32 - r.top());
        assert!(h.query_by_label("Закрити").is_some() && h.query_by_label("✕").is_none(), "кнопка внизу, ✕ немає");
        let cl = h.get_by_label("Закрити").bounding_box().unwrap();
        assert!((r.bottom() - cl.y1 as f32 - 19.0).abs() < 1.5, "низ кнопок на 19 від краю (1 + 16 + 2): {}", r.bottom() - cl.y1 as f32);
        assert!((cl.y1 - cl.y0 - 28.0).abs() < 0.6, "кнопка заввишки 28");
    }

    /// Вікно налаштувань — як `.adlg.st-dlg` у вебі (числа з живого DOM у 1360×800): «Налаштування» 900×640 у (230; 100), дерево 236, рядок дерева «Загальні» 219×28 на (9; 84,5) від кута,
    /// рядок кнопок внизу заввишки 49 (кнопки 28 на 601 від верху); «Налаштування проєкту» 900×700 у (230; 70).
    #[test]
    fn the_settings_dialog_is_laid_out_like_the_web_st_dlg() {
        let data = game("stdlg");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.app_set = app.st.settings_view();
        let mut h = harness(app);
        h.run();
        h.run();
        let r = h.ctx.memory(|m| m.area_rect(egui::Id::new(("st-dlg", "app")))).expect("вікно є");
        assert!((r.left() - 230.0).abs() < 1.0 && (r.top() - 100.0).abs() < 1.0, "вікно в (230; 100): {:?}", r.min);
        assert!((r.width() - 900.0).abs() < 1.0 && (r.height() - 640.0).abs() < 1.0, "900×640: {:?}", r.size());
        let ti = h.get_by_label("Загальні").bounding_box().unwrap();
        assert!((ti.x0 as f32 - (r.left() + 9.0)).abs() < 1.5 && (ti.y0 as f32 - (r.top() + 84.5)).abs() < 1.5, "рядок дерева на (9; 84,5): ({}; {})", ti.x0 as f32 - r.left(), ti.y0 as f32 - r.top());
        assert!((ti.x1 - ti.x0 - 219.0).abs() < 1.5 && (ti.y1 - ti.y0 - 28.0).abs() < 0.6, "219×28");
        let save = h.get_all_by_label("Зберегти").last().unwrap().bounding_box().unwrap();
        assert!((save.y0 as f32 - (r.top() + 601.0)).abs() < 1.5 && (save.y1 - save.y0 - 28.0).abs() < 0.6, "кнопки внизу: {}", save.y0 as f32 - r.top());
        assert!((save.x1 as f32 - (r.right() - 16.0 - 8.0 - 98.3 - 8.0 - 110.4)).abs() < 12.0, "«Зберегти» стоїть ліворуч від «Застосувати» і «Скасувати»: {}", save.x1 as f32);
        // налаштування проєкту: 900×700 і пласке дерево з підписами груп
        h.state_mut().app_set = None;
        h.state_mut().settings = h.state().st.settings_view();
        h.run();
        h.run();
        let p = h.ctx.memory(|m| m.area_rect(egui::Id::new(("st-dlg", "project")))).expect("вікно є");
        assert!((p.left() - 230.0).abs() < 1.0 && (p.top() - 70.0).abs() < 1.0 && (p.width() - 900.0).abs() < 1.0 && (p.height() - 700.0).abs() < 1.0, "900×700 у (230; 70): {:?} {:?}", p.min, p.size());
        let ti = h.get_by_label("Назва й вигляд").bounding_box().unwrap();
        assert!((ti.y0 as f32 - (p.top() + 84.5)).abs() < 1.5, "перша сторінка на 84,5 від верху (пошук і заголовок групи, як у загальних): {}", ti.y0 as f32 - p.top());
    }

    /// Високий діалог у низькому вікні: не вище «вікно − 64», тіло листається, а рядок кнопок лишається внизу вікна діалогу (`position: sticky` у вебі).
    #[test]
    fn a_tall_dialog_keeps_its_buttons_at_the_bottom() {
        let data = game("tall");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.qar_win = true;
        let mut h = Harness::builder().with_size(egui::vec2(1360.0, 420.0)).build_state(|ctx, app: &mut App| {
            theme::apply(ctx);
            app.frame(ctx);
        }, app);
        for _ in 0..4 {
            h.run();
        }
        let r = h.ctx.memory(|m| m.area_rect(egui::Id::new(("dlg", "Правила QA")))).expect("діалог є");
        assert!((r.height() - (420.0 - 64.0)).abs() < 1.5, "висота вікно − 64: {}", r.height());
        let cl = h.get_by_label("Закрити").bounding_box().unwrap();
        assert!(cl.y1 as f32 <= r.bottom() && (r.bottom() - cl.y1 as f32 - 3.0).abs() < 1.5, "кнопка внизу вікна діалогу: {} від низу", r.bottom() - cl.y1 as f32);
        // клік по «Закрити» закриває діалог
        h.get_by_label("Закрити").click();
        for _ in 0..4 {
            h.run();
        }
        assert!(!h.state().qar_win);
    }

    /// Поки відкрито діалог, кнопки вікна («Згорнути», «Розгорнути», «Закрити») лишаються над підложкою й працюють (у вебі вони над `.dlg-scrim`).
    #[test]
    fn the_window_buttons_stay_above_a_dialog() {
        let data = game("above");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.chrome_own = true;
        app.build_win = Some(app.st.build_defaults());
        let mut h = harness(app);
        h.run();
        h.run();
        for label in ["Згорнути вікно", "Розгорнути вікно", "Закрити вікно"] {
            let b = h.get_by_label(label).bounding_box().unwrap();
            let c = pos2((b.x0 + b.x1) as f32 / 2.0, (b.y0 + b.y1) as f32 / 2.0);
            let top = h.ctx.layer_id_at(c).expect("шар під вказівником");
            assert_eq!(top.order, egui::Order::Tooltip, "{label}: над підложкою діалогу, а шар {top:?}");
        }
    }

    /// Знімки діалогів для порівняння з веб-знімками (`web_dialogs.cjs`): `TRANSLY_FIXTURE=… TRANSLY_SHOTS=<тека> cargo test -p transly-app dialog_shots -- --ignored`.
    #[test]
    #[ignore]
    fn dialog_shots() {
        let (Some(fix), Some(out)) = (std::env::var_os("TRANSLY_FIXTURE").map(std::path::PathBuf::from), std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from)) else { return };
        std::fs::create_dir_all(&out).unwrap();
        let mut app = App::default();
        app.st.open_game(&fix.join("ParityGame").join("data")).unwrap();
        app.st.open_project_file(&fix.join("project.json")).unwrap();
        let mut h = harness(app);
        let shot = |h: &mut Harness<'static, App>, n: &str| {
            h.run();
            h.run();
            h.render().unwrap().save(out.join(format!("{n}.png"))).unwrap();
        };
        h.state_mut().build_win = Some(h.state().st.build_defaults());
        shot(&mut h, "d1-build");
        h.state_mut().build_win = None;
        h.state_mut().find_win = Some(Default::default());
        shot(&mut h, "d2-find");
        h.state_mut().find_win = None;
        h.state_mut().activity_win = true;
        shot(&mut h, "d3-activity");
        h.state_mut().activity_win = false;
        h.state_mut().qar_win = true;
        shot(&mut h, "d4-qa");
        h.set_size(egui::vec2(1360.0, 420.0));
        shot(&mut h, "d5-qa-short");
        h.set_size(egui::vec2(1360.0, 800.0));
        h.state_mut().qar_win = false;
        for (n, page) in [("d6-proj-look", "look"), ("d7-proj-branches", "branches"), ("d8-proj-danger", "danger"), ("d12-proj-lang", "lang"), ("d13-proj-qa", "qa")] {
            h.state_mut().settings = h.state().st.settings_view();
            h.state_mut().nav_proj.cur = page;
            shot(&mut h, n);
        }
        h.state_mut().settings = None;
        for (n, page) in [("d9-app-general", "general"), ("d10-app-look", "look"), ("d11-app-server", "server")] {
            h.state_mut().app_set = h.state().st.settings_view();
            h.state_mut().nav_app.cur = page;
            shot(&mut h, n);
        }
    }

    /// Знімок таблиці з виділеними рядками (смуга «вибрано» на шапці): `TRANSLY_SHOTS=<тека> cargo test -p transly-app bulk_shot -- --ignored`.
    #[test]
    #[ignore]
    fn bulk_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let data = game("bulkshot");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.row = Some(0);
        app.checked = (0, [0usize, 1].into_iter().collect());
        let mut h = harness(app);
        h.run();
        h.render().unwrap().save(dir.join("23-bulk-bar.png")).unwrap();
    }

    /// Знімок відкритого списку сповіщень: `TRANSLY_SHOTS=<тека> cargo test -p transly-app bell_shot -- --ignored`.
    #[test]
    #[ignore]
    fn bell_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let (mut app, _, _) = bell_game();
        app.st.row = Some(0);
        for _ in 0..100 {
            if app.st.inbox_step(std::time::Duration::from_millis(50)).is_none() {
                break;
            }
        }
        let mut h = harness(app);
        h.run();
        h.get_by_label("Сповіщення: що потребує уваги й що змінили інші").click();
        h.run();
        h.run();
        h.render().unwrap().save(dir.join("22-bell.png")).unwrap();
    }

    /// Знімок найменшого вікна (1000×600) з довгою назвою проєкту: перемикач режимів видно й він на місці. `TRANSLY_SHOTS=<тека> cargo test -p transly-app small_window -- --ignored`.
    #[test]
    #[ignore]
    fn small_window_shot() {
        let Some(dir) = std::env::var_os("TRANSLY_SHOTS").map(std::path::PathBuf::from) else { return };
        std::fs::create_dir_all(&dir).unwrap();
        let data = game("small");
        let mut app = App::default();
        app.st.open_game(&data).unwrap();
        app.st.project.as_mut().unwrap().name = "Дуже-дуже довга назва проєкту, що не вміщується".into();
        app.st.project.as_mut().unwrap().settings.remove("folderName");
        app.st.row = Some(0);
        let mut h = Harness::builder().with_size(egui::vec2(1000.0, 600.0)).build_state(|ctx, app: &mut App| {
            theme::apply(ctx);
            app.frame(ctx);
        }, app);
        h.run();
        h.run();
        h.render().unwrap().save(dir.join("21-small-window.png")).unwrap();
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
        // обидві бічні колонки закрито: полотно займає все місце
        h.state_mut().right_secs = [[false; 3]; 2];
        h.state_mut().left_open = false;
        shot(&mut h, "22-columns-closed");
        h.state_mut().right_secs = [[false, true, false]; 2];
        h.state_mut().left_open = true;
        // клавіатурне кільце фокусу: кілька Tab у таблиці
        for _ in 0..4 {
            press(&mut h, egui::Modifiers::NONE, egui::Key::Tab);
            h.run();
        }
        shot(&mut h, "20-focus-ring");
        let p = pos2(650.0, 700.0);
        h.input_mut().events.push(egui::Event::PointerMoved(p));
        h.input_mut().events.push(egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed: true, modifiers: egui::Modifiers::NONE });
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
        // чипи: однакові рядки, пам'ять (із запитом), розбіжності; індекс слів будується у фоні — дамо йому час
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(30));
            h.run();
        }
        shot(&mut h, "11b-glossary-usage");
        h.state_mut().gl_show = 3;
        shot(&mut h, "11c-glossary-rows");
        h.state_mut().gl_show = 4;
        h.state_mut().gl_query = "villager".into();
        shot(&mut h, "11d-glossary-memory");
        h.state_mut().gl_show = 5;
        h.state_mut().gl_query.clear();
        shot(&mut h, "11e-glossary-diff");
        h.state_mut().gl_show = 0;
        h.state_mut().focus = true;
        h.state_mut().rail = 1;
        // правка коментаря й порівняння версії з поточним
        {
            let (f, r) = (h.state().st.file.unwrap_or(0), h.state().st.row.unwrap_or(0));
            let id = transly_core::workflow::comment_id(&h.state().st.threads(f, r)[0].root);
            h.state_mut().cm_editing = Some(id);
            h.state_mut().cm_edit_text = "Чи не краще «Селюк»?".into();
        }
        h.state_mut().right_secs = [[false, false, true]; 2];
        shot(&mut h, "09c-comment-edit");
        h.state_mut().cm_editing = None;
        h.state_mut().right_secs = [[true, false, false]; 2];
        h.state_mut().hist_for = Some((h.state().st.file.unwrap_or(0), h.state().st.row.unwrap_or(0)));
        h.state_mut().hist_cmp.insert(0);
        h.state_mut().hist_cmp.insert(1);
        shot(&mut h, "08c-activity-compare");
        h.state_mut().hist_cmp.clear();
        h.state_mut().right_secs = [[false, true, false]; 2];
        h.state_mut().focus = false;
        h.state_mut().st.file = Some(map);
        h.state_mut().st.row = Some(1);
        h.state_mut().scene_mode = true;
        h.state_mut().rail = 2;
        shot(&mut h, "10-scene");
    }
}
