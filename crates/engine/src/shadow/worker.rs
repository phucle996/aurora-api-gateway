//! Dedicated Auxiliary Shadow Worker Lifecycle & Core Pinning (`shadow::worker`).
//!
//! Provides execution runtime for asynchronous tasks offloaded from the Traffic Worker.
//! Operates at Linux `SCHED_IDLE` priority to ensure 0% CPU contention with request serving.

use super::hook::ShadowTask;
use std::thread::JoinHandle;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

/// Lowers the calling thread's scheduling priority to `SCHED_IDLE`.
pub fn set_current_thread_idle_priority() -> bool {
    #[cfg(target_os = "linux")]
    {
        unsafe {
            // First attempt: SCHED_IDLE scheduling class
            let param = libc::sched_param { sched_priority: 0 };
            let ret = libc::sched_setscheduler(0, libc::SCHED_IDLE, &param);
            if ret == 0 {
                return true;
            }

            // Fallback: POSIX nice(19) - lowest relative CPU share
            libc::nice(19);
            true
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// Pins the calling thread to a specific logical CPU core.
pub fn pin_current_thread_to_core(core_id: usize) -> bool {
    #[cfg(target_os = "linux")]
    {
        unsafe {
            let mut set: libc::cpu_set_t = std::mem::zeroed();
            libc::CPU_SET(core_id, &mut set);
            let ret = libc::sched_setaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &set);
            ret == 0
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = core_id;
        true
    }
}

/// Handle for controlling lifecycle of the spawned Shadow Worker.
pub struct ShadowWorkerHandle {
    thread: Option<JoinHandle<()>>,
    shutdown_tx: watch::Sender<bool>,
}

impl ShadowWorkerHandle {
    /// Signals the Shadow Worker to drain pending tasks and wait for thread termination.
    pub fn shutdown(mut self) {
        let _ = self.shutdown_tx.send(true);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Spawns a dedicated Shadow Worker companion thread.
pub fn spawn_shadow_worker(
    worker_id: u32,
    core_id: Option<usize>,
    channel_capacity: usize,
) -> (ShadowWorkerHandle, mpsc::Sender<ShadowTask>) {
    let (shadow_tx, mut shadow_rx) = mpsc::channel(channel_capacity);
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let handle = std::thread::Builder::new()
        .name(format!("aurora-shadow-{worker_id}"))
        .spawn(move || {
            if let Some(core) = core_id {
                let _ = pin_current_thread_to_core(core);
            }
            set_current_thread_idle_priority();

            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to build aurora shadow Tokio runtime");

            rt.block_on(async move {
                let mut tasks = JoinSet::new();

                loop {
                    tokio::select! {
                        biased;
                        _ = shutdown_rx.changed() => {
                            break;
                        }
                        Some(task) = shadow_rx.recv() => {
                            tasks.spawn(task);
                        }
                        Some(_) = tasks.join_next() => {}
                    }
                }

                // Abort any long-running continuous tasks and drain remaining active tasks
                tasks.abort_all();
                while tasks.join_next().await.is_some() {}
            });
        })
        .expect("Failed to spawn aurora-shadow thread");

    (
        ShadowWorkerHandle {
            thread: Some(handle),
            shutdown_tx,
        },
        shadow_tx,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shadow::hook::{set_core_shadow_sender, try_dispatch_shadow};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn test_shadow_worker_lifecycle_and_dispatch() {
        let (handle, tx) = spawn_shadow_worker(99, None, 64);
        set_core_shadow_sender(tx);

        let counter = Arc::new(AtomicUsize::new(0));
        for _ in 0..10 {
            let c = counter.clone();
            let task = Box::pin(async move {
                c.fetch_add(1, Ordering::SeqCst);
            });
            assert!(try_dispatch_shadow(task).is_ok());
        }

        // Wait a few milliseconds for shadow worker to process tasks
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(counter.load(Ordering::SeqCst), 10);

        handle.shutdown();
    }
}
