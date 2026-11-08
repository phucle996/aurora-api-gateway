//! High-Performance Fixed-Point Rate Limiting Algorithms (Slot 2).
//!
//! Replaces floating-point arithmetic (`f64`) with 64-bit Integer Fixed-Point
//! arithmetic (Milli-tokens, scale factor: 1,000) to eliminate FPU round-trips
//! and floating-point rounding drift on the hot path.

use super::policy::{ActionOnExceeded, CompiledRule, RateLimitAlgorithm, RateLimitDecision};

/// Fixed-point scaling factor: 1 token = 1,000 milli-tokens.
pub const FIXED_POINT_SCALE: u64 = 1_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AlgorithmState {
    TokenBucket {
        tokens_milli: u64,
        last_refill_ms: u64,
    },
    LeakyBucket {
        water_level_milli: u64,
        last_leak_ms: u64,
    },
    FixedWindow {
        window_id: u64,
        count: u64,
    },
    SlidingWindow {
        window_id: u64,
        current_count: u64,
        previous_count: u64,
    },
}

impl AlgorithmState {
    #[inline]
    pub fn init(
        algorithm: RateLimitAlgorithm,
        rule: &CompiledRule,
        now_secs: u64,
        now_ms: u64,
    ) -> Self {
        match algorithm {
            RateLimitAlgorithm::TokenBucket => Self::TokenBucket {
                tokens_milli: rule.burst.saturating_mul(FIXED_POINT_SCALE),
                last_refill_ms: now_ms,
            },
            RateLimitAlgorithm::LeakyBucket => Self::LeakyBucket {
                water_level_milli: 0,
                last_leak_ms: now_ms,
            },
            RateLimitAlgorithm::FixedWindow => Self::FixedWindow {
                window_id: now_secs / rule.period_secs,
                count: 0,
            },
            RateLimitAlgorithm::SlidingWindow => Self::SlidingWindow {
                window_id: now_secs / rule.period_secs,
                current_count: 0,
                previous_count: 0,
            },
        }
    }

