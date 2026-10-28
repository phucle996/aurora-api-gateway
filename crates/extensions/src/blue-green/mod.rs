pub mod engine;
pub mod types;

#[cfg(test)]
mod tests;

pub use engine::BlueGreenEngine;
pub use types::{
    BlueGreenDecision, BlueGreenEvalRequest, BlueGreenRuleInput, BlueGreenSnapshot, DeploySlot,
    MAX_BLUE_GREEN_POLICY_BYTES, MAX_BLUE_GREEN_RULES,
};
