//! `groups.ts` (частина): злиття груп і членів двох копій. Решта (сцени, індекс, підрахунки груп) прийде з модулями сцен.

use serde_json::{Map, Value};

/// Два записи про групи/членів/зв'язки: по елементу перемагає новіший, а старше за останнє скидання відкидається.
/// `None`, коли обох немає або після відбору нічого не лишилось.
pub fn merge_mt_records(x: Option<&Map<String, Value>>, y: Option<&Map<String, Value>>, epoch: i64) -> Option<Map<String, Value>> {
    if x.is_none() && y.is_none() {
        return None;
    }
    let mt = |v: &Value| v.get("mt").and_then(|m| m.as_f64());
    let mut out: Map<String, Value> = Map::new();
    for src in [x, y].into_iter().flatten() {
        for (k, v) in src {
            let newer = mt(v).is_some_and(|m| m > epoch as f64) && out.get(k).is_none_or(|o| mt(v).unwrap_or(f64::NAN) > mt(o).unwrap_or(f64::NAN));
            if newer {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

/// Групи й члени двох копій: `(groups, members)`.
#[allow(clippy::type_complexity)]
pub fn merge_group_data(a: (Option<&Map<String, Value>>, Option<&Map<String, Value>>), b: (Option<&Map<String, Value>>, Option<&Map<String, Value>>), epoch: i64) -> (Option<Map<String, Value>>, Option<Map<String, Value>>) {
    (merge_mt_records(a.0, b.0, epoch), merge_mt_records(a.1, b.1, epoch))
}