    #[inline]
    pub fn advance(
        &mut self,
        rule: &CompiledRule,
        now_secs: u64,
        now_ms: u64,
    ) -> RateLimitDecision {
        match self {
            Self::TokenBucket {
                tokens_milli,
                last_refill_ms,
            } => {
                let capacity = rule.burst.saturating_mul(FIXED_POINT_SCALE);
                let elapsed_ms = now_ms.saturating_sub(*last_refill_ms);
                let capped_elapsed_ms = elapsed_ms.min(rule.period_secs.saturating_mul(1000));

                // Refill: (capped_elapsed_ms * rule.rate * FIXED_POINT_SCALE) / (rule.period_secs * 1000)
                let refill_milli = (capped_elapsed_ms.saturating_mul(rule.rate)) / rule.period_secs;
                *tokens_milli = (*tokens_milli + refill_milli).min(capacity);
                *last_refill_ms = now_ms;

                if *tokens_milli >= FIXED_POINT_SCALE {
                    *tokens_milli -= FIXED_POINT_SCALE;
                    let remaining = (*tokens_milli / FIXED_POINT_SCALE) as u32;
                    let needed_milli = capacity.saturating_sub(*tokens_milli);
                    let refill_rate_per_sec =
                        (rule.rate.saturating_mul(FIXED_POINT_SCALE)) / rule.period_secs;
                    let reset_epoch = if refill_rate_per_sec == 0 {
                        now_secs + rule.period_secs
                    } else {
                        now_secs + needed_milli.div_ceil(refill_rate_per_sec)
                    };
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let needed_milli = FIXED_POINT_SCALE.saturating_sub(*tokens_milli);
                    let rate_scaled = rule.rate.saturating_mul(FIXED_POINT_SCALE);
                    let ms_needed = (needed_milli
                        .saturating_mul(rule.period_secs.saturating_mul(1000))
                        .saturating_add(rate_scaled.saturating_sub(1)))
                        / rate_scaled.max(1);
                    let retry_after = ms_needed.div_ceil(1000).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64)
                }
            }
            Self::LeakyBucket {
                water_level_milli,
                last_leak_ms,
            } => {
                let capacity = rule.burst.saturating_mul(FIXED_POINT_SCALE);
                let elapsed_ms = now_ms.saturating_sub(*last_leak_ms);
                let capped_elapsed_ms = elapsed_ms.min(rule.period_secs.saturating_mul(1000));

                // Leak: (capped_elapsed_ms * rule.rate * FIXED_POINT_SCALE) / (rule.period_secs * 1000)
                let leak_milli = (capped_elapsed_ms.saturating_mul(rule.rate)) / rule.period_secs;
                *water_level_milli = water_level_milli.saturating_sub(leak_milli);
                *last_leak_ms = now_ms;

                if *water_level_milli + FIXED_POINT_SCALE <= capacity {
                    *water_level_milli += FIXED_POINT_SCALE;
                    let remaining =
                        ((capacity.saturating_sub(*water_level_milli)) / FIXED_POINT_SCALE) as u32;
                    let leak_rate_per_sec =
                        (rule.rate.saturating_mul(FIXED_POINT_SCALE)) / rule.period_secs;
                    let reset_epoch = if leak_rate_per_sec == 0 {
                        now_secs + rule.period_secs
                    } else {
                        now_secs + water_level_milli.div_ceil(leak_rate_per_sec)
                    };
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let overflow_milli =
                        (*water_level_milli + FIXED_POINT_SCALE).saturating_sub(capacity);
                    let rate_scaled = rule.rate.saturating_mul(FIXED_POINT_SCALE);
                    let ms_needed = (overflow_milli
                        .saturating_mul(rule.period_secs.saturating_mul(1000))
                        .saturating_add(rate_scaled.saturating_sub(1)))
                        / rate_scaled.max(1);
                    let retry_after = ms_needed.div_ceil(1000).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64)
                }
            }
            Self::FixedWindow { window_id, count } => {
                let current_window = now_secs / rule.period_secs;
                if *window_id != current_window {
                    *window_id = current_window;
                    *count = 0;
                }
                let reset_epoch = (*window_id + 1) * rule.period_secs;
                if *count < rule.rate {
                    *count += 1;
                    let remaining = (rule.rate - *count) as u32;
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let retry_after = reset_epoch.saturating_sub(now_secs).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, reset_epoch)
                }
            }
            Self::SlidingWindow {
                window_id,
                current_count,
                previous_count,
            } => {
                let current_window = now_secs / rule.period_secs;
                if *window_id != current_window {
                    if current_window == *window_id + 1 {
                        *previous_count = *current_count;
                    } else {
                        *previous_count = 0;
                    }
                    *window_id = current_window;
                    *current_count = 0;
                }

                let time_into_window = now_secs % rule.period_secs;
                // Fixed-point weight scaled by FIXED_POINT_SCALE
                let weight_scaled = (rule
                    .period_secs
                    .saturating_sub(time_into_window)
                    .saturating_mul(FIXED_POINT_SCALE))
                    / rule.period_secs;

                let estimated_scaled = (*previous_count).saturating_mul(weight_scaled)
                    + (*current_count).saturating_mul(FIXED_POINT_SCALE);
                let capacity_scaled = rule.rate.saturating_mul(FIXED_POINT_SCALE);
                let reset_epoch = (*window_id + 1) * rule.period_secs;

                if estimated_scaled + FIXED_POINT_SCALE <= capacity_scaled {
                    *current_count += 1;
                    let remaining = ((capacity_scaled
                        .saturating_sub(estimated_scaled + FIXED_POINT_SCALE))
                        / FIXED_POINT_SCALE) as u32;
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let retry_after = reset_epoch.saturating_sub(now_secs).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, reset_epoch)
                }
            }
        }
    }
}

#[inline]
pub fn build_exceeded_decision(
    rule: &CompiledRule,
    retry_after: u32,
    reset_epoch: u64,
) -> RateLimitDecision {
    let (allowed, action, status_code) = match rule.action_on_exceeded {
        ActionOnExceeded::Audit => (true, ActionOnExceeded::Audit, 200),
        ActionOnExceeded::Block => (false, ActionOnExceeded::Block, rule.rejected_code),
        ActionOnExceeded::Throttle => (false, ActionOnExceeded::Throttle, rule.rejected_code),
        ActionOnExceeded::CustomResponse => {
            (false, ActionOnExceeded::CustomResponse, rule.rejected_code)
        }
    };
    RateLimitDecision {
        allowed,
        action,
        status_code,
        retry_after_secs: retry_after,
        remaining: 0,
        reset_epoch_secs: reset_epoch,
        custom_reason: None,
        headers: Vec::new(),
        body: None,
    }
}
