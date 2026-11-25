//! Етап 0 (прототип): чи витримує egui найважчі місця інтерфейсу Transly.
//!  (а) таблиця на 100 000 рядків: віртуалізація, виділення, правка в клітинці;
//!  (б) поле перекладу: підкреслення термінів кольором, номери-позначки, вставка перекладу кліком по терміну в оригіналі;
//!  (в) права панель: окремі картки з заголовками, прокрутка, поле коментаря на всю ширину з нижньою смугою.
//! Усередині показано кадр у мс — це перша метрика для рішення «йдемо далі чи ні».

use eframe::egui::{self, text::LayoutJob, Align, Color32, FontId, Layout, RichText, Stroke, TextFormat, Vec2};
use std::time::Instant;

const TERM_COLORS: [Color32; 4] = [
    Color32::from_rgb(181, 137, 214),
    Color32::from_rgb(91, 163, 230),
    Color32::from_rgb(96, 190, 120),
    Color32::from_rgb(230, 160, 75),
];

struct Term {
    en: &'static str,
    uk: &'static str,
}
const TERMS: [Term; 4] = [
    Term { en: "Levi", uk: "Леві" },
    Term { en: "hat", uk: "капелюх" },
    Term { en: "apple", uk: "яблуко" },
    Term { en: "cloak", uk: "плащ" },
];

struct Row {
    key: String,
    source: String,
    target: String,
}

struct Comment {
    who: &'static str,
    text: String,
}

struct App {
    rows: Vec<Row>,
    selected: usize,
    editing: Option<usize>,
    frame_ms: f32,
    frames: u64,
    cpu_ms: f32,
    last: Instant,
    comments: Vec<Comment>,
    draft: String,
}

impl App {
    fn new() -> Self {
        let words = ["Levi", "takes", "the", "hat", "off", "and", "eats", "an", "apple", "near", "the", "cloak"];
        let rows = (0..100_000)
            .map(|i| {
                let a = words[i % words.len()];
                let b = words[(i * 7 + 3) % words.len()];
                let c = words[(i * 13 + 5) % words.len()];
                Row {
                    key: format!("msg[{i}]"),
                    source: format!("{a} {b} {c} line {i}."),
                    target: if i % 3 == 0 { format!("Рядок {i}") } else { String::new() },
                }
            })
            .collect();
        Self {
            rows,
            selected: 0,
            editing: None,
            frame_ms: 0.0,
            frames: 0,
            cpu_ms: 0.0,
            last: Instant::now(),
            comments: vec![Comment { who: "Ви", text: "Чи не краще «зняти шапку»?".into() }],
            draft: String::new(),
        }
    }
}

/// Де в тексті стоять терміни оригіналу (початок, кінець у символах, номер терміна).
fn term_ranges(text: &str, by_target: bool) -> Vec<(usize, usize, usize)> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    for (i, t) in TERMS.iter().enumerate() {
        let needle = if by_target { t.uk.to_lowercase() } else { t.en.to_lowercase() };
        let mut from = 0;
        while let Some(p) = lower[from..].find(&needle) {
            let start = from + p;
            let end = start + needle.len();
            out.push((lower[..start].chars().count(), lower[..end].chars().count(), i));
            from = end;
        }
    }
    out.sort();
    out
}

/// Текст із кольоровими позначками термінів (так само виглядає оригінал і переклад).
fn marked_job(text: &str, ranges: &[(usize, usize, usize)], wrap: f32, font: FontId) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap;
    let chars: Vec<char> = text.chars().collect();
    let mut at = 0;
    let plain = TextFormat { font_id: font.clone(), color: Color32::from_rgb(223, 225, 229), ..Default::default() };
    for &(s, e, ci) in ranges {
        if s < at { continue; }
        job.append(&chars[at..s].iter().collect::<String>(), 0.0, plain.clone());
        let col = TERM_COLORS[ci % TERM_COLORS.len()];
        job.append(
            &chars[s..e].iter().collect::<String>(),
            0.0,
            TextFormat {
                font_id: font.clone(),
                color: Color32::from_rgb(223, 225, 229),
                background: col.gamma_multiply(0.30),
                underline: Stroke::new(2.0_f32, col),
                ..Default::default()
            },
        );
        at = e;
    }
    job.append(&chars[at..].iter().collect::<String>(), 0.0, plain);
    job
}

