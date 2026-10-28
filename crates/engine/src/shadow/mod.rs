//! Shadow Auxiliary Worker & Non-Blocking Task Hook (`shadow`).
//!
//! Provides the execution runtime and in-memory dispatch bridge enabling the
//! Primary Traffic Worker to offload auxiliary, background, or I/O-intensive
//! operations to an autonomous low-priority companion thread.

pub mod hook;
pub mod worker;

pub use hook::{
    ShadowTask, clear_core_shadow_sender, clear_global_shadow_sender, has_shadow_hook,
    set_core_shadow_sender, set_global_shadow_sender, try_dispatch_shadow,
};
pub use worker::{
    ShadowWorkerHandle, pin_current_thread_to_core, set_current_thread_idle_priority,
    spawn_shadow_worker,
};
