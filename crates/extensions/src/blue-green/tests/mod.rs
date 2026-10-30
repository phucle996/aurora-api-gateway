use super::*;

mod policy;
mod routing;
mod security;
mod swar;

pub(crate) fn eval_req<'a>(origin: &'a [u8], path: &'a [u8]) -> BlueGreenEvalRequest<'a> {
    BlueGreenEvalRequest::new(origin, path)
}

pub(crate) fn eval_req_full<'a>(
    origin: &'a [u8],
    path: &'a [u8],
    client_ip: &'a [u8],
    query: &'a [u8],
) -> BlueGreenEvalRequest<'a> {
    BlueGreenEvalRequest::with_details(origin, path, client_ip, query)
}

pub(crate) fn custom_policy_full(
    active_slot: &str,
    blue_up: &str,
    green_up: &str,
    path_prefix: &str,
    extra_rule_fields: &str,
) -> String {
    format!(
        r#"{{
            "schema_version": 1,
            "generation": 1,
            "rules": [
                {{
                    "id": "bg-rule",
                    "priority": 10,
                    "origin": "*",
                    "path_prefix": "{path_prefix}",
                    "active_slot": "{active_slot}",
                    "blue_upstream": "{blue_up}",
                    "green_upstream": "{green_up}",
                    "switch_header": "x-deploy-slot"
                    {extra_rule_fields}
                }}
            ]
        }}"#
    )
}

pub(crate) fn custom_policy(
    active_slot: &str,
    path_prefix: &str,
    extra_rule_fields: &str,
) -> String {
    custom_policy_full(active_slot, "app_blue", "app_green", path_prefix, extra_rule_fields)
}

pub(crate) fn base_policy(extra_rule_fields: &str) -> String {
    custom_policy("blue", "/", extra_rule_fields)
}
