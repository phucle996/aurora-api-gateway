//! Aurora Upstream Management - Dynamic In-Memory Registry and C-ABI Exports.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
    sync::{Arc, RwLock},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpstreamNodeRecord {
    pub id: String,
    pub address: String,
    pub weight: u32,
    #[serde(default)]
    pub backup: bool,
    #[serde(default)]
    pub healthy: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpstreamItemRecord {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub architecture_type: String,
    #[serde(default)]
    pub algorithm: String,
    #[serde(default)]
    pub servers: Vec<UpstreamNodeRecord>,
    #[serde(default)]
    pub external_fqdn: String,
}

#[derive(Default, Debug)]
pub struct UpstreamRegistry {
    pub pools: HashMap<String, UpstreamItemRecord>,
}

/// Dynamic in-memory Upstream Registry maintained by background sync thread in NGINX Worker.
pub static DYNAMIC_UPSTREAM_REGISTRY: RwLock<Option<Arc<UpstreamRegistry>>> = RwLock::new(None);

/// C-ABI: Đổi mới nguyên tử toàn bộ Upstream Registry trong RAM từ chuỗi byte JSON.
/// Trả về 0 (OK), 1 (INVALID), 2 (PANIC).
///
/// # Safety
///
/// `data` must point to a valid, initialized byte buffer of at least `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_upstream_swap(data: *const u8, len: usize) -> u32 {
    if data.is_null() || len == 0 || len > 1_048_576 {
        return 1;
    }

    catch_unwind(AssertUnwindSafe(|| {
        let raw = unsafe { slice::from_raw_parts(data, len) };
        let items: Vec<UpstreamItemRecord> = match serde_json::from_slice(raw) {
            Ok(list) => list,
            Err(_) => return 1,
        };

        let mut pools = HashMap::with_capacity(items.len());
        for item in items {
            pools.insert(item.name.clone(), item);
        }

        let registry = UpstreamRegistry { pools };
        if let Ok(mut g) = DYNAMIC_UPSTREAM_REGISTRY.write() {
            *g = Some(Arc::new(registry));
            0
        } else {
            1
        }
    }))
    .unwrap_or(2)
}

/// C-ABI: Lấy số lượng upstream pools hiện có trong RAM.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_upstream_count() -> u32 {
    if let Ok(guard) = DYNAMIC_UPSTREAM_REGISTRY.read()
        && let Some(reg) = guard.as_ref()
    {
        return reg.pools.len() as u32;
    }
    0
}

/// C-ABI: Tra cứu địa chỉ máy chủ backend đầu tiên của pool theo tên.
/// Trả về 0 nếu tìm thấy, 1 nếu không tìm thấy hoặc buffer không đủ.
///
/// # Safety
///
/// `name` must point to a valid byte buffer of length `name_len`.
/// `out_addr` must point to a mutable buffer of capacity `out_addr_cap`.
/// `out_addr_len` must be a valid, aligned pointer to `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_upstream_lookup(
    name: *const u8,
    name_len: usize,
    out_addr: *mut u8,
    out_addr_cap: usize,
    out_addr_len: *mut usize,
) -> u32 {
    if name.is_null() || name_len == 0 || out_addr.is_null() || out_addr_len.is_null() {
        return 1;
    }

    catch_unwind(AssertUnwindSafe(|| {
        let name_bytes = unsafe { slice::from_raw_parts(name, name_len) };
        let name_str = match std::str::from_utf8(name_bytes) {
            Ok(s) => s,
            Err(_) => return 1,
        };

        if let Ok(guard) = DYNAMIC_UPSTREAM_REGISTRY.read()
            && let Some(reg) = guard.as_ref()
            && let Some(pool) = reg.pools.get(name_str)
            && let Some(srv) = pool.servers.first()
        {
            let addr_bytes = srv.address.as_bytes();
            if addr_bytes.len() > out_addr_cap {
                return 1;
            }
            unsafe {
                std::ptr::copy_nonoverlapping(addr_bytes.as_ptr(), out_addr, addr_bytes.len());
                *out_addr_len = addr_bytes.len();
            }
            return 0;
        }
        1
    }))
    .unwrap_or(2)
}
