//! Operating system kernel feature probing and network acceleration primitives.
//!
//! Safely probes operating system network stack capabilities (e.g. Linux socket options)
//! without disrupting network traffic, caching results statically for zero recurring overhead.

use std::sync::OnceLock;

/// Kernel supports `TCP_NOTSENT_LOWAT` (Linux 3.12+)
pub const CAP_TCP_NOTSENT_LOWAT: u32 = 1 << 0;
/// Kernel supports `SO_INCOMING_CPU` (Linux 3.19+)
pub const CAP_SO_INCOMING_CPU: u32 = 1 << 1;
/// Kernel supports `SO_BUSY_POLL` (Linux 3.11+)
pub const CAP_SO_BUSY_POLL: u32 = 1 << 2;
/// Kernel supports `TCP_USER_TIMEOUT` (Linux 2.6.37+)
pub const CAP_TCP_USER_TIMEOUT: u32 = 1 << 3;
/// Kernel supports `TCP_FASTOPEN` / `TCP_FASTOPEN_CONNECT` (Linux 4.11+)
pub const CAP_TCP_FASTOPEN: u32 = 1 << 4;
/// Kernel supports BBR congestion control algorithm
pub const CAP_TCP_BBR: u32 = 1 << 5;

/// Bitmap of detected kernel acceleration features.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KernelCapabilities {
    pub raw: u32,
}

impl KernelCapabilities {
    #[inline]
    pub const fn empty() -> Self {
        Self { raw: 0 }
    }

    #[inline]
    pub const fn has(&self, cap: u32) -> bool {
        (self.raw & cap) != 0
    }
}

/// Safely probes host OS kernel network stack capabilities.
///
/// Results are evaluated once and cached via `OnceLock`.
pub fn probe_kernel_capabilities() -> KernelCapabilities {
    static CAPS: OnceLock<KernelCapabilities> = OnceLock::new();
    *CAPS.get_or_init(|| {
        let mut caps = 0u32;
        #[cfg(target_os = "linux")]
        {
            let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
            if fd >= 0 {
                // 1. TCP_NOTSENT_LOWAT (Linux 3.12+, value 25)
                let notsent: libc::c_uint = 16384;
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::IPPROTO_TCP,
                        libc::TCP_NOTSENT_LOWAT,
                        &notsent as *const _ as *const libc::c_void,
                        std::mem::size_of_val(&notsent) as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_TCP_NOTSENT_LOWAT;
                }

                // 2. SO_INCOMING_CPU (Linux 3.19+, value 49)
                let cpu: libc::c_int = 0;
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::SOL_SOCKET,
                        libc::SO_INCOMING_CPU,
                        &cpu as *const _ as *const libc::c_void,
                        std::mem::size_of_val(&cpu) as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_SO_INCOMING_CPU;
                }

                // 3. SO_BUSY_POLL (Linux 3.11+, value 46)
                let busy_poll: libc::c_int = 50;
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::SOL_SOCKET,
                        libc::SO_BUSY_POLL,
                        &busy_poll as *const _ as *const libc::c_void,
                        std::mem::size_of_val(&busy_poll) as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_SO_BUSY_POLL;
                }

                // 4. TCP_USER_TIMEOUT (Linux 2.6.37+, value 18)
                let timeout: libc::c_uint = 15000;
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::IPPROTO_TCP,
                        libc::TCP_USER_TIMEOUT,
                        &timeout as *const _ as *const libc::c_void,
                        std::mem::size_of_val(&timeout) as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_TCP_USER_TIMEOUT;
                }

                // 5. TCP_FASTOPEN_CONNECT (Linux 4.11+, value 30)
                let tfo: libc::c_int = 1;
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::IPPROTO_TCP,
                        30, // TCP_FASTOPEN_CONNECT
                        &tfo as *const _ as *const libc::c_void,
                        std::mem::size_of_val(&tfo) as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_TCP_FASTOPEN;
                }

                // 6. TCP_CONGESTION (BBR)
                let bbr = b"bbr\0";
                let rc = unsafe {
                    libc::setsockopt(
                        fd,
                        libc::IPPROTO_TCP,
                        libc::TCP_CONGESTION,
                        bbr.as_ptr() as *const libc::c_void,
                        bbr.len() as libc::socklen_t,
                    )
                };
                if rc == 0 {
                    caps |= CAP_TCP_BBR;
                }

                unsafe { libc::close(fd) };
            }
        }
        KernelCapabilities { raw: caps }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kernel_capabilities_idempotence() {
        let caps1 = probe_kernel_capabilities();
        let caps2 = probe_kernel_capabilities();
        assert_eq!(caps1, caps2);
    }

    #[test]
    fn test_kernel_capabilities_flags() {
        let caps = KernelCapabilities {
            raw: CAP_TCP_NOTSENT_LOWAT | CAP_SO_INCOMING_CPU,
        };
        assert!(caps.has(CAP_TCP_NOTSENT_LOWAT));
        assert!(caps.has(CAP_SO_INCOMING_CPU));
        assert!(!caps.has(CAP_SO_BUSY_POLL));
    }
}
