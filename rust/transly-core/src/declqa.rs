//! `ext/declqa.ts`: правила QA, які плагін описує даними. Плагін не приносить коду: перевірки — чотири види, зроблені зі
//! звичайних збігів тексту (ніколи не регулярний вираз чужої руки, що міг би зависнути). Коди керування гри ховаються
//! перед пошуком, тож `\C[2]` ніколи не вважається текстом.

use crate::controlcodes::display_length;
use crate::findreplace::literal_pattern;
use crate::i18n::{I18n, CORE};
use crate::js;
use crate::qacodes::mask_codes;
use crate::qa::IssueCat;
use crate::qarules::{RuleCtx, RuleSeverity};
use fancy_regex::Regex;
use serde_json::Value;

static LETTER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\p{L}").unwrap());

pub struct TextMatch {
    pub find: String,
    pub replace: Option<String>,
    re: Regex,
}

impl TextMatch {
    /// З опису `{ find, wholeWord?, caseSensitive?, replace? }` (уже перевірений `manifest`).
    pub fn from_value(v: &Value) -> TextMatch {
        let find = v.get("find").and_then(Value::as_str).unwrap_or("").to_string();
        let flag = |k: &str| v.get(k).and_then(Value::as_bool) == Some(true);
        let re = literal_pattern(&find, flag("wholeWord"), flag("caseSensitive"));
        TextMatch { find, replace: v.get("replace").and_then(Value::as_str).map(String::from), re }
    }
    fn has(&self, text: &str) -> bool {
        self.re.is_match(text).unwrap_or(false)
    }
}

pub enum Check {
    Forbid { items: Vec<TextMatch>, message: Option<String> },
    Require { when: Box<TextMatch>, then: Box<TextMatch>, message: Option<String> },
    MaxLength { max: i64, message: Option<String> },
    SameAsSource { message: Option<String> },
}

pub struct DeclRule {
    pub id: String,
    pub title: String,
    pub explain: String,
    pub cat: IssueCat,
    pub def: RuleSeverity,
    pub fixable: bool,
    pub plugin: String,
    pub kinds: Option<Vec<String>>,
    pub check: Check,
    ctx: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeclOut {
    pub message: String,
    pub fixed: Option<String>,
}

/// Id правила плагіна в застосунку: не збігається ні з правилом застосунку, ні з правилом іншого плагіна.
pub fn plugin_rule_id(plugin_id: &str, local: &str) -> String {
    format!("{plugin_id}:{local}")
}

fn quote(s: &str) -> String {
    if js::len16(s) > 40 {
        let mut n = 0;
        let mut head = String::new();
        for c in s.chars() {
            n += c.len_utf16();
            if n > 40 {
                break;
            }
            head.push(c);
        }
        format!("«{head}…»")
    } else {
        format!("«{s}»")
    }
}

fn str_of(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)
}

/// Правило з опису `qaRules[i]` маніфесту плагіна `plugin_id`. Заголовок і пояснення перекладаються одразу, повідомлення — під час перевірки.
pub fn declarative_rule(plugin_id: &str, q: &Value, i18n: &mut I18n) -> DeclRule {
    let ctx = format!("plugin:{plugin_id}");
    let local = q.get("id").and_then(Value::as_str).unwrap_or("");
    let title_src = q.get("title").and_then(Value::as_str).unwrap_or("");
    let title = i18n.t(title_src, &vec![], &ctx);
    let explain = match str_of(q, "description") {
        Some(d) => i18n.t(&d, &vec![], &ctx),
        None => i18n.t(title_src, &vec![], &ctx),
    };
    let bad = q.get("severity").and_then(Value::as_str) == Some("bad");
    let c = &q["check"];
    let message = str_of(c, "message");
    let items = |k: &str| c.get(k).and_then(Value::as_array).map(|a| a.iter().map(TextMatch::from_value).collect::<Vec<_>>()).unwrap_or_default();
    let check = match c.get("type").and_then(Value::as_str).unwrap_or("") {
        "forbid" => Check::Forbid { items: items("items"), message },
        "require" => Check::Require { when: Box::new(TextMatch::from_value(&c["when"])), then: Box::new(TextMatch::from_value(&c["then"])), message },
        "maxLength" => Check::MaxLength { max: c.get("max").and_then(Value::as_i64).unwrap_or(0), message },
        _ => Check::SameAsSource { message },
    };
    let fixable = matches!(&check, Check::Forbid { items, .. } if items.iter().any(|i| i.replace.is_some()));
    DeclRule {
        id: plugin_rule_id(plugin_id, local),
        title,
        explain,
        cat: if bad { IssueCat::Error } else { IssueCat::Style },
        def: if bad { RuleSeverity::Bad } else { RuleSeverity::Warn },
        fixable,
        plugin: plugin_id.to_string(),
        kinds: q.get("kinds").and_then(Value::as_array).map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()),
        check,
        ctx,
    }
}

