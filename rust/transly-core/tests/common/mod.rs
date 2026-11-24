//! Спільне для тестів на золотих векторах.

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::PathBuf;

pub struct Case {
    pub input: Value,
    pub output: Value,
}

/// Читає `tests/vectors/<module>.json` і повертає випадки функції `func`.
pub fn cases(module: &str, func: &str) -> Vec<Case> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/vectors").join(format!("{module}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("немає векторів {}: {e} (запусти `npm run vectors` в app/)", path.display()));
    let all: Value = serde_json::from_str(&text).unwrap();
    let list = all.get(func).unwrap_or_else(|| panic!("у {module}.json немає {func}")).as_array().unwrap();
    assert!(!list.is_empty());
    list.iter().map(|c| Case { input: c["input"].clone(), output: c["output"].clone() }).collect()
}

pub fn get<T: DeserializeOwned>(v: &Value, key: &str) -> T {
    serde_json::from_value(v[key].clone()).unwrap_or_else(|e| panic!("поле {key}: {e}"))
}

pub fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

/// Точна рівність JSON (порядок ключів об'єкта не враховується, порядок елементів масиву — так).
pub fn assert_same(what: &str, i: usize, input: &Value, got: &Value, want: &Value) {
    assert!(got == want, "{what} #{i}\nвхід: {input}\nRust: {got}\nTS:   {want}");
}
