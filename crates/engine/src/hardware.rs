//! Hardware topology and runtime environment primitives.

use std::sync::OnceLock;

/// Returns the number of logical CPU cores available to the current process.
///
/// Respects Linux cgroups (e.g. Docker container limits, Kubernetes CPU limits)
/// as well as OS process CPU affinities.
///
/// Uses `OnceLock` so hardware detection executes exactly once during engine boot,
/// eliminating all ongoing filesystem reads (`/sys/fs/cgroup`) and syscall overhead.
#[inline]
pub fn cpu_cores() -> usize {
    static CORES: OnceLock<usize> = OnceLock::new();
    *CORES.get_or_init(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cpu_cores_detection() {
        let cores = cpu_cores();
        assert!(cores >= 1, "Expected at least 1 core, got {cores}");
        // Idempotency check: repeated calls must return the identical cached value
        assert_eq!(cores, cpu_cores());
    }
}