impl DeclRule {
    /// Рядок плагіна мовою інтерфейсу, якщо плагін має своє формулювання; інакше — формулювання застосунку.
    fn own(&self, i18n: &mut I18n, msg: &Option<String>, fallback: impl FnOnce(&mut I18n) -> String) -> String {
        match msg {
            Some(m) => i18n.t(m, &vec![], &self.ctx),
            None => fallback(i18n),
        }
    }

    pub fn run(&self, x: &RuleCtx, i18n: &mut I18n) -> Option<DeclOut> {
        match &self.check {
            Check::Forbid { items, message } => {
                let found: Vec<&TextMatch> = items.iter().filter(|i| i.has(&x.mt) && !i.has(&x.ms)).collect();
                if found.is_empty() {
                    return None;
                }
                let fixes: Vec<&&TextMatch> = found.iter().filter(|i| i.replace.is_some()).collect();
                let mut fixed = None;
                if fixes.len() == found.len() {
                    let mut t = x.target.to_string();
                    for i in &fixes {
                        let rep = i.replace.as_deref().unwrap();
                        let mut out = String::new();
                        let mut last = 0;
                        for m in i.re.find_iter(&t).flatten() {
                            out.push_str(&t[last..m.start()]);
                            out.push_str(rep);
                            last = m.end();
                        }
                        out.push_str(&t[last..]);
                        t = out;
                    }
                    fixed = Some(t);
                }
                let head = self.own(i18n, message, |i| i.t("Не варто вживати", &vec![], CORE));
                let list: Vec<String> = found.iter().take(3).map(|i| quote(&i.find)).collect();
                Some(DeclOut { message: format!("{head}: {}{}", list.join(" "), if found.len() > 3 { "…" } else { "" }), fixed })
            }
            Check::Require { when, then, message } => {
                if !when.has(&x.ms) || then.has(&x.mt) {
                    return None;
                }
                let m = self.own(i18n, message, |i| {
                    i.t("В оригіналі є {when}: у перекладі має бути {then}", &vec![("when".into(), quote(&when.find)), ("then".into(), quote(&then.find))], CORE)
                });
                Some(DeclOut { message: m, fixed: None })
            }
            Check::MaxLength { max, message } => {
                let n = display_length(x.target);
                if (n as i64) <= *max {
                    return None;
                }
                let m = self.own(i18n, message, |i| i.t("Переклад довший за {max} знаків ({n})", &vec![("max".into(), max.to_string()), ("n".into(), n.to_string())], CORE));
                Some(DeclOut { message: m, fixed: None })
            }
            Check::SameAsSource { message } => {
                let a = js::trim(&mask_codes(x.source)).to_lowercase();
                let b = js::trim(&mask_codes(x.target)).to_lowercase();
                // рядок лише з чисел, знаків чи коду однаковий в усіх мовах
                if a == b && LETTER.find_iter(&a).count() >= 4 {
                    let m = self.own(i18n, message, |i| i.t("Переклад збігається з оригіналом", &vec![], CORE));
                    return Some(DeclOut { message: m, fixed: None });
                }
                None
            }
        }
    }
}
