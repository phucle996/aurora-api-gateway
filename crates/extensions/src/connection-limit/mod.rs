//! Aurora Connection Limit Extension - In-process and distributed concurrent connection limiter.

pub mod engine;
pub mod redis;
pub mod tracker;
pub mod types;

#[cfg(test)]
mod tests;

pub use engine::ConnectionLimitEngine;
pub use types::{
    ActionOnExceeded, ConnLimitDecision, ConnLimitMode, ConnLimitToken, LimitBy, OnErrorAction,
    ResolvedHeader,
};
