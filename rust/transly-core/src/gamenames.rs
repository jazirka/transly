//! `gamenames.ts`: назви, які гра визначає сама (предмети, навички, зброя, персонажі, вороги). Коли одна з них згадана в діалозі,
//! перекладач має вжити той самий переклад, що й у базі даних.

use crate::js;
use crate::model::UnitKind;
use crate::project::FileView;
use fancy_regex::Regex;
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

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        if ".*+?^${}()|[]\\".contains(c) {
            o.push('\\');
        }
        o.push(c);
    }
    o
}

pub struct GameNameIndex {
    by_name: IndexMap<String, GameName>,
    re: Option<Regex>,
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
        let mut names: Vec<&String> = by_name.keys().collect();
        names.sort_by_key(|n| std::cmp::Reverse(js::len16(n)));
        let re = (!names.is_empty()).then(|| {
            let alt: Vec<String> = names.iter().map(|n| esc(n)).collect();
            Regex::new(&format!(r"(?i)(?<![\p{{L}}\p{{N}}])(?:{})(?![\p{{L}}\p{{N}}])", alt.join("|"))).expect("візерунок з назв гри")
        });
        GameNameIndex { by_name, re }
    }

    pub fn size(&self) -> usize {
        self.by_name.len()
    }

    /// Назви гри, згадані в `source`, за порядком появи, без повторів.
    pub fn find(&self, source: &str) -> Vec<GameName> {
        let Some(re) = &self.re else { return vec![] };
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for m in re.find_iter(source).flatten() {
            let k = m.as_str().to_lowercase();
            if let Some(g) = self.by_name.get(&k) {
                if seen.insert(k) {
                    out.push(g.clone());
                }
            }
        }
        out
    }
}
