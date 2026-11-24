//! `historyview.ts`: історія рядка, як її показують: новіші першими, кожен запис з текстом до нього й зробленими змінами, і що можна повернути.
//! Запис тримає текст після дії (`text`) і, коли в дії був знімок, переклад до неї (`prev`); без знімка стоїть текст попереднього запису.

use crate::model::HistoryItem;
use crate::textdiff::{diff_words, DiffSeg};

pub struct HistoryRow {
    /// Місце запису у збереженій історії (найстаріший = 0).
    pub index: usize,
    pub rec: HistoryItem,
    /// Переклад до цього запису.
    pub before: String,
    /// Зміни від `before` до тексту запису.
    pub diff: Vec<DiffSeg>,
    /// Текст запису — це те, що тримає рядок зараз.
    pub is_current: bool,
    /// Цю версію можна повернути: у неї є текст і вона відрізняється від поточної.
    pub can_restore: bool,
    /// Версію перед записом можна повернути (очищення чи перезапис так скасовуються).
    pub can_restore_before: bool,
}

pub fn history_rows(history: &[HistoryItem], current: &str) -> Vec<HistoryRow> {
    let mut rows: Vec<HistoryRow> = history
        .iter()
        .enumerate()
        .map(|(index, rec)| {
            let before = match &rec.prev {
                Some(p) => p.target.clone(),
                None if index > 0 => history[index - 1].text.clone(),
                None => String::new(),
            };
            HistoryRow {
                index,
                diff: if !rec.text.is_empty() || !before.is_empty() { diff_words(&before, &rec.text) } else { vec![] },
                // лише найновіший запис може бути текстом, що стоїть зараз (старіший з тими самими словами після відновлення — ні)
                is_current: index == history.len() - 1 && rec.text == current,
                can_restore: !rec.text.is_empty() && rec.text != current,
                can_restore_before: !before.is_empty() && before != current && before != rec.text,
                rec: rec.clone(),
                before,
            }
        })
        .collect();
    rows.reverse();
    rows
}

/// Речення, яке відновлення лишає в історії.
pub fn restore_note(rec: &HistoryItem, which_text: bool, when: &str) -> String {
    if which_text {
        format!("відновлено версію від {when} ({})", rec.what)
    } else {
        format!("відновлено текст, що був перед дією «{}» від {when}", rec.what)
    }
}

const MONTHS: [&str; 12] = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const DAY_MS: i64 = 86_400_000;

/// (рік, місяць 0..11, день) за днями від 1970-01-01.
fn civil(days: i64) -> (i64, usize, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, (m - 1) as usize, d)
}

/// Заголовок дня запису: «Сьогодні», «Вчора», «14 листопада» (з роком, коли він не цей). Запис без часу — версія з іншого пристрою.
/// `offset_min(t)` — зсув місцевого часу від UTC у хвилинах на мить `t` (мс від 1970); його дає платформа.
pub fn day_label(at: i64, now: i64, offset_min: &dyn Fn(i64) -> i64) -> String {
    if at == 0 {
        return "З іншого пристрою".into();
    }
    let local = |t: i64| t + offset_min(t) * 60_000;
    let day_start = |t: i64| {
        let midnight_local = local(t).div_euclid(DAY_MS) * DAY_MS;
        let guess = midnight_local - offset_min(t) * 60_000;
        midnight_local - offset_min(guess) * 60_000
    };
    let days = ((day_start(now) - day_start(at)) as f64 / DAY_MS as f64).round() as i64;
    if days == 0 {
        return "Сьогодні".into();
    }
    if days == 1 {
        return "Вчора".into();
    }
    let (y, m, d) = civil(local(at).div_euclid(DAY_MS));
    let (ny, _, _) = civil(local(now).div_euclid(DAY_MS));
    format!("{d} {}{}", MONTHS[m], if y == ny { String::new() } else { format!(" {y}") })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ActivityKind {
    Send,
    Approve,
    Restore,
    Back,
    Edit,
}
impl ActivityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ActivityKind::Send => "send",
            ActivityKind::Approve => "approve",
            ActivityKind::Restore => "restore",
            ActivityKind::Back => "back",
            ActivityKind::Edit => "edit",
        }
    }
}

/// Вид запису історії, для значка: надіслано, вичитано, відновлено, повернено чи звичайна правка.
pub fn activity_kind(what: &str) -> ActivityKind {
    if what.starts_with("надіслано") || what == "send" {
        ActivityKind::Send
    } else if what.starts_with("вичитано") || what.starts_with("затверджено") {
        ActivityKind::Approve
    } else if what.starts_with("відновлено") {
        ActivityKind::Restore
    } else if what.starts_with("повернено") {
        ActivityKind::Back
    } else {
        ActivityKind::Edit
    }
}