/// Кружечок-номер над словом, як у веб-версії.
fn badge(ui: &egui::Ui, galley: &egui::Galley, origin: egui::Pos2, ccursor: usize, n: usize, col: Color32) {
    let r = galley.pos_from_ccursor(egui::text::CCursor::new(ccursor));
    let center = origin + Vec2::new(r.min.x, r.min.y) + Vec2::new(0.0, -2.0);
    ui.painter().circle_filled(center, 6.5, col);
    ui.painter().text(center, egui::Align2::CENTER_CENTER, n.to_string(), FontId::monospace(9.0), Color32::from_rgb(27, 19, 37));
}

/// Рамка-картка з заголовком, як «Файли гри» / «Рядки» у веб-версії.
fn card(ui: &mut egui::Ui, title: &str, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(Color32::from_rgb(27, 28, 31))
        .stroke(Stroke::new(1.0_f32, Color32::from_white_alpha(40)))
        .corner_radius(10.0)
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            egui::Frame::new().fill(Color32::from_rgb(38, 40, 44)).inner_margin(egui::Margin::symmetric(14, 8)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(RichText::new(title.to_uppercase()).size(11.0).strong().color(Color32::from_gray(160)));
            });
            add(ui);
        });
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let t0 = Instant::now();
        let bench = std::env::var("PROTO_BENCH").is_ok();
        let now = Instant::now();
        self.frame_ms = self.frame_ms * 0.9 + now.duration_since(self.last).as_secs_f32() * 1000.0 * 0.1;
        self.last = now;
        self.frames += 1;
        if std::env::var("PROTO_LOG").is_ok() && self.frames.is_multiple_of(30) { eprintln!("frame {} interval {:.1} ms · update() cpu {:.2} ms avg", self.frames, self.frame_ms, self.cpu_ms); }

        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("T").strong());
                ui.label("Прототип egui · 100 000 рядків");
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(format!("кадр {:.1} мс", self.frame_ms));
                });
            });
        });

        // (в) права панель: картки
        egui::SidePanel::right("right").default_width(320.0).show(ctx, |ui| {
            card(ui, "Активність", |ui| {
                ui.add_space(30.0);
                ui.vertical_centered(|ui| ui.label("Брак активності"));
                ui.add_space(30.0);
            });
            ui.add_space(6.0);
            card(ui, "Обговорення", |ui| {
                egui::ScrollArea::vertical().max_height(180.0).show(ui, |ui| {
                    for c in &self.comments {
                        ui.horizontal(|ui| {
                            ui.add_space(10.0);
                            ui.label(RichText::new(&c.who[..c.who.char_indices().nth(1).map_or(c.who.len(), |x| x.0)]).strong());
                            ui.vertical(|ui| {
                                ui.label(RichText::new(c.who).strong());
                                ui.label(&c.text);
                            });
                        });
                        ui.separator();
                    }
                });
                // поле на всю ширину, нижня смуга з підказкою й кнопкою — як поле перекладу
                ui.add(egui::TextEdit::multiline(&mut self.draft).desired_width(f32::INFINITY).desired_rows(3).hint_text("Написати про цей рядок…").frame(false).margin(egui::Margin::symmetric(14, 10)));
                egui::Frame::new().fill(Color32::from_rgb(38, 40, 44)).inner_margin(egui::Margin::symmetric(14, 6)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("Ctrl+Enter").size(12.0).weak());
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let send = ui.button("➤");
                            let ctrl_enter = ui.input(|i| i.modifiers.command && i.key_pressed(egui::Key::Enter));
                            if (send.clicked() || ctrl_enter) && !self.draft.trim().is_empty() {
                                self.comments.push(Comment { who: "Ви", text: std::mem::take(&mut self.draft) });
                            }
                        });
                    });
                });
            });
        });

        // (б) редактор рядка внизу
        egui::TopBottomPanel::bottom("editor").min_height(190.0).show(ctx, |ui| {
            let sel = self.selected;
            let source = self.rows[sel].source.clone();
            ui.label(RichText::new("ОРИГІНАЛ · EN").size(11.0).weak());
            let s_ranges = term_ranges(&source, false);
            let job = marked_job(&source, &s_ranges, ui.available_width(), FontId::proportional(15.0));
            let galley = ui.fonts(|f| f.layout_job(job));
            let (rect, resp) = ui.allocate_exact_size(galley.size() + Vec2::new(0.0, 6.0), egui::Sense::click());
            ui.painter().galley(rect.min, galley.clone(), Color32::WHITE);
            for (n, &(s, _, ci)) in s_ranges.iter().enumerate() {
                badge(ui, &galley, rect.min, s, n + 1, TERM_COLORS[ci]);
            }
            // клік по терміну оригіналу вставляє його переклад у кінець, якщо його там ще немає
            if resp.clicked() {
                if let Some(pos) = resp.interact_pointer_pos() {
                    let c = galley.cursor_from_pos(pos - rect.min).ccursor.index;
                    if let Some(&(_, _, ci)) = s_ranges.iter().find(|&&(s, e, _)| c >= s && c <= e) {
                        let uk = TERMS[ci].uk;
                        let t = &mut self.rows[sel].target;
                        if !t.to_lowercase().contains(&uk.to_lowercase()) {
                            if !t.is_empty() { t.push(' '); }
                            t.push_str(uk);
                        }
                    }
                }
            }
            ui.add_space(4.0);
            ui.label(RichText::new("ПЕРЕКЛАД · UK").size(11.0).weak());
            let mut layouter = |ui: &egui::Ui, text: &str, wrap: f32| {
                let r = term_ranges(text, true);
                ui.fonts(|f| f.layout_job(marked_job(text, &r, wrap, FontId::proportional(15.0))))
            };
            let out = egui::TextEdit::multiline(&mut self.rows[sel].target).desired_width(f32::INFINITY).desired_rows(3).layouter(&mut layouter).show(ui);
            let t_ranges = term_ranges(&self.rows[sel].target, true);
            for (n, &(s, _, ci)) in t_ranges.iter().enumerate() {
                badge(ui, &out.galley, out.galley_pos, s, n + 1, TERM_COLORS[ci]);
            }
        });

        // (а) таблиця на 100 тис. рядків
        egui::CentralPanel::default().show(ctx, |ui| {
            let h = 26.0;
            ui.horizontal(|ui| {
                ui.add_sized([60.0, h], egui::Label::new(RichText::new("№").weak()));
                ui.add_sized([110.0, h], egui::Label::new(RichText::new("Ключ").weak()));
                ui.add_sized([320.0, h], egui::Label::new(RichText::new("Оригінал · EN").weak()));
                ui.label(RichText::new("Переклад · UK").weak());
            });
            ui.separator();
            let total = self.rows.len();
            let mut sa = egui::ScrollArea::vertical().auto_shrink([false; 2]);
            if bench { sa = sa.vertical_scroll_offset((self.frames as f32 * 37.0) % (total as f32 * h - 400.0)); }
            sa.show_rows(ui, h, total, |ui, range| {
                for i in range {
                    let selected = i == self.selected;
                    ui.horizontal(|ui| {
                        ui.set_height(h);
                        ui.add_sized([60.0, h], egui::Label::new(RichText::new((i + 1).to_string()).weak()));
                        ui.add_sized([110.0, h], egui::Label::new(RichText::new(&self.rows[i].key).monospace().weak()));
                        let r = ui.add_sized([320.0, h], egui::SelectableLabel::new(selected, &self.rows[i].source));
                        if r.clicked() { self.selected = i; self.editing = None; }
                        if self.editing == Some(i) {
                            let e = ui.add(egui::TextEdit::singleline(&mut self.rows[i].target).desired_width(f32::INFINITY));
                            if e.lost_focus() { self.editing = None; }
                            else { e.request_focus(); }
                        } else {
                            let txt = if self.rows[i].target.is_empty() { "—".to_string() } else { self.rows[i].target.clone() };
                            if ui.add(egui::Label::new(txt).sense(egui::Sense::click())).clicked() { self.selected = i; self.editing = Some(i); }
                        }
                    });
                }
            });
        });
        self.cpu_ms = self.cpu_ms * 0.9 + t0.elapsed().as_secs_f32() * 1000.0 * 0.1;
        if bench { ctx.request_repaint(); } else { ctx.request_repaint_after(std::time::Duration::from_millis(500)); }
    }
}

fn main() -> eframe::Result {
    let opts = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1280.0, 800.0]).with_title("Transly · прототип egui"), ..Default::default() };
    eframe::run_native("transly-proto-egui", opts, Box::new(|cc| { cc.egui_ctx.set_visuals(egui::Visuals::dark()); Ok(Box::new(App::new())) }))
}
