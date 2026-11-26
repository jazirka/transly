//! Ліва панель «Пов’язане» — глосарій проєкту (`app/src/ui/glossary-panel.ts`): пошук, чипи виду з лічильниками, підсумок і «＋ Додати»,
//! форма запису, картки записів із «Змінити» й «Видалити». Розміри з computed style веб-DOM (`rust/parity/sel_gloss.json`).
//! «Рядки», «Пам’ять» і «Розбіжності» поки що показують заглушку «Скоро». «＋» у вебі — повноширинний плюс; Inter його не має, тож тут звичайний «+».

use super::*;
use crate::layout::{empty_note, spaced};
use transly_core::glossary::{has_gap, pattern_parts, GlossaryTerm};
use transly_core::termedit::{join_alts, TermForm};

/// Що набрано у формі запису. `was` — первісне слово запису, що змінюється (`None` — новий).
#[derive(Clone, Default)]
pub(crate) struct GlForm {
    pub was: Option<String>,
    pub en: String,
    pub uk: String,
    pub alt: String,
    pub kind: String,
    pub note: String,
    pub qa: bool,
}

const CHIPS: [&str; 6] = ["Усе", "Слова", "Конструкції", "Рядки", "Пам’ять", "Розбіжності"];
/// Скільки карток показується одразу (як `SHOWN` у вебі).
const SHOWN: usize = 200;

/// Наскільки запис підходить до пошуку: 0 — точно … 3 — містить, 4 — не підходить.
fn rank(t: &GlossaryTerm, q: &str) -> u8 {
    if q.is_empty() {
        return 3;
    }
    let lc = |s: &str| s.trim().to_lowercase();
    let names: Vec<String> = [t.en.as_str(), t.uk.as_str()].iter().map(|s| lc(s)).chain(t.alt.iter().flatten().map(|s| lc(s))).collect();
    if names.iter().any(|n| n == q) {
        0
    } else if names.iter().any(|n| n.starts_with(q)) {
        1
    } else if names.iter().any(|n| n.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(q))) {
        2
    } else if names.iter().any(|n| n.contains(q)) || lc(t.kind.as_deref().unwrap_or("")).contains(q) || lc(t.note.as_deref().unwrap_or("")).contains(q) {
        3
    } else {
        4
    }
}

fn is_construction(t: &GlossaryTerm) -> bool {
    has_gap(&t.en) && pattern_parts(&t.en).len() > 1
}

/// Поле форми: рамка 1, радіус 8, відступи 6×8, шрифт 13 з висотою рядка 18,2; у фокусі — рамка кольору теми.
fn input_box(ui: &mut egui::Ui, text: &mut String, lines: usize, hint: &str, id: &str) -> egui::Response {
    let lh = 18.2;
    let h = lh * lines as f32 + 14.0;
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), h), Sense::hover());
    let bg = ui.painter().add(egui::Shape::Noop);
    let mut cui = ui.new_child(egui::UiBuilder::new().max_rect(rect.shrink2(vec2(9.0, 7.0))));
    let mut lay = |ui: &egui::Ui, s: &str, wrap: f32| {
        let mut job = egui::text::LayoutJob::simple(s.to_owned(), ip(13.0), TEXT, wrap);
        job.sections.iter_mut().for_each(|x| x.format.line_height = Some(lh));
        ui.fonts(|f| f.layout_job(job))
    };
    let te = if lines == 1 { egui::TextEdit::singleline(text) } else { egui::TextEdit::multiline(text).desired_rows(lines) };
    let r = cui.add(te.id_salt(id).hint_text(RichText::new(hint).font(ip(13.0)).color(DIM)).frame(false).margin(egui::Vec2::ZERO).desired_width(f32::INFINITY).font(ip(13.0)).layouter(&mut lay));
    ui.painter().set(
        bg,
        egui::Shape::Vec(vec![
            egui::Shape::rect_filled(rect, CornerRadius::same(8), BG),
            egui::Shape::rect_stroke(rect, CornerRadius::same(8), Stroke::new(1.0_f32, if r.has_focus() { accent() } else { LINE }), StrokeKind::Inside),
        ]),
    );
    r
}

