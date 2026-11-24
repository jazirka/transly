//! Transly (нативна версія), етап 3 — каркас: відкрити папку гри, переглянути файли й рядки, редагувати переклад, зберегти проєкт.
//! Уся логіка — в `transly-core`, доступ до файлів — через `transly-platform` (лише обрані папки). Тут лише малювання.

mod state;

use eframe::egui::{self, Color32, RichText};
use state::{AppState, RowStatus};

fn main() -> eframe::Result {
    let opts = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1200.0, 760.0]).with_title("Transly"), ..Default::default() };
    eframe::run_native("Transly", opts, Box::new(|_| Ok(Box::new(App::default()))))
}

#[derive(Default)]
struct App {
    st: AppState,
    /// Рядок над полем перекладу, що редагується (синхронізується з вибраним рядком).
    draft: String,
    draft_for: Option<(usize, usize)>,
    message: String,
}

fn status_color(s: RowStatus) -> Color32 {
    match s {
        RowStatus::Untranslated => Color32::from_gray(130),
        RowStatus::Draft => Color32::from_rgb(230, 190, 80),
        RowStatus::Sent => Color32::from_rgb(90, 160, 230),
        RowStatus::Approved => Color32::from_rgb(96, 190, 120),
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.horizontal(|ui| {
                if ui.button("Відкрити гру…").clicked() {
                    if let Some(dir) = rfd::FileDialog::new().set_title("Оберіть папку гри (data)").pick_folder() {
                        self.message = match self.st.open_game(&dir) {
                            Ok(n) => format!("Відкрито: {n} файлів із текстом"),
                            Err(e) => e,
                        };
                        self.draft_for = None;
                    }
                }
                let can = self.st.is_open();
                if ui.add_enabled(can, egui::Button::new("Зберегти проєкт")).clicked() {
                    self.message = match self.st.save_project() {
                        Ok(p) => format!("Збережено: {p}"),
                        Err(e) => e,
                    };
                }
                ui.separator();
                if can {
                    let p = self.st.progress();
                    ui.label(format!("Рядків: {} · перекладено: {} · надіслано: {} · вичитано: {}", p.total, p.draft + p.sent + p.approved, p.sent, p.approved));
                }
                ui.label(RichText::new(&self.message).weak());
            });
        });

        egui::SidePanel::left("files").default_width(240.0).show(ctx, |ui| {
            ui.heading("Файли");
            egui::ScrollArea::vertical().show(ui, |ui| {
                for (i, name) in self.st.file_names().iter().enumerate() {
                    if ui.selectable_label(self.st.file == Some(i), name).clicked() {
                        self.st.file = Some(i);
                        self.st.row = None;
                    }
                }
            });
        });

        egui::TopBottomPanel::bottom("editor").min_height(150.0).show(ctx, |ui| {
            let Some((f, r)) = self.st.file.zip(self.st.row) else {
                ui.label("Оберіть рядок");
                return;
            };
            if self.draft_for != Some((f, r)) {
                self.draft = self.st.target_of(f, r);
                self.draft_for = Some((f, r));
            }
            ui.label(RichText::new(self.st.source_of(f, r)).strong());
            ui.add(egui::TextEdit::multiline(&mut self.draft).desired_rows(4).desired_width(f32::INFINITY));
            ui.horizontal(|ui| {
                if ui.button("Зберегти правку").clicked() {
                    self.st.edit(f, r, &self.draft);
                }
                if ui.button("Надіслати на вичитку").clicked() {
                    self.message = match self.st.submit(f, r, &self.draft) {
                        Ok(()) => "Надіслано".into(),
                        Err(e) => e,
                    };
                }
            });
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            let Some(f) = self.st.file else {
                ui.centered_and_justified(|ui| ui.label("Відкрийте папку гри"));
                return;
            };
            let n = self.st.row_count(f);
            let h = ui.text_style_height(&egui::TextStyle::Body) + 6.0;
            egui::ScrollArea::vertical().auto_shrink([false; 2]).show_rows(ui, h, n, |ui, range| {
                for r in range {
                    let (src, tgt, st) = self.st.row_view(f, r);
                    ui.horizontal(|ui| {
                        ui.colored_label(status_color(st), "●");
                        let sel = self.st.row == Some(r);
                        let text = if tgt.is_empty() { src.clone() } else { format!("{src}  →  {tgt}") };
                        if ui.selectable_label(sel, text).clicked() {
                            self.st.row = Some(r);
                        }
                    });
                }
            });
        });
    }
}
