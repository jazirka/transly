//! `codes.ts`: що означають керівні коди в тексті, по одному разу, за порядком появи.

use crate::sysnames::SysNames;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CodeMeaning {
    pub code: String,
    pub meaning: String,
}

static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\([A-Za-z]+)\[(\d+)\]|\\([{}.|!><^$GgSs])").unwrap());

pub fn explain_codes(text: &str, actor: &dyn Fn(u64) -> Option<String>, names: Option<&SysNames>) -> Vec<CodeMeaning> {
    let mut out: Vec<CodeMeaning> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut add = |code: &str, meaning: String| {
        if seen.insert(code.to_string()) {
            out.push(CodeMeaning { code: code.to_string(), meaning });
        }
    };
    for m in CODE.captures_iter(text) {
        let code = m.get(0).unwrap().as_str();
        let n: u64 = m.get(2).map_or(0, |d| d.as_str().parse().unwrap_or(0));
        match m.get(1).map_or(String::new(), |g| g.as_str().to_uppercase()).as_str() {
            "N" => {
                let meaning = match actor(n).filter(|a| !a.is_empty()) {
                    Some(a) => format!("ім’я персонажа: {a}"),
                    None => format!("ім’я персонажа {n}"),
                };
                add(code, meaning);
                continue;
            }
            "V" => {
                let meaning = match names.and_then(|s| s.variables.get(&n.to_string())).filter(|v| !v.is_empty()) {
                    Some(v) => format!("значення змінної {n} «{v}»"),
                    None => format!("значення змінної {n}"),
                };
                add(code, meaning);
                continue;
            }
            "P" => {
                add(code, format!("ім’я учасника групи №{n}"));
                continue;
            }
            "I" => {
                add(code, format!("піктограма №{n}"));
                continue;
            }
            "C" => {
                add(code, if n == 0 { "звичайний колір".to_string() } else { format!("колір №{n}") });
                continue;
            }
            "" => {}
            _ => {
                add(code, "керівний код гри".into());
                continue;
            }
        }
        let c = m.get(3).unwrap().as_str();
        let meaning = if c.eq_ignore_ascii_case("G") {
            match names.and_then(|s| s.currency.as_deref()).filter(|c| !c.is_empty()) {
                Some(cur) => format!("назва валюти: {cur}"),
                None => "назва валюти".to_string(),
            }
        } else {
            match c {
                "S" => "повільний показ тексту",
                "{" => "збільшити шрифт",
                "}" => "зменшити шрифт",
                "." => "пауза чверть секунди",
                "|" => "пауза секунда",
                "!" => "чекати натискання",
                ">" => "миттєвий показ до \\<",
                "<" => "кінець миттєвого показу",
                "^" => "не чекати натискання в кінці",
                "$" => "вікно із золотом",
                _ => "керівний код гри",
            }
            .to_string()
        };
        add(code, meaning);
    }
    out
}
