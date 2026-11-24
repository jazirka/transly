//! `qaadvice.ts`: огляд порад (приміток, що нічого не блокують): у скількох рядках є порада, скільки рядків знайшло кожне
//! правило форми у файлі, і виправлення одним кліком для всього файлу.

use crate::journal::{FileView, RowChange, SavedFiles};
use crate::model::Entry;
use crate::qa::{active_issues, Issue, QaOptions, Severity, UnitLike};
use crate::qarules::{rule_by_id, QA_RULES};
use serde::Serialize;

/// Поради рядка, які перекладач не проігнорував.
pub fn advice_of(unit: &UnitLike, entry: Option<&Entry>, opts: &QaOptions) -> Vec<Issue> {
    active_issues(unit, entry, opts).into_iter().filter(|i| i.severity == Severity::Warn).collect()
}

/// Примітки, яких огляд не рахує. Довжина, що відрізняється від оригіналу, — рекомендація під полем, а переклад у багатьох
/// рядках за природою довший чи коротший: їх рахунок потопив би поради, які перекладач справді може виправити.
const NOT_COUNTED: [&str; 1] = ["len"];

/// Чи має рядок пораду, яку показує огляд (лічильник, фільтр «З порадами», перехід до наступної).
pub fn has_advice(unit: &UnitLike, entry: Option<&Entry>, opts: &QaOptions) -> bool {
    entry.is_some_and(|e| !e.target.is_empty()) && advice_of(unit, entry, opts).iter().any(|i| !NOT_COUNTED.contains(&i.key.as_str()))
}

/// Скільки рядків у файлах мають пораду.
pub fn advice_count(views: &[FileView], files: &SavedFiles, opts: &QaOptions) -> usize {
    let mut n = 0;
    for v in views {
        let Some(ents) = files.get(&v.name) else { continue };
        for u in &v.units {
            if has_advice(&UnitLike::from(u), ents.get(&u.key), opts) {
                n += 1;
            }
        }
    }
    n
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RuleStat {
    pub id: String,
    /// Рядки, де правило зараз має примітку.
    pub rows: usize,
    /// З них рядки, які правило може виправити саме.
    pub fixable: usize,
}

/// Для кожного правила форми: у скількох рядках файлу воно має примітку і скільки з них може виправити.
pub fn rule_stats(view: &FileView, files: &SavedFiles, opts: &QaOptions) -> Vec<RuleStat> {
    let mut stat: Vec<RuleStat> = QA_RULES.iter().map(|r| RuleStat { id: r.id.to_string(), rows: 0, fixable: 0 }).collect();
    let empty = Default::default();
    let ents = files.get(&view.name).unwrap_or(&empty);
    for u in &view.units {
        let Some(e) = ents.get(&u.key).filter(|e| !e.target.is_empty()) else { continue };
        for i in active_issues(&UnitLike::from(u), Some(e), opts) {
            if let Some(s) = stat.iter_mut().find(|s| s.id == i.key) {
                s.rows += 1;
                if i.fix.is_some() {
                    s.fixable += 1;
                }
            }
        }
    }
    stat
}

/// Виправлення одного правила по файлах, готові для `commit_rows` однією дією. Рядок виправляється з нинішнього тексту; його
/// статус лишається (виправлене написання не повертає рядок на вичитку); рядок, де перекладач проігнорував примітку чи де
/// правило не має готового виправлення, не чіпається.
pub fn fix_rule(views: &[FileView], files: &SavedFiles, rule_id: &str, opts: &QaOptions, now: i64) -> Vec<RowChange> {
    let Some(rule) = rule_by_id(rule_id) else { return Vec::new() };
    let mut out = Vec::new();
    for v in views {
        let Some(ents) = files.get(&v.name) else { continue };
        for u in &v.units {
            let Some(cur) = ents.get(&u.key).filter(|e| !e.target.is_empty()) else { continue };
            let Some(text) = active_issues(&UnitLike::from(u), Some(cur), opts).into_iter().find(|i| i.key == rule_id).and_then(|i| i.fix).map(|f| f.text) else { continue };
            if text == cur.target {
                continue;
            }
            let next = Entry { target: text.clone(), mt: now, orig: cur.orig.as_ref().map(|_| text.clone()), ..cur.clone() };
            out.push(RowChange { file: v.name.clone(), key: u.key.clone(), text, what: Some(format!("виправлено за правилом «{}»", rule.title)), next });
        }
    }
    out
}
