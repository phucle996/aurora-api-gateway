pub mod engine;
pub mod policy;
pub mod security;

#[cfg(test)]
mod tests;

pub use engine::BlueGreenEngine;
pub use policy::{
    BlueGreenDecision, BlueGreenEvalRequest, BlueGreenRuleInput, BlueGreenSnapshot,
    CompiledBlueGreenRule, DeploySlot, SlotSheet, SlotUpstreamMeta, UpstreamHeaderInput,
    MAX_BLUE_GREEN_POLICY_BYTES, MAX_BLUE_GREEN_RULES, SLOT_BLUE, SLOT_GREEN, SLOT_NAMES,
};
pub use security::{
    constant_time_eq, extract_cookie_value, extract_query_value, fnv1a_64, parse_slot_swar,
    select_slot_branchless, verify_cidr_boundary, verify_preview_secret, MAGIC_BLUE_U32,
    MAGIC_GREEN_LOWER_U32, MASK_U32,
};
