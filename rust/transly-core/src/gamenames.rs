//! `gamenames.ts`: назви, які гра визначає сама (предмети, навички, зброя, персонажі, вороги). Коли одна з них згадана в діалозі,
//! перекладач має вжити той самий переклад, що й у базі даних.

use crate::js;
use crate::model::UnitKind;
use crate::project::FileView;
use aho_corasick::{AhoCorasick, MatchKind};
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameName {
    pub file: String,
    pub key: String,
    pub name: String,
}

const NAME_FILES: [&str; 8] = ["Actors.json", "Armors.json", "Classes.json", "Enemies.json", "Items.json", "Skills.json", "States.json", "Weapons.json"];

/// Індекс назв гри. Раніше це був один регулярний вираз із усіх назв через «|»: на тисячах назв його автомат займав сотні мегабайтів (на 50 тис. — понад гігабайт).
/// Тепер Aho-Corasick по назвах у нижньому регістрі (пам'ять пропорційна довжині назв), а межі слова й «найдовша перша» відтворено вручну.
pub struct GameNameIndex {
    by_name: IndexMap<String, GameName>,
    ac: Option<AhoCorasick>,
}

impl GameNameIndex {
    pub fn new(views: &[FileView], min_length: usize) -> GameNameIndex {
        let mut by_name: IndexMap<String, GameName> = IndexMap::new();
        for v in views {
            if !NAME_FILES.contains(&v.name.rsplit('/').next().unwrap_or(&v.name)) {
                continue;
            }
            for u in &v.units {
                if u.kind != UnitKind::Name || js::len16(&u.source) < min_length {
                    continue;
                }
                by_name.entry(u.source.to_lowercase()).or_insert_with(|| GameName { file: v.name.clone(), key: u.key.clone(), name: u.source.clone() });
            }
        }
        let ac = (!by_name.is_empty()).then(|| AhoCorasick::builder().match_kind(MatchKind::Standard).build(by_name.keys()).expect("автомат з назв гри"));
        GameNameIndex { by_name, ac }
    }

    pub fn size(&self) -> usize {
        self.by_name.len()
    }

    /// Назви гри, згадані в `source`, за порядком появи, без повторів. Назва — ціле слово (поруч не літера й не цифра); з кількох назв на одному місці береться найдовша.
    pub fn find(&self, source: &str) -> Vec<GameName> {
        let Some(ac) = &self.ac else { return vec![] };
        let low = source.to_lowercase();
        let word = |c: char| c.is_alphanumeric();
        let mut hits: Vec<(usize, usize)> = ac
            .find_overlapping_iter(&low)
            .filter(|m| !low[..m.start()].chars().next_back().is_some_and(word) && !low[m.end()..].chars().next().is_some_and(word))
            .map(|m| (m.start(), m.end()))
            .collect();
        hits.sort_by_key(|(s, e)| (*s, std::cmp::Reverse(*e)));
        let mut seen: HashSet<&str> = HashSet::new();
        let mut out = Vec::new();
        let mut last_end = 0usize;
        for (s, e) in hits {
            if s < last_end {
                continue;
            }
            last_end = e;
            let k = &low[s..e];
            if let Some(g) = self.by_name.get(k) {
                if seen.insert(k) {
                    out.push(g.clone());
                }
            }
        }
        out
    }
}
