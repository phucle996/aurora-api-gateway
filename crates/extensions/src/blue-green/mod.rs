pub mod engine;
pub mod policy;
pub mod security;
pub mod sheet;
pub mod swar;

pub use engine::{BlueGreenDecision, BlueGreenEngine, BlueGreenEvalRequest};
pub use policy::{
    BlueGreenRuleInput, BlueGreenSnapshot, UpstreamHeaderInput, MAX_BLUE_GREEN_POLICY_BYTES,
    MAX_BLUE_GREEN_RULES,
};
pub use security::{
    extract_cookie_value, extract_query_value, verify_cidr_boundary, verify_preview_secret,
};
pub use sheet::{
    DeploySlot, SLOT_NAMES, SlotSheet, SlotUpstreamMeta,
};
pub use swar::{
    MAGIC_BLUE_U32, MAGIC_GREEN_LOWER_U32, MASK_U32, SLOT_BLUE, SLOT_GREEN, fnv1a_64,
    parse_slot_swar, select_slot_branchless,
};
