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

/// Baseline 64-bit integer ALU and SWAR operations (always present on 64-bit targets)
pub const CPU_CAP_SWAR_64: u32 = 1 << 0;
/// SSE 4.2 vector instructions (128-bit)
pub const CPU_CAP_SSE42: u32 = 1 << 1;
/// AVX2 vector instructions (256-bit)
pub const CPU_CAP_AVX2: u32 = 1 << 2;
/// AVX-512 Foundation (512-bit)
pub const CPU_CAP_AVX512F: u32 = 1 << 3;
/// AVX-512 Byte and Word (512-bit character operations)
pub const CPU_CAP_AVX512BW: u32 = 1 << 4;
/// ARM NEON vector instructions (128-bit)
pub const CPU_CAP_ARM_NEON: u32 = 1 << 5;
/// Bit Manipulation Instruction Set 1
pub const CPU_CAP_BMI1: u32 = 1 << 6;
/// Bit Manipulation Instruction Set 2
pub const CPU_CAP_BMI2: u32 = 1 << 7;

/// Bitmap and profile of detected CPU vector and arithmetic acceleration capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuCapabilities {
    pub raw: u32,
    pub max_vector_width_bits: u16,
}

impl CpuCapabilities {
    #[inline]
    pub const fn empty() -> Self {
        Self {
            raw: 0,
            max_vector_width_bits: 64,
        }
    }

    #[inline]
    pub const fn has(&self, cap: u32) -> bool {
        (self.raw & cap) != 0
    }

    #[inline]
    pub const fn max_vector_width_bytes(&self) -> usize {
        (self.max_vector_width_bits / 8) as usize
    }

    /// Safe maximum vector width for network dataplane execution, explicitly capped at 256 bits (32 bytes).
    ///
    /// Preserves full CPU base/turbo clock frequency by eliminating AVX-512 thermal throttling
    /// and power-budget downclocking.
    #[inline]
    pub const fn safe_vector_width_bytes(&self) -> usize {
        if (self.raw & CPU_CAP_AVX2) != 0 {
            32 // 256-bit AVX2: Peak CPU frequency, zero downclocking
        } else if (self.raw & (CPU_CAP_SSE42 | CPU_CAP_ARM_NEON)) != 0 {
            16 // 128-bit SSE 4.2 / ARM NEON
        } else {
            8 // 64-bit SWAR baseline
        }
    }
}

/// Safely probes host CPU vector registers and instruction set extensions.
///
/// Evaluated exactly once during boot and cached statically via `OnceLock`.
pub fn probe_cpu_capabilities() -> CpuCapabilities {
    static CAPS: OnceLock<CpuCapabilities> = OnceLock::new();
    *CAPS.get_or_init(|| {
        let mut raw = CPU_CAP_SWAR_64;
        let mut width = 64u16;

        #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
        {
            if is_x86_feature_detected!("sse4.2") {
                raw |= CPU_CAP_SSE42;
                if width < 128 {
                    width = 128;
                }
            }
            if is_x86_feature_detected!("bmi1") {
                raw |= CPU_CAP_BMI1;
            }
            if is_x86_feature_detected!("bmi2") {
                raw |= CPU_CAP_BMI2;
            }
            if is_x86_feature_detected!("avx2") {
                raw |= CPU_CAP_AVX2;
                if width < 256 {
                    width = 256;
                }
            }
            if is_x86_feature_detected!("avx512f") {
                raw |= CPU_CAP_AVX512F;
                if width < 512 {
                    width = 512;
                }
            }
            if is_x86_feature_detected!("avx512bw") {
                raw |= CPU_CAP_AVX512BW;
                if width < 512 {
                    width = 512;
                }
            }
        }

        #[cfg(target_arch = "aarch64")]
        {
            if std::arch::is_aarch64_feature_detected!("neon") {
                raw |= CPU_CAP_ARM_NEON;
                width = 128;
            }
        }

        CpuCapabilities {
            raw,
            max_vector_width_bits: width,
        }
    })
}

/// Network driver classification and hardware capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NicDriverFamily {
    /// Enterprise hardware multi-queue (Mellanox mlx5/mlx4, Intel ice/i40e/ixgbe, Broadcom bnxt)
    EnterpriseHardwareRss,
    /// Cloud hypervisor virtual NIC (AWS ENA, GCP gVNIC, Azure NetVSC)
    CloudVirtualMultiQueue,
    /// Virtual hypervisor (VirtIO, VMXNET3, Xen) - dynamically scales based on host queue allocation
    VirtualDynamic,
    /// Budget / Consumer single-queue (Realtek r8169, Intel e1000e)
    BudgetSingleQueue,
    /// Unknown / generic driver
    Generic,
}

impl NicDriverFamily {
    pub fn from_driver_name(driver: &str) -> Self {
        match driver {
            "mlx5_core" | "mlx4_core" | "ice" | "i40e" | "ixgbe" | "bnxt_en" | "iavf"
            | "ixgbevf" => Self::EnterpriseHardwareRss,
            "ena" | "gve" | "hv_netvsc" => Self::CloudVirtualMultiQueue,
            "virtio_net" | "vmxnet3" | "xen-netfront" => Self::VirtualDynamic,
            "r8169" | "r8168" | "r8125" | "e1000" | "e1000e" => Self::BudgetSingleQueue,
            _ => Self::Generic,
        }
    }
}

