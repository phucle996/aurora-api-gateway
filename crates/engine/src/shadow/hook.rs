//! Generic Asynchronous Task Hook for Auxiliary Shadow Workers (`shadow::hook`).
//!
//! Provides thread-local and global dispatch hooks enabling extensions and pipelines
//! to offload asynchronous, non-critical, or background operations to dedicated
//! low-priority (`SCHED_IDLE`) Shadow Workers without contending with hot-path traffic processing.

use std::future::Future;
use std::pin::Pin;
use std::sync::RwLock;
use tokio::sync::mpsc;

/// Boxed thread-safe future representation of an asynchronous task executed on a Shadow Worker.
pub type ShadowTask = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

thread_local! {
    static LOCAL_SHADOW_SENDER: std::cell::RefCell<Option<mpsc::Sender<ShadowTask>>> = const { std::cell::RefCell::new(None) };
}

static GLOBAL_SHADOW_SENDER: RwLock<Option<mpsc::Sender<ShadowTask>>> = RwLock::new(None);

/// Sets the core-local Shadow Worker task hook sender for the calling thread.
pub fn set_core_shadow_sender(tx: mpsc::Sender<ShadowTask>) {
    LOCAL_SHADOW_SENDER.with(|cell| {
        *cell.borrow_mut() = Some(tx);
    });
}

/// Clears the core-local Shadow Worker task hook sender for the calling thread.
pub fn clear_core_shadow_sender() {
    LOCAL_SHADOW_SENDER.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

/// Sets the fallback global Shadow Worker task hook sender.
pub fn set_global_shadow_sender(tx: mpsc::Sender<ShadowTask>) {
    if let Ok(mut lock) = GLOBAL_SHADOW_SENDER.write() {
        *lock = Some(tx);
    }
}

/// Clears the fallback global Shadow Worker task hook sender.
pub fn clear_global_shadow_sender() {
    if let Ok(mut lock) = GLOBAL_SHADOW_SENDER.write() {
        *lock = None;
    }
}

/// Returns `true` if a Shadow Worker hook is currently registered (either core-local or global).
pub fn has_shadow_hook() -> bool {
    LOCAL_SHADOW_SENDER.with(|c| c.borrow().is_some())
        || GLOBAL_SHADOW_SENDER
            .read()
            .map(|g| g.is_some())
            .unwrap_or(false)
}

/// Attempts to dispatch a task to the Shadow Worker via non-blocking try_send.
///
/// Priority is given to the thread-local sender (zero cross-core contention).
/// If thread-local is not set, falls back to the global sender.
/// Returns `Ok(())` on success, or `Err(task)` if queues are full or uninitialized.
pub fn try_dispatch_shadow(task: ShadowTask) -> Result<(), ShadowTask> {
    if let Some(tx) = LOCAL_SHADOW_SENDER.with(|c| c.borrow().clone()) {
        return tx.try_send(task).map_err(|e| match e {
            mpsc::error::TrySendError::Full(t) | mpsc::error::TrySendError::Closed(t) => t,
        });
    }
    if let Some(tx) = GLOBAL_SHADOW_SENDER.read().ok().and_then(|g| g.clone()) {
        return tx.try_send(task).map_err(|e| match e {
            mpsc::error::TrySendError::Full(t) | mpsc::error::TrySendError::Closed(t) => t,
        });
    }
    Err(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    static TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    #[test]
    fn test_core_shadow_dispatch() {
        let _guard = TEST_LOCK.lock();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            clear_core_shadow_sender();
            let (tx, mut rx) = mpsc::channel(16);
            set_core_shadow_sender(tx);
            assert!(has_shadow_hook());

            let flag = Arc::new(AtomicBool::new(false));
            let flag_clone = flag.clone();

            let task = Box::pin(async move {
                flag_clone.store(true, Ordering::Release);
            });

            assert!(try_dispatch_shadow(task).is_ok());

            if let Some(received_task) = rx.recv().await {
                received_task.await;
            }

            assert!(flag.load(Ordering::Acquire));
            clear_core_shadow_sender();
        });
    }

    #[test]
    fn test_global_shadow_dispatch_fallback() {
        let _guard = TEST_LOCK.lock();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            clear_core_shadow_sender();
            let (tx, mut rx) = mpsc::channel(16);
            set_global_shadow_sender(tx);
            assert!(has_shadow_hook());

            let flag = Arc::new(AtomicBool::new(false));
            let flag_clone = flag.clone();

            let task = Box::pin(async move {
                flag_clone.store(true, Ordering::Release);
            });

            assert!(try_dispatch_shadow(task).is_ok());

            if let Some(received_task) = rx.recv().await {
                received_task.await;
            }

            assert!(flag.load(Ordering::Acquire));
            clear_global_shadow_sender();
        });
    }

    #[test]
    fn test_uninitialized_shadow_dispatch_fails() {
        clear_core_shadow_sender();
        clear_global_shadow_sender();
        assert!(!has_shadow_hook());

        let task = Box::pin(async {});
        assert!(try_dispatch_shadow(task).is_err());
    }
}
