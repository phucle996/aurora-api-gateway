pub mod engine;
pub mod types;

#[cfg(test)]
mod tests;

pub use engine::TrafficSplitEngine;
pub use types::{
    SplitBy, SplitTargetInput, TrafficSplitDecision, TrafficSplitEvalRequest, TrafficSplitRuleInput,
    TrafficSplitSnapshot,
};