/// Network Interface Card (NIC) queue topology and hardware RSS status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NicQueueProfile {
    pub iface: String,
    pub driver: String,
    pub driver_family: NicDriverFamily,
    pub rx_queues: usize,
    pub hardware_rss_active: bool,
    pub software_rps_recommended: bool,
    pub suggested_rps_mask: Option<String>,
}

/// Computes the hexadecimal CPU mask string for `cores` without integer overflow.
pub fn compute_cpu_mask(cores: usize) -> String {
    if cores == 0 {
        return "0".to_string();
    }
    let full_f = cores / 4;
    let rem = cores % 4;
    let mut mask = String::with_capacity(full_f + 1);
    match rem {
        1 => mask.push('1'),
        2 => mask.push('3'),
        3 => mask.push('7'),
        _ => {}
    }
    for _ in 0..full_f {
        mask.push('f');
    }
    mask
}

/// Probes the network interface topology and hardware RX queues on Linux.
///
/// Evaluates whether the hardware supports multi-queue Receive Side Scaling (RSS)
/// matching or exceeding host CPU cores, or whether Software Receive Packet
/// Steering (RPS) is recommended to prevent single-core SoftIRQ bottlenecks.
///
/// Cached via `OnceLock` after boot to eliminate recurring sysfs reads.
pub fn probe_nic_topology() -> Vec<NicQueueProfile> {
    static PROFILES: OnceLock<Vec<NicQueueProfile>> = OnceLock::new();
    PROFILES
        .get_or_init(|| {
            let cores = cpu_cores();
            let mask = compute_cpu_mask(cores);
            let mut results = Vec::new();

            #[cfg(target_os = "linux")]
            {
                let net_dir = std::path::Path::new("/sys/class/net");
                if let Ok(entries) = std::fs::read_dir(net_dir) {
                    for entry in entries.flatten() {
                        let file_name = entry.file_name();
                        let iface = file_name.to_string_lossy();

                        // Filter out loopback and virtual container/bridge interfaces
                        if iface == "lo"
                            || iface.starts_with("docker")
                            || iface.starts_with("br-")
                            || iface.starts_with("veth")
                            || iface.starts_with("virbr")
                            || iface.starts_with("lxcbr")
                            || iface.starts_with("tun")
                            || iface.starts_with("tap")
                        {
                            continue;
                        }

                        let queues_path = entry.path().join("queues");
                        if let Ok(q_entries) = std::fs::read_dir(queues_path) {
                            let rx_queues = q_entries
                                .flatten()
                                .filter(|q| q.file_name().to_string_lossy().starts_with("rx-"))
                                .count();

                            if rx_queues > 0 {
                                let driver = std::fs::read_link(entry.path().join("device/driver"))
                                    .ok()
                                    .and_then(|p| {
                                        p.file_name().map(|n| n.to_string_lossy().into_owned())
                                    })
                                    .unwrap_or_else(|| "unknown".to_string());
                                let driver_family = NicDriverFamily::from_driver_name(&driver);

                                let hardware_rss_active = rx_queues >= cores;
                                let software_rps_recommended = !hardware_rss_active && cores > 1;

                                results.push(NicQueueProfile {
                                    iface: iface.into_owned(),
                                    driver,
                                    driver_family,
                                    rx_queues,
                                    hardware_rss_active,
                                    software_rps_recommended,
                                    suggested_rps_mask: if software_rps_recommended {
                                        Some(mask.clone())
                                    } else {
                                        None
                                    },
                                });
                            }
                        }
                    }
                }
            }

            results
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_cpu_mask() {
        assert_eq!(compute_cpu_mask(0), "0");
        assert_eq!(compute_cpu_mask(1), "1");
        assert_eq!(compute_cpu_mask(2), "3");
        assert_eq!(compute_cpu_mask(3), "7");
        assert_eq!(compute_cpu_mask(4), "f");
        assert_eq!(compute_cpu_mask(8), "ff");
        assert_eq!(compute_cpu_mask(12), "fff");
        assert_eq!(compute_cpu_mask(16), "ffff");
        assert_eq!(compute_cpu_mask(64), "ffffffffffffffff");
    }

    #[test]
    fn test_probe_nic_topology() {
        let nics = probe_nic_topology();
        // Idempotency check: repeated calls must return identical cached result
        assert_eq!(nics, probe_nic_topology());
    }

    #[test]
    fn test_cpu_cores_detection() {
        let cores = cpu_cores();
        assert!(cores >= 1, "Expected at least 1 core, got {cores}");
        // Idempotency check: repeated calls must return the identical cached value
        assert_eq!(cores, cpu_cores());
    }

    #[test]
    fn test_cpu_capabilities_detection() {
        let caps = probe_cpu_capabilities();
        // Baseline 64-bit SWAR must always be active
        assert!(caps.has(CPU_CAP_SWAR_64));
        assert!(caps.max_vector_width_bits >= 64);
        assert!(caps.max_vector_width_bytes() >= 8);

        // Safe vector width must always be capped at 32 bytes (256-bit AVX2)
        assert!(caps.safe_vector_width_bytes() <= 32);
        assert!(caps.safe_vector_width_bytes() >= 8);

        // Idempotency check
        assert_eq!(caps, probe_cpu_capabilities());
    }
}
