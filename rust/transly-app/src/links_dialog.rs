//! Діалог «Зв’язані рядки» (`app/src/ui/links-dialog.ts`, `openLinkRows`): «Поширити переклад…» для групи рядків з однаковим оригіналом.
//! Показує еталон і рядки, які можна оновити (без перекладу, старіші, змінені пізніше), з порівнянням «було → стане»; позначені отримують текст еталона
//! чернетками, одна дія журналу зі «Скасувати». Змінені пізніше за еталон і вичитані рядки за замовчуванням не позначені.

use super::*;
use crate::state::LinkSync;
use std::collections::HashSet;

/// Стан відкритого діалогу: що поширюється і які рядки перекладач зняв.
#[derive(Clone)]
pub(crate) struct LinksWin {
    pub sync: LinkSync,
    pub off: HashSet<(String, String)>,
}

/// Назва файлу без розширення (`ctx.fileTitle` у вебі).
fn file_title(name: &str) -> String {
    std::path::Path::new(name).file_stem().map_or_else(|| name.to_string(), |s| s.to_string_lossy().into_owned())
}

/// Один рядок не довше `n` знаків (`oneLine` у вебі).
fn one_line(text: &str, n: usize) -> String {
    let t = text.replace('\n', " ");
    if t.chars().count() <= n {
        t
    } else {
        t.chars().take(n.saturating_sub(1)).collect::<String>() + "…"
    }
}

impl App {
    /// Відкриває діалог для групи рядка `(file, key)`; коли поширювати нічого, каже чому.
    pub(crate) fn open_links(&mut self, file: &str, key: &str) {
        match self.st.link_sync(file, key) {
            Ok(sync) => {
                let off = sync.items.iter().filter(|i| i.edited || i.approved).map(|i| (i.file.clone(), i.key.clone())).collect();
                self.links_win = Some(LinksWin { sync, off });
            }
            Err(e) => self.message = e,
        }
    }

    pub(crate) fn links_window(&mut self, ctx: &egui::Context) {
        let Some(mut w) = self.links_win.take() else { return };
        let mut open = true;
        let (mut apply, mut close) = (false, false);
        dlg("Зв’язані рядки").open(&mut open).collapsible(false).resizable(false).default_width(640.0).show(ctx, |ui| {
            let mut job = egui::text::LayoutJob::default();
            job.wrap.max_width = ui.available_width();
            let f = |c: Color32| egui::TextFormat { font_id: ip(13.0), color: c, line_height: Some(18.0), ..Default::default() };
            job.append("Однаковий оригінал: ", 0.0, f(MUTE));
            job.append(&one_line(&w.sync.text, 120), 0.0, egui::TextFormat { font_id: ipw(13.0, 600), ..f(TEXT) });
            job.append(&format!(". Еталон{}: «{}» у «{}».", if w.sync.main { " (головний, який ви обрали)" } else { " (надіслано останнім)" }, one_line(&w.sync.reference, 120), file_title(&w.sync.ref_file)), 0.0, f(MUTE));
            ui.label(job);
            ui.add_space(6.0);
            let total = w.sync.items.len();
            let n = w.sync.items.iter().filter(|i| !w.off.contains(&(i.file.clone(), i.key.clone()))).count();
            let (edited, reviewed) = (w.sync.items.iter().filter(|i| i.edited).count(), w.sync.items.iter().filter(|i| i.approved).count());
            let mut sum = format!("Вибрано {n} з {total}. Зніміть позначку з рядків, які мають лишитися як є.");
            if edited > 0 {
                sum += " Рядки, змінені пізніше за еталон, не позначені.";
            }
            if reviewed > 0 {
                sum += &format!(" Вичитані ({reviewed}) не позначені: позначте, якщо їх теж треба замінити.");
            }
            let sg = ui.painter().layout(sum.clone(), ip(12.5), MUTE, ui.available_width());
            let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), sg.size().y), Sense::hover());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, sum.clone()));
            ui.painter().galley(r.min, sg, MUTE);
            ui.add_space(8.0);
            egui::ScrollArea::vertical().max_height(340.0).auto_shrink([false, true]).show(ui, |ui| {
                for it in &w.sync.items {
                    let id = (it.file.clone(), it.key.clone());
                    let mut on = !w.off.contains(&id);
                    ui.horizontal_top(|ui| {
                        let cb = stshell::check(ui, &mut on, "");
                        cb.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, on, format!("Оновити {}", file_title(&it.file))));
                        ui.vertical(|ui| {
                            ui.label(RichText::new(format!("{} · {}{}", file_title(&it.file), it.state, if it.approved { " · вичитано (стане чернеткою)" } else { "" })).size(12.0).color(MUTE));
                            let mut cmp = egui::text::LayoutJob::default();
                            cmp.wrap.max_width = ui.available_width();
                            let segs = transly_core::textdiff::diff_words(&it.target, &w.sync.reference);
                            crate::layout::append_diff(&mut cmp, &segs, ip(13.0), 18.0);
                            ui.label(cmp).on_hover_text("Було → стане: закреслене зникне, підкреслене з’явиться");
                        });
                    });
                    if on {
                        w.off.remove(&id);
                    } else {
                        w.off.insert(id);
                    }
                    ui.add_space(4.0);
                }
            });
            dlg_footer(ui, |ui| {
                let n = w.sync.items.iter().filter(|i| !w.off.contains(&(i.file.clone(), i.key.clone()))).count();
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new("Оновити вибрані").color(Color32::WHITE)).fill(accent_solid()).min_size(vec2(0.0, 28.0))).clicked() {
                    apply = true;
                }
                if plain_button(ui, "Закрити").clicked() {
                    close = true;
                }
            });
        });
        if apply {
            let picked: HashSet<(String, String)> = w.sync.items.iter().map(|i| (i.file.clone(), i.key.clone())).filter(|id| !w.off.contains(id)).collect();
            let n = self.st.apply_link_picks(&w.sync.file, &w.sync.key, &picked);
            self.message = if n > 0 { format!("Оновлено зв’язані рядки: {n}") } else { "Нічого не змінено".into() };
            self.draft_for = None;
            self.cell_edit = None;
        } else if !close && open {
            self.links_win = Some(w);
        }
    }
}
