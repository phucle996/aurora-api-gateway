use crate::extensions::rate_limit::types::{
    ActionOnExceeded, CompiledRule, RateLimitAlgorithm, RateLimitDecision,
};

#[derive(Clone)]
pub(crate) enum AlgorithmState {
    TokenBucket {
        tokens: f64,
        last_refill_ms: u64,
    },
    LeakyBucket {
        water_level: f64,
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
    pub(crate) fn init(
        algorithm: RateLimitAlgorithm,
        rule: &CompiledRule,
        now_secs: u64,
        now_ms: u64,
    ) -> Self {
        match algorithm {
            RateLimitAlgorithm::TokenBucket => Self::TokenBucket {
                tokens: rule.burst as f64,
                last_refill_ms: now_ms,
            },
            RateLimitAlgorithm::LeakyBucket => Self::LeakyBucket {
                water_level: 0.0,
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

    pub(crate) fn advance(
        &mut self,
        rule: &CompiledRule,
        now_secs: u64,
        now_ms: u64,
    ) -> RateLimitDecision {
        match self {
            Self::TokenBucket {
                tokens,
                last_refill_ms,
            } => {
                let capacity = rule.burst as f64;
                let refill_rate = rule.rate as f64 / rule.period_secs as f64;
                let elapsed_secs = (now_ms.saturating_sub(*last_refill_ms)) as f64 / 1000.0;
                *tokens = (*tokens + elapsed_secs * refill_rate).min(capacity);
                *last_refill_ms = now_ms;

                if *tokens >= 1.0 {
                    *tokens -= 1.0;
                    let remaining = tokens.floor() as u32;
                    let reset_epoch = now_secs + ((capacity - *tokens) / refill_rate).ceil() as u64;
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let retry_after = ((1.0 - *tokens) / refill_rate).ceil().max(1.0) as u32;
                    build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64)
                }
            }
            Self::LeakyBucket {
                water_level,
                last_leak_ms,
            } => {
                let capacity = rule.burst as f64;
                let leak_rate = rule.rate as f64 / rule.period_secs as f64;
                let elapsed_secs = (now_ms.saturating_sub(*last_leak_ms)) as f64 / 1000.0;
                *water_level = (*water_level - elapsed_secs * leak_rate).max(0.0);
                *last_leak_ms = now_ms;

                if *water_level + 1.0 <= capacity {
                    *water_level += 1.0;
                    let remaining = (capacity - *water_level).floor() as u32;
                    let reset_epoch = now_secs + (*water_level / leak_rate).ceil() as u64;
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let retry_after = ((*water_level + 1.0 - capacity) / leak_rate)
                        .ceil()
                        .max(1.0) as u32;
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

                let time_into_window = (now_secs % rule.period_secs) as f64;
                let weight = 1.0 - (time_into_window / rule.period_secs as f64);
                let estimated_count = (*previous_count as f64 * weight) + *current_count as f64;
                let reset_epoch = (*window_id + 1) * rule.period_secs;

                if estimated_count + 1.0 <= rule.rate as f64 {
                    *current_count += 1;
                    let remaining = (rule.rate as f64 - estimated_count - 1.0).max(0.0) as u32;
                    RateLimitDecision::allow(remaining, reset_epoch)
                } else {
                    let retry_after = reset_epoch.saturating_sub(now_secs).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, reset_epoch)
                }
            }
        }
    }
}

pub(crate) fn build_exceeded_decision(
    rule: &CompiledRule,
    retry_after: u32,
    reset_epoch: u64,
) -> RateLimitDecision {
    let (allowed, action, status_code) = match rule.action_on_exceeded {
        ActionOnExceeded::Audit => (true, ActionOnExceeded::Audit, 200),
        ActionOnExceeded::Block => (false, ActionOnExceeded::Block, rule.rejected_code),
        ActionOnExceeded::Throttle => (false, ActionOnExceeded::Throttle, rule.rejected_code),
        ActionOnExceeded::CustomResponse => (false, ActionOnExceeded::CustomResponse, rule.rejected_code),
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