/// Кнопка 28 із текстом: основна (колір теми) або з рамкою `#4a4d54`.
fn button28(ui: &mut egui::Ui, label: &str, primary: bool) -> egui::Response {
    let g = ui.painter().layout_no_wrap(label.to_string(), ip(12.5), if primary { Color32::WHITE } else { TEXT });
    let (rect, resp) = ui.allocate_exact_size(vec2(g.size().x + 24.0 + if primary { 0.0 } else { 2.0 }, 28.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, label));
    if primary {
        ui.painter().rect_filled(rect, CornerRadius::same(8), if resp.hovered() { accent_hover() } else { accent_solid() });
    } else {
        ui.painter().rect(rect, CornerRadius::same(8), if resp.hovered() { BTN_HOVER } else { Color32::TRANSPARENT }, Stroke::new(1.0_f32, Color32::from_rgb(0x4a, 0x4d, 0x54)), StrokeKind::Inside);
    }
    ui.painter().galley(pos2(rect.center().x - g.size().x / 2.0, rect.center().y - g.size().y / 2.0), g, if primary { Color32::WHITE } else { TEXT });
    resp
}

impl App {
    pub(crate) fn glossary_panel(&mut self, ui: &mut egui::Ui) {
        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
        let terms = self.st.glossary_terms();
        let q = self.gl_query.trim().to_lowercase();
        let n_all = terms.len();
        let n_con = terms.iter().filter(|t| is_construction(t)).count();
        let counts = [Some(n_all), Some(n_all - n_con), Some(n_con), None, None, None];
        let w = ui.available_width();
        let origin = ui.cursor().min;

        // ---- шапка: пошук, чипи, підсумок і «＋ Додати» (поля 8, проміжки 8)
        ui.add_space(8.0);
        let (row, _) = ui.allocate_exact_size(vec2(w, 28.0), Sense::hover());
        let fin = row.shrink2(vec2(8.0, 0.0));
        ui.painter().rect(fin, CornerRadius::same(8), BG, Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
        icons::paint(ui, Rect::from_center_size(pos2(fin.left() + 14.0, fin.center().y), vec2(12.0, 12.0)), "search", MUTE);
        let mut qui = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_max(pos2(fin.left() + 27.0, fin.top() + 4.0), pos2(fin.right() - 8.0, fin.bottom() - 4.0))));
        qui.add(egui::TextEdit::singleline(&mut self.gl_query).hint_text(RichText::new("Пошук серед записів").font(ip(12.5)).color(DIM)).frame(false).margin(egui::Vec2::ZERO).desired_width(f32::INFINITY).font(ip(12.5)));
        ui.add_space(8.0);

