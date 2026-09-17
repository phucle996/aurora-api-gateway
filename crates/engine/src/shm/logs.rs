//! Shared Memory Log Bus State & Gating
//!
//! Provides lockless coordination between NGINX worker processes and Aurora Agent.
//! Allows NGINX to completely bypass log serialization and IPC when no log consumers are registered.

use std::sync::atomic::{AtomicU64, Ordering};

/// Log Bus Consumer Registration Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct LogBusMetrics {
    pub active_consumers: AtomicU64,
}

impl LogBusMetrics {
    pub const fn new() -> Self {
        Self {
            active_consumers: AtomicU64::new(0),
        }
    }

    /// Register an active log consumer. Returns the updated consumer count.
    #[inline(always)]
    pub fn register(&self) -> u64 {
        self.active_consumers.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Unregister an active log consumer. Returns the updated consumer count.
    #[inline(always)]
    pub fn unregister(&self) -> u64 {
        loop {
            let current = self.active_consumers.load(Ordering::SeqCst);
            if current == 0 {
                return 0;
            }
            let next = current - 1;
            if self
                .active_consumers
                .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return next;
            }
        }
    }

    /// Check if at least one log consumer is active (fast path gating for NGINX).
    #[inline(always)]
    pub fn is_active(&self) -> bool {
        self.active_consumers.load(Ordering::Relaxed) > 0
    }

    /// Returns the current active log consumers count.
    #[inline(always)]
    pub fn count(&self) -> u64 {
        self.active_consumers.load(Ordering::Relaxed)
    }

    /// Resets active log consumers count to 0 (useful on agent startup/recovery).
    #[inline(always)]
    pub fn reset(&self) {
        self.active_consumers.store(0, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> LogBusMetricsSnapshot {
        LogBusMetricsSnapshot {
            active_consumers: self.active_consumers.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LogBusMetricsSnapshot {
    pub active_consumers: u64,
}
