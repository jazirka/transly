//! Етап 0: той самий прототип на Slint. Порівняння — у rust/PROTO-COMPARISON.md.
use slint::{ModelRc, SharedString, VecModel};
slint::include_modules!();

const TERMS: [(&str, &str, &str); 4] = [("Levi", "Леві", "#b589d6"), ("hat", "капелюх", "#5ba3e6"), ("apple", "яблуко", "#60be78"), ("cloak", "плащ", "#e6a04b")];

fn mark(src: &str) -> String {
    let mut out = src.to_string();
    for (en, _, col) in TERMS { out = out.replace(en, &format!("<u><font color=\"{col}\">{en}</font></u>")); }
    out
}

fn styled(src: &str) -> slint::StyledText { slint::StyledText::from_markdown(&mark(src)).unwrap_or_default() }

fn main() {
    let words = ["Levi", "takes", "the", "hat", "off", "and", "eats", "an", "apple", "near", "the", "cloak"];
    let rows: Vec<Row> = (0..100_000usize).map(|i| {
        let (a, b, c) = (words[i % 12], words[(i * 7 + 3) % 12], words[(i * 13 + 5) % 12]);
        Row { n: (i + 1) as i32, key: format!("msg[{i}]").into(), src: format!("{a} {b} {c} line {i}.").into(), tgt: if i % 3 == 0 { format!("Рядок {i}").into() } else { SharedString::new() } }
    }).collect();
    let app = App::new().unwrap();
    app.set_marked_src(styled(&rows[0].src));
    app.set_target(rows[0].tgt.clone());
    let srcs: Vec<String> = rows.iter().map(|r| r.src.to_string()).collect();
    app.set_rows(ModelRc::new(VecModel::from(rows)));
    let weak = app.as_weak();
    app.on_pick(move |i| { if let Some(a) = weak.upgrade() { a.set_marked_src(styled(&srcs[i as usize])); } });
    if std::env::var("PROTO_BENCH").is_ok() {
        // безперервна прокрутка: виміряти, скільки кадрів за секунду
        let t = std::time::Instant::now();
        let n = std::rc::Rc::new(std::cell::Cell::new(0u64));
        let n2 = n.clone();
        app.window().set_rendering_notifier(move |state, _| { if let slint::RenderingState::AfterRendering = state { n2.set(n2.get() + 1); if n2.get() % 120 == 0 { eprintln!("slint frames {} in {:.1}s · {:.1} ms/frame", n2.get(), t.elapsed().as_secs_f32(), t.elapsed().as_secs_f32() * 1000.0 / n2.get() as f32); } } }).ok();
        let timer = slint::Timer::default();
        let w2 = app.as_weak();
        timer.start(slint::TimerMode::Repeated, std::time::Duration::from_millis(1), move || { if let Some(a) = w2.upgrade() { a.window().request_redraw(); } });
        app.run().unwrap();
        return;
    }
    app.run().unwrap();
}
