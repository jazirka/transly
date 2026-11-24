//! `model.ts`: типи даних проєкту. Порядок полів у структурах повторює порядок, у якому їх будує TS-код
//! (від нього залежить порівняння `JSON.stringify` у «нічиїх» злиття).

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// Стан рядка. Рухається лише вперед: new → draft → done → appr.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    New,
    Draft,
    Done,
    Appr,
}

impl Status {
    /// `knownStatus`: усе, що не є одним із чотирьох, стає `new`.
    pub fn known(s: &str) -> Status {
        match s {
            "draft" => Status::Draft,
            "done" => Status::Done,
            "appr" => Status::Appr,
            _ => Status::New,
        }
    }
    /// `STATUS_RANK` у merge.ts.
    pub fn rank(self) -> u8 {
        self as u8
    }
}

impl<'de> Deserialize<'de> for Status {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::String(s) => Status::known(&s),
            _ => Status::New,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitKind {
    Dialogue,
    Choice,
    Scroll,
    Name,
    Description,
    Message,
    Term,
}

impl UnitKind {
    /// `KIND_LABEL`.
    pub fn label(&self) -> &'static str {
        match self {
            UnitKind::Dialogue => "діалог",
            UnitKind::Choice => "варіант вибору",
            UnitKind::Scroll => "прокрутний текст",
            UnitKind::Name => "назва",
            UnitKind::Description => "опис",
            UnitKind::Message => "повідомлення",
            UnitKind::Term => "термін гри",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariableCond {
    pub id: i64,
    pub min: f64,
}

/// Умови сторінки події (id посилаються на назви перемикачів і змінних System.json).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PageInfo {
    pub trigger: i64,
    pub x: i64,
    pub y: i64,
    pub switches: Vec<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variable: Option<VariableCond>,
    #[serde(default, rename = "selfSwitch", skip_serializing_if = "Option::is_none")]
    pub self_switch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<i64>,
}

/// Один рядок для перекладу, витягнутий з файлу гри.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Unit {
    pub key: String,
    pub source: String,
    pub speaker: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, rename = "dbNote", skip_serializing_if = "Option::is_none")]
    pub db_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageInfo>,
    pub kind: UnitKind,
    pub context: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommentRes {
    pub who: String,
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Comment {
    pub who: String,
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub re: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub res: Option<CommentRes>,
    #[serde(default, deserialize_with = "crate::js::lenient_opt_i64", skip_serializing_if = "Option::is_none")]
    pub ed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub del: Option<bool>,
    /// Невідомі поля (від новішої версії): проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Голос за внесок рядка; `v` 0 — знятий голос (лишається слідом для злиття).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vote {
    pub who: String,
    pub on: String,
    pub v: i8,
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    /// Невідомі поля (від новішої версії): проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Внесок, знятий з картки рядка (`off`: повернений).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Drop {
    pub who: String,
    pub on: String,
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub off: Option<bool>,
    /// Невідомі поля (від новішої версії): проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Prev {
    pub target: String,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returned: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HistoryItem {
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub at: i64,
    pub who: String,
    pub what: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev: Option<Prev>,
    /// Невідомі поля (від новішої версії): проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Збережений і зливаний стан одного рядка.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub target: String,
    pub status: Status,
    #[serde(deserialize_with = "crate::js::lenient_i64")]
    pub mt: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orig: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ign: Option<Vec<String>>,
    #[serde(default, rename = "ignAt", deserialize_with = "crate::js::lenient_opt_i64", skip_serializing_if = "Option::is_none")]
    pub ign_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<Comment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub votes: Option<Vec<Vote>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drops: Option<Vec<Drop>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<Vec<HistoryItem>>,
    /// Невідомі поля (від новішої версії): проходять без змін.
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

impl Entry {
    /// Порожній запис (`blank` у workflow.ts).
    pub fn blank() -> Entry {
        Entry {
            target: String::new(),
            status: Status::New,
            mt: 0,
            src: None,
            orig: None,
            returned: None,
            ign: None,
            ign_at: None,
            comments: None,
            votes: None,
            drops: None,
            history: None,
            extra: Map::new(),
        }
    }
}

/// Порядок ключів — як у JS-об'єкті (вставка), тож умови конфліктів і результат злиття йдуть в тому ж порядку.
pub type Translations = IndexMap<String, Entry>;

/// Файл гри: розібраний JSON (ядро його ніколи не змінює) або сирий текст .po/.csv/.rpy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GameFile {
    pub name: String,
    pub json: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Позначка часу нової правки рядка, що вже має позначку: завжди новіша за попередню, навіть коли годинник відстає.
pub fn next_mt(prev: Option<i64>, now: i64) -> i64 {
    match prev {
        Some(p) if p >= now => p + 1,
        _ => now,
    }
}
