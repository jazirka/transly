//! `links.ts` (частина): злиття винятків із зв'язку «рядки з однаковим оригіналом зв'язані». Решта прийде окремим кроком.

use crate::groups::merge_mt_records;
use serde_json::{Map, Value};

/// Дві копії винятків: по елементу перемагає новіший, а старше за останнє скидання відкидається.
pub fn merge_link_data(a: Option<&Map<String, Value>>, b: Option<&Map<String, Value>>, epoch: i64) -> Option<Map<String, Value>> {
    merge_mt_records(a, b, epoch)
}
