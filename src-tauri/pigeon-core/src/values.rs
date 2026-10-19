//! D86, D88: answers constrained to values the host supplies with each ask.
//!
//! `output_contract.host_values` names fields of the file's `output_schema`.
//! A name is a path of property names joined by `.`, where `name[]` steps
//! into the items of an array: `steps[].skill` is the `skill` of every step.
//! The word `label` stands for a label answer's own value.

use serde_json::Value;

/// The word `host_values` uses for a label answer's value.
pub const LABEL: &str = "label";

/// The schema node a `host_values` path names, if the schema has it.
pub fn field<'a>(schema: &'a Value, path: &str) -> Option<&'a Value> {
    let mut node = schema;
    for seg in path.split('.') {
        let (name, items) = match seg.strip_suffix("[]") {
            Some(n) => (n, true),
            None => (seg, false),
        };
        if name.is_empty() {
            return None;
        }
        node = node.get("properties")?.get(name)?;
        if items {
            node = node.get("items")?;
        }
    }
    Some(node)
}

fn field_mut<'a>(schema: &'a mut Value, path: &str) -> Option<&'a mut Value> {
    let mut node = schema;
    for seg in path.split('.') {
        let (name, items) = match seg.strip_suffix("[]") {
            Some(n) => (n, true),
            None => (seg, false),
        };
        node = node.get_mut("properties")?.get_mut(name)?;
        if items {
            node = node.get_mut("items")?;
        }
    }
    Some(node)
}

/// The schema with each named field held to the host's values: an `enum` of
/// exactly those, in the order given. None when a path is not in the schema.
pub fn with_values(schema: &Value, values: &[(String, Vec<Value>)]) -> Option<Value> {
    let mut out = schema.clone();
    for (path, allowed) in values {
        let node = field_mut(&mut out, path)?.as_object_mut()?;
        node.remove("pattern");
        node.remove("const");
        node.insert("enum".into(), Value::Array(allowed.clone()));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan() -> Value {
        json!({ "type": "object", "properties": {
            "steps": { "type": "array", "items": { "type": "object", "properties": {
                "id": { "type": "string", "pattern": "^s[1-8]$" },
                "skill": { "type": "string" },
                "input": { "type": "object" } }, "required": ["id", "skill", "input"] } } },
            "required": ["steps"] })
    }

    #[test]
    fn a_path_steps_into_properties_and_array_items() {
        let s = plan();
        assert_eq!(field(&s, "steps[].skill"), Some(&json!({ "type": "string" })));
        assert!(field(&s, "steps").is_some());
        assert!(field(&s, "steps.skill").is_none(), "skill is inside the items, not the array");
        assert!(field(&s, "steps[].nothing").is_none());
        assert!(field(&s, "").is_none());
    }

    #[test]
    fn the_hosts_values_become_the_fields_enum_and_the_order_is_kept() {
        let held = with_values(&plan(), &[("steps[].skill".into(), vec![json!("sum"), json!("product")])]).unwrap();
        assert_eq!(field(&held, "steps[].skill").unwrap()["enum"], json!(["sum", "product"]));
        let keys: Vec<&String> = held["properties"]["steps"]["items"]["properties"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["id", "skill", "input"], "the file's order, which is the order the answer is written in");
        assert!(with_values(&plan(), &[("steps[].nope".into(), vec![])]).is_none());
    }
}
