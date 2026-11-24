mod common;

use common::{assert_same, cases, to_value};
use serde_json::json;
use transly_core::units::clean_units;

#[test]
fn clean_units_match() {
    for (i, c) in cases("units", "cleanUnits").iter().enumerate() {
        let got = match clean_units(&c.input) {
            Ok(u) => json!({ "units": to_value(&u) }),
            Err(e) => json!({ "error": e }),
        };
        assert_same("cleanUnits", i, &c.input, &got, &c.output);
    }
}
