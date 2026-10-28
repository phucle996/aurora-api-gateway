//! Aurora Gateway FFI - Phase-Driven C ABI Bridge.
//!
//! Exclusively reflects the 5 core HTTP phases and substrates:
//! - Phase 1: Ingress Access Phase (`phases::access`)
//! - Phase 2: Content Phase (`phases::content`)
//! - Phase 3: Header Filter Phase (`phases::header_filter`)
//! - Phase 4: Body Filter Phase (`phases::body_filter`)
//! - Phase 5: Log Phase (`phases::log`)
//! - Substrate: Policy Shared Memory Hot-Swap (`shm`)
//! - Substrate: Companion Shadow Worker Thread (`shadow`)
//! - Substrate: Polymorphic Extension Lifecycle (`lifecycle`)

pub mod lifecycle;
pub mod phases;
pub mod shadow;
pub mod shm;

pub use lifecycle::*;
pub use phases::*;
pub use shadow::*;
pub use shm::*;

/// Returns current ABI version (4).
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_abi_version() -> u32 {
    4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_abi_version() {
        assert_eq!(aurora_gateway_abi_version(), 4);
    }

    #[test]
    fn test_polymorphic_extension_lifecycle() {
        let ip_policy = br#"{"schema_version":1,"generation":42,"rules":[{"id":101,"priority":1,"action":"block","networks":["192.168.1.0/24"],"host":"*","path_prefix":"/api","method":"*","schedule":"always","expires_at":0,"log":true,"reputation":false,"alert":false}]}"#;

        let mut engine = std::ptr::null_mut();
        let ret = unsafe {
            aurora_gateway_extension_create(
                AURORA_EXT_IP_RESTRICTION as u32,
                ip_policy.as_ptr(),
                ip_policy.len(),
                &mut engine,
            )
        };
        assert_eq!(ret, 0);
        assert!(!engine.is_null());

        unsafe {
            aurora_gateway_extension_destroy(AURORA_EXT_IP_RESTRICTION as u32, engine);
        }
    }
}