        // чипи: висота 24, проміжок 6, переносяться; зверху поле 2, знизу 6
        let chip_w: Vec<f32> = CHIPS
            .iter()
            .zip(counts)
            .map(|(label, n)| {
                let tw = ui.painter().layout_no_wrap((*label).to_string(), ip(12.0), TEXT).size().x;
                let nw = n.map_or(0.0, |n| 6.0 + ui.painter().layout_no_wrap(n.to_string(), mp(12.0), TEXT).size().x);
                20.0 + tw + nw
            })
            .collect();
        let (x0, x1) = (origin.x + 8.0, origin.x + w - 8.0);
        let mut places: Vec<(f32, usize)> = Vec::new();
        let (mut x, mut line) = (x0, 0usize);
        for cw in &chip_w {
            if x + cw > x1 + 0.5 && x > x0 {
                x = x0;
                line += 1;
            }
            places.push((x, line));
            x += cw + 6.0;
        }
        let lines = line + 1;
        let (chips_rect, _) = ui.allocate_exact_size(vec2(w, 2.0 + lines as f32 * 24.0 + (lines as f32 - 1.0) * 6.0 + 6.0), Sense::hover());
        for (i, ((cx, ln), cw)) in places.iter().zip(&chip_w).enumerate() {
            let r = Rect::from_min_size(pos2(*cx, chips_rect.top() + 2.0 + *ln as f32 * 30.0), vec2(*cw, 24.0));
            let resp = ui.interact(r, ui.id().with(("gl-chip", i)), Sense::click());
            let on = self.gl_show == i;
            let (fill, ring, ink) = if on { (over_color(BG, accent(), 0.30), over_color(BG, accent(), 0.70), Color32::WHITE) } else { (if resp.hovered() { BTN_HOVER } else { BTN }, LINE, TEXT) };
            ui.painter().rect(r, CornerRadius::same(12), fill, Stroke::new(1.0_f32, ring), StrokeKind::Inside);
            let g = ui.painter().layout_no_wrap(CHIPS[i].to_string(), ip(12.0), ink);
            let gw = g.size().x;
            ui.painter().galley(pos2(r.left() + 10.0, r.center().y - g.size().y / 2.0), g, ink);
            if let Some(n) = counts[i] {
                ui.painter().text(pos2(r.left() + 10.0 + gw + 6.0, r.center().y), Align2::LEFT_CENTER, n.to_string(), mp(12.0), ink);
            }
            resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, on, format!("Вид записів: {}", CHIPS[i])));
            if resp.clicked() {
                self.gl_show = i;
            }
        }
        ui.add_space(8.0);

        // підсумок і «＋ Додати»
        let pool: Vec<&GlossaryTerm> = match self.gl_show {
            1 => terms.iter().filter(|t| !is_construction(t)).collect(),
            2 => terms.iter().filter(|t| is_construction(t)).collect(),
            0 => terms.iter().collect(),
            _ => Vec::new(),
        };
        let mut found: Vec<&GlossaryTerm> = pool.iter().copied().filter(|t| rank(t, &q) < 4).collect();
        found.sort_by(|a, b| rank(a, &q).cmp(&rank(b, &q)).then_with(|| a.en.to_lowercase().cmp(&b.en.to_lowercase())));
        let note = if self.gl_show >= 3 {
            "Розділ у розробці".to_string()
        } else if terms.is_empty() {
            "Записів ще немає".to_string()
        } else {
            format!("{}{}", transly_core::plural::plural(pool.len() as i64, ["запис", "записи", "записів"]), if q.is_empty() { String::new() } else { format!(" · знайдено {}", found.len()) })
        };
        let (bar, _) = ui.allocate_exact_size(vec2(w, 28.0), Sense::hover());
        ui.painter().text(pos2(bar.left() + 8.0, bar.center().y), Align2::LEFT_CENTER, note, ip(12.0), MUTE);
        let add = Rect::from_min_size(pos2(bar.right() - 8.0 - 88.0, bar.top()), vec2(88.0, 28.0));
        let aresp = ui.interact(add, ui.id().with("gl-new"), Sense::click());
        ui.painter().rect_filled(add, CornerRadius::same(8), if aresp.hovered() { accent_hover() } else { accent_solid() });
        ui.painter().text(add.center(), Align2::CENTER_CENTER, "+ Додати", ip(12.5), Color32::WHITE);
        aresp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Додати запис"));
        if aresp.clicked() {
            self.gl_form = Some(GlForm { qa: true, ..Default::default() });
        }
        ui.add_space(8.0);
        // нижня межа шапки (`.fh`: 150 + лінія 1)
        ui.painter().hline(origin.x..=origin.x + w, ui.cursor().top() + 0.5, Stroke::new(1.0_f32, LINE));
        ui.add_space(1.0);

        // ---- форма запису (фон: колір теми 6 %, поля 10×10×12, проміжок 8)
        if self.gl_form.is_some() {
            self.glossary_form(ui, w);
        }

        // ---- список карток
        if self.gl_show >= 3 {
            empty_note(ui, "Скоро");
            return;
        }
        if found.is_empty() {
            let area = ui.available_rect_before_wrap();
            ui.allocate_rect(area, Sense::hover());
            let c = pos2(area.center().x, area.top() + 40.0);
            ui.painter().text(c, Align2::CENTER_CENTER, if terms.is_empty() { "Записів ще немає" } else { "Нічого не знайдено" }, ip(14.0), MUTE);
            return;
        }
        let mut edit: Option<String> = None;
        let mut del: Option<String> = None;
        egui::ScrollArea::vertical().id_salt("gl-list").auto_shrink([false; 2]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 8, right: 8, top: 8, bottom: 8 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 6.0);
                for t in found.iter().take(SHOWN) {
                    let note_g = t.note.as_deref().filter(|n| !n.is_empty()).map(|n| ui.painter().layout(n.to_string(), ip(12.0), MUTE, ui.available_width() - 22.0));
                    let note_h = note_g.as_ref().map_or(0.0, |g| 4.0 + g.size().y);
                    let (card, _) = ui.allocate_exact_size(vec2(ui.available_width(), 81.3 + note_h), Sense::hover());
                    ui.painter().rect(card, CornerRadius::same(8), over_color(BG, Color32::WHITE, 0.02), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                    let x = card.left() + 11.0;
                    let y = card.top() + 8.0;
                    // en → uk (12,5; en — вага 500 кольору `#d9c3ee`, стрілка DIM, проміжки 8)
                    let en_g = ui.painter().layout_no_wrap(t.en.clone(), ipw(12.5, 500), Color32::from_rgb(0xd9, 0xc3, 0xee));
                    let arr_g = ui.painter().layout_no_wrap("→".to_string(), ip(12.5), DIM);
                    let clip = ui.painter().with_clip_rect(Rect::from_min_max(pos2(x, card.top()), pos2(card.right() - 11.0, card.bottom())));
                    let ew = en_g.size().x;
                    clip.galley(pos2(x, y), en_g.clone(), Color32::from_rgb(0xd9, 0xc3, 0xee));
                    let aw = arr_g.size().x;
                    clip.galley(pos2(x + ew + 8.0, y), arr_g, DIM);
                    clip.text(pos2(x + ew + 8.0 + aw + 8.0, y), Align2::LEFT_TOP, &t.uk, ip(12.5), TEXT);
                    // вид, QA, категорія, інші переклади (рядок 22; проміжки 8)
                    let my = y + 17.5 + 4.0;
                    let kind = match transly_core::strands::strand_kind(&t.en) {
                        transly_core::strands::StrandKind::Word => "слово",
                        transly_core::strands::StrandKind::Phrase => "фраза",
                        transly_core::strands::StrandKind::Construction => "конструкція",
                    };
                    let g = ui.painter().layout_no_wrap(kind.to_string(), ip(12.0), accent_text());
                    let pill = Rect::from_min_size(pos2(x, my), vec2(g.size().x + 18.0, 22.0));
                    ui.painter().rect(pill, CornerRadius::same(5), Color32::from_rgb(0x34, 0x36, 0x3b), Stroke::new(1.0_f32, accent_ring()), StrokeKind::Inside);
                    ui.painter().galley(pos2(pill.left() + 9.0, pill.center().y - g.size().y / 2.0), g, accent_text());
                    let mut mx = pill.right() + 8.0;
                    if t.qa == Some(false) {
                        let g = ui.painter().layout_no_wrap("лише підказка, без QA".to_string(), ip(12.0), DIM);
                        ui.painter().galley(pos2(mx, my + 11.0 - g.size().y / 2.0), g.clone(), DIM);
                        mx += g.size().x + 8.0;
                    } else {
                        let qa = Rect::from_min_size(pos2(mx, my + 3.5), vec2(21.4, 15.0));
                        ui.painter().rect_stroke(qa, CornerRadius::same(3), Stroke::new(1.0_f32, Color32::from_rgb(0x2f, 0x4a, 0x3a)), StrokeKind::Inside);
                        ui.painter().text(qa.center(), Align2::CENTER_CENTER, "QA", mp(9.5), OK);
                        mx += 21.4 + 8.0;
                    }
                    if let Some(k) = t.kind.as_deref().filter(|k| !k.is_empty()) {
                        let g = ui.painter().layout_no_wrap(k.to_string(), ip(12.0), MUTE);
                        let kr = Rect::from_min_size(pos2(mx, my + 2.5), vec2(g.size().x + 16.0, 17.0));
                        ui.painter().rect(kr, CornerRadius::same(9), Color32::from_rgb(0x2a, 0x2c, 0x31), Stroke::new(1.0_f32, LINE), StrokeKind::Inside);
                        ui.painter().galley(pos2(kr.left() + 8.0, kr.center().y - g.size().y / 2.0), g, MUTE);
                        mx += kr.width() + 8.0;
                    }
                    if let Some(alt) = t.alt.as_ref().filter(|a| !a.is_empty()) {
                        clip.text(pos2(mx, my + 11.0), Align2::LEFT_CENTER, format!("також: {}", alt.join("; ")), ip(12.0), MUTE);
                    }
                    let mut ay = my + 22.0;
                    if let Some(g) = note_g {
                        ay += 4.0;
                        let h = g.size().y;
                        ui.painter().galley(pos2(x, ay), g, MUTE);
                        ay += h;
                    }
                    ay += 5.0;
                    // «Змінити» · «Видалити» (12, проміжок 12)
                    let confirm = self.gl_del.as_deref() == Some(t.en.as_str());
                    let mut lx = x;
                    for (kind, label) in [(0u8, "Змінити"), (1, if confirm { "Справді видалити?" } else { "Видалити" })] {
                        let danger = kind == 1 && confirm;
                        let g = ui.painter().layout_no_wrap(label.to_string(), ip(12.0), if danger { BAD } else { MUTE });
                        let r = Rect::from_min_size(pos2(lx, ay), vec2(g.size().x, 16.8));
                        let resp = ui.interact(r, ui.id().with(("gl-act", &t.en, kind)), Sense::click());
                        ui.painter().galley(pos2(r.left(), r.top()), g, if danger { BAD } else if resp.hovered() { TEXT } else { MUTE });
                        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("{label}: {}", t.en)));
                        if resp.clicked() {
                            if kind == 0 {
                                edit = Some(t.en.clone());
                            } else {
                                del = Some(t.en.clone());
                            }
                        }
                        lx += r.width() + 12.0;
                    }
                }
                if found.len() > SHOWN {
                    ui.label(RichText::new(format!("Показано {SHOWN} із {}. Уточніть пошук.", found.len())).size(12.0).color(MUTE));
                }
            });
        });
        if let Some(en) = edit {
            if let Some(t) = terms.iter().find(|t| t.en == en) {
                self.gl_query = t.en.clone();
                self.gl_del = None;
                self.gl_form = Some(GlForm { was: Some(t.en.clone()), en: t.en.clone(), uk: t.uk.clone(), alt: join_alts(t.alt.as_deref()), kind: t.kind.clone().unwrap_or_default(), note: t.note.clone().unwrap_or_default(), qa: t.qa != Some(false) });
            }
        }
        if let Some(en) = del {
            if self.gl_del.as_deref() == Some(en.as_str()) {
                self.message = self.st.remove_glossary_term(&en);
                self.gl_del = None;
            } else {
                self.gl_del = Some(en);
            }
        }
    }

    /// Форма запису: «Новий запис» чи «Змінити запис «…»», оригінал, переклад, інші переклади, категорія, примітка, прапорець QA, «Зберегти» й «Скасувати».
    fn glossary_form(&mut self, ui: &mut egui::Ui, w: f32) {
        let Some(mut form) = self.gl_form.clone() else { return };
        let top = ui.cursor().top();
        let bg = ui.painter().add(egui::Shape::Noop);
        let left = ui.cursor().left();
        let mut save = false;
        let mut cancel = false;
        egui::Frame::new().inner_margin(egui::Margin { left: 10, right: 10, top: 10, bottom: 12 }).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing = vec2(0.0, 8.0);
            let title = match &form.was {
                Some(was) => format!("Змінити запис «{was}»"),
                None => "Новий запис".to_string(),
            };
            let g = spaced(ui, &title, 12.0, MUTE, 0.04);
            let (tr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 16.8), Sense::hover());
            ui.painter().galley(pos2(tr.left(), tr.center().y - g.size().y / 2.0), g, MUTE);
            let field = |ui: &mut egui::Ui, label: &str, text: &mut String, lines: usize, hint: &str, id: &str| {
                let (lr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 16.8), Sense::hover());
                ui.painter().text(pos2(lr.left(), lr.center().y), Align2::LEFT_CENTER, label, ip(12.0), MUTE);
                ui.add_space(3.0);
                input_box(ui, text, lines, hint, id);
            };
            field(ui, "Оригінал (EN)", &mut form.en, 1, "слово або конструкція: take … off", "gl-en");
            field(ui, "Переклад (UK)", &mut form.uk, 1, "як перекладати", "gl-uk");
            field(ui, "Інші прийнятні переклади", &mut form.alt, 1, "через «;»", "gl-alt");
            field(ui, "Категорія", &mut form.kind, 1, "наприклад, Weapons", "gl-kind");
            field(ui, "Примітка", &mut form.note, 2, "", "gl-note");
            // прапорець «Перевіряти термін під час QA»
            let (cr, cresp) = ui.allocate_exact_size(vec2(ui.available_width(), 21.0), Sense::click());
            let box_r = Rect::from_center_size(pos2(cr.left() + 7.0, cr.center().y), vec2(14.0, 14.0));
            ui.painter().rect_filled(box_r, CornerRadius::same(4), if form.qa { accent_solid() } else { BG });
            ui.painter().rect_stroke(box_r, CornerRadius::same(4), Stroke::new(1.0_f32, if form.qa { accent_solid() } else { MUTE }), StrokeKind::Inside);
            if form.qa {
                let p = Stroke::new(1.6_f32, Color32::WHITE);
                let c = box_r.center();
                ui.painter().line_segment([pos2(c.x - 3.5, c.y), pos2(c.x - 1.0, c.y + 2.8)], p);
                ui.painter().line_segment([pos2(c.x - 1.0, c.y + 2.8), pos2(c.x + 3.8, c.y - 3.0)], p);
            }
            ui.painter().text(pos2(cr.left() + 22.0, cr.center().y), Align2::LEFT_CENTER, "Перевіряти термін під час QA", ip(12.5), TEXT);
            cresp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, form.qa, "Перевіряти термін під час QA"));
            if cresp.clicked() {
                form.qa = !form.qa;
            }
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                if button28(ui, "Зберегти", true).clicked() {
                    save = true;
                }
                if button28(ui, "Скасувати", false).clicked() {
                    cancel = true;
                }
            });
        });
        let bottom = ui.cursor().top();
        ui.painter().set(
            bg,
            egui::Shape::Vec(vec![
                egui::Shape::rect_filled(Rect::from_min_max(pos2(left, top), pos2(left + w, bottom)), CornerRadius::ZERO, over_color(BG, accent(), 0.06)),
                egui::Shape::hline(left..=left + w, bottom - 0.5, Stroke::new(1.0_f32, LINE)),
            ]),
        );
        if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
            cancel = true;
        }
        if save {
            if has_gap(&form.en) && pattern_parts(&form.en).len() < 2 {
                self.message = "Конструкції потрібні принаймні два слова з пропуском між ними: «take … off». Для одного слова пропуск не потрібен".into();
            } else {
                let tf = TermForm { en: form.en.clone(), uk: form.uk.clone(), alt: Some(form.alt.clone()), kind: Some(form.kind.clone()), note: Some(form.note.clone()), qa: Some(form.qa), gender: None };
                self.message = self.st.save_term_form(&tf, form.was.as_deref());
                if self.message.starts_with("Термін") {
                    self.gl_form = None;
                    return;
                }
            }
        }
        self.gl_form = if cancel { None } else { Some(form) };
    }
}
