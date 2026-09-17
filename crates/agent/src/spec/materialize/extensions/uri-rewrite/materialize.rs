//! URI Rewrite extension materializer.
//!
//! Transforms request URI paths before forwarding to backend upstreams.
//! Supports conditional rewriting based on matching request headers (e.g. API versioning)
//! or unconditional path rewriting within location blocks.
//!
//! Injected into the `location { ... }` block with the `break` flag to immediately
//! halt further rewrite iterations within the current scope.

use crate::spec::materialize::extensions::common::nginx_fragment;
use serde_json::Value;

/// Materialize location-level URI rewrite rules configured via route `plugins_json`.
pub fn materialize(rules: &[Value], buf: &mut String) -> Result<(), String> {
    for rule in rules {
        if let Some(rewrite_path) = rule.get("rewrite_path").and_then(|path| path.as_str()) {
            let safe_rewrite_path = nginx_fragment(rewrite_path, "rewrite_path")?;
            if let Some(match_header) = rule
                .get("match_header")
                .and_then(|header| header.as_object())
            {
                for (header_name, header_value) in match_header {
                    let value = header_value.as_str().unwrap_or("");
                    let safe_header = nginx_fragment(header_name, "match_header key")?;
                    let safe_value = nginx_fragment(value, "match_header value")?;
                    let variable = format!(
                        "$http_{}",
                        safe_header.to_ascii_lowercase().replace('-', "_")
                    );
                    buf.push_str(&format!(
                        "        if ({variable} = \"{safe_value}\") {{\n            rewrite ^ {safe_rewrite_path} break;\n        }}\n"
                    ));
                }
            } else {
                buf.push_str(&format!("        rewrite ^ {safe_rewrite_path} break;\n"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_materialize_unconditional_rewrite() {
        let rules = vec![json!({
            "rewrite_path": "/new_path"
        })];
        let mut buf = String::new();
        materialize(&rules, &mut buf).unwrap();
        assert!(buf.contains("rewrite ^ /new_path break;"));
    }

    #[test]
    fn test_materialize_conditional_rewrite() {
        let rules = vec![json!({
            "match_header": { "X-API-Version": "2" },
            "rewrite_path": "/v2/items"
        })];
        let mut buf = String::new();
        materialize(&rules, &mut buf).unwrap();
        assert!(buf.contains("if ($http_x_api_version = \"2\")"));
        assert!(buf.contains("rewrite ^ /v2/items break;"));
    }
}
