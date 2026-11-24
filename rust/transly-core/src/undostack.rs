//! `undostack.ts`: лінія масових дій цього сеансу, якою Ctrl+Z іде назад (а Ctrl+Shift+Z вперед). Тримає лише id дій журналу
//! (справжнє скасування робить `journal`), тож нічого не коштує й порожня після перезапуску. Нова дія обриває лінію вперед, як у будь-якому редакторі.

#[derive(Clone, Debug)]
pub struct UndoStack {
    done: Vec<String>,
    redo: Vec<String>,
    limit: usize,
    /// Чи тримав цей стек колись дію (після перезапуску ні: тоді можна запропонувати найновішу дію журналу).
    pub used: bool,
    seeded: bool,
}

impl Default for UndoStack {
    fn default() -> Self {
        UndoStack::new(50)
    }
}

impl UndoStack {
    pub fn new(limit: usize) -> UndoStack {
        UndoStack { done: vec![], redo: vec![], limit, used: false, seeded: false }
    }

    /// Нова дія записана: її можна скасувати, а те, що чекало повтору, зникає.
    pub fn record(&mut self, id: &str) {
        self.used = true;
        self.done.push(id.to_string());
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
        self.redo.clear();
    }

    /// Дія, яку скасує Ctrl+Z далі (її знято з лінії).
    pub fn take_undo(&mut self) -> Option<String> {
        self.used = true;
        self.done.pop()
    }

    /// Дія, яку повторить Ctrl+Shift+Z далі (її знято з лінії).
    pub fn take_redo(&mut self) -> Option<String> {
        self.redo.pop()
    }

    /// `orig` скасовано дією `batch`: повтор — це скасування `batch`. `orig` лишає лінію назад, де б не стояла.
    pub fn undone(&mut self, orig: &str, batch: &str) {
        self.used = true;
        if let Some(i) = self.done.iter().rposition(|x| x == orig) {
            self.done.remove(i);
        }
        self.redo.push(batch.to_string());
    }

    /// `orig` (скасування) повторено дією `batch`: її можна скасувати знову, решта лінії вперед лишається.
    pub fn redone(&mut self, orig: &str, batch: &str) {
        if let Some(i) = self.redo.iter().rposition(|x| x == orig) {
            self.redo.remove(i);
        }
        self.done.push(batch.to_string());
    }

    /// Після перезапуску лінія порожня, а журнал ще тримає дії попередніх сеансів. Перший Ctrl+Z кладе їх (найновіші першими
    /// у `newest_first`) під те, що записав цей сеанс, один раз, тож клавіша йде назад усім журналом. Id, що вже є в лінії, не додаються знову.
    pub fn seed(&mut self, newest_first: &[String]) {
        if self.seeded {
            return;
        }
        self.seeded = true;
        let have: std::collections::HashSet<&String> = self.done.iter().chain(self.redo.iter()).collect();
        let mut older: Vec<String> = newest_first.iter().filter(|id| !have.contains(id)).cloned().collect();
        older.reverse();
        older.extend(std::mem::take(&mut self.done));
        self.done = older;
        if self.done.len() > self.limit {
            let cut = self.done.len() - self.limit;
            self.done.drain(0..cut);
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.done.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
    pub fn clear(&mut self) {
        self.done.clear();
        self.redo.clear();
    }
}
