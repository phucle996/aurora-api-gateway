//! Policy Shared Memory C ABI Layer
//!
//! Exposes shared memory policy initialization, slot reading, and slot updating
//! to NGINX C worker processes and external toolings.

use aurora_engine::shm::{
    POLICY_MAX_SLOTS, POLICY_SHM_DEFAULT_PATH, POLICY_SHM_TOTAL_BYTES, PolicyShmHeader,
};
use std::ffi::CStr;
use std::fs::OpenOptions;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

static GATEWAY_POLICY_SHM: AtomicPtr<PolicyShmHeader> = AtomicPtr::new(ptr::null_mut());

/// Retrieve global PolicyShmHeader reference if initialized.
/// Retrieve global PolicyShmHeader reference if initialized.
#[inline(always)]
pub fn policy_shm() -> Option<&'static mut PolicyShmHeader> {
    let ptr = GATEWAY_POLICY_SHM.load(Ordering::Acquire);
    if ptr.is_null() {
        None
    } else {
        // SAFETY: GATEWAY_POLICY_SHM is atomically swapped and points to a memory-mapped
        // region of size POLICY_SHM_TOTAL_BYTES containing a valid PolicyShmHeader.
        Some(unsafe { &mut *ptr })
    }
}

/// Initialize shared memory file for dynamic policy updates.
///
/// Returns 0 on success, 1 on failure.
///
/// # Safety
/// If `path` is non-null, it must point to a valid null-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_init_policy_shm(path: *const std::ffi::c_char) -> u32 {
    let target_path = if !path.is_null() {
        // SAFETY: Caller guarantees path is a valid null-terminated C string.
        if let Ok(s) = unsafe { CStr::from_ptr(path).to_str() } {
            if !s.is_empty() { Some(s) } else { None }
        } else {
            None
        }
    } else {
        None
    };

    let target = target_path.unwrap_or(POLICY_SHM_DEFAULT_PATH);

    let file_res = OpenOptions::new()
        .read(true)
        .write(true)
        .open(target)
        .or_else(|_| {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o666)
                .open(target)
        });

    if let Ok(file) = file_res {
        let _ = file.set_len(POLICY_SHM_TOTAL_BYTES as u64);
        let _ = file.set_permissions(std::fs::Permissions::from_mode(0o666));
        let fd = file.as_raw_fd();

        // SAFETY: fd is an open file descriptor sized to POLICY_SHM_TOTAL_BYTES.
        let mmap_ptr = unsafe {
            libc::mmap(
                ptr::null_mut(),
                POLICY_SHM_TOTAL_BYTES,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd,
                0,
            )
        };

        if mmap_ptr != libc::MAP_FAILED && !mmap_ptr.is_null() {
            let header_ptr = mmap_ptr as *mut PolicyShmHeader;

            // SAFETY: header_ptr is valid memory-mapped buffer of sufficient size.
            unsafe {
                (*header_ptr).ensure_header();
            }
            GATEWAY_POLICY_SHM.store(header_ptr, Ordering::Release);
            return 0;
        }
    }

    1
}

/// Returns the current total generation of the policy SHM.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_policy_generation() -> u64 {
    if let Some(shm) = policy_shm() {
        shm.get_total_generation()
    } else {
        0
    }
}

/// Retrieves the policy JSON bytes pointer and length for a slot.
/// Returns pointer to payload bytes in SHM, or NULL if empty/disabled.
///
/// # Safety
/// `out_gen` and `out_len` must be non-null and valid pointers.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_policy_slot_get(
    slot_id: u32,
    out_gen: *mut u64,
    out_len: *mut usize,
) -> *const u8 {
    if out_gen.is_null() || out_len.is_null() {
        return ptr::null();
    }

    if let Some(shm) = policy_shm() {
        if let Some((slot_gen, data)) = shm.read_slot(slot_id) {
            // SAFETY: out_gen and out_len checked non-null above.
            unsafe {
                *out_gen = slot_gen;
                *out_len = data.len();
            }
            if data.is_empty() {
                ptr::null()
            } else {
                data.as_ptr()
            }
        } else {
            // SAFETY: out_gen and out_len checked non-null above.
            unsafe {
                *out_gen = 0;
                *out_len = 0;
            }
            ptr::null()
        }
    } else {
        // SAFETY: out_gen and out_len checked non-null above.
        unsafe {
            *out_gen = 0;
            *out_len = 0;
        }
        ptr::null()
    }
}

/// Updates a policy slot in SHM. Used by Agent / control plane writers.
/// Returns 0 on success, 1 on invalid slot or payload overflow.
///
/// # Safety
/// If `len > 0`, `data` must point to readable memory of at least `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_policy_writer_update(
    slot_id: u32,
    generation: u64,
    data: *const u8,
    len: usize,
) -> u32 {
    if slot_id as usize >= POLICY_MAX_SLOTS {
        return 1;
    }

    let payload = if !data.is_null() && len > 0 {
        // SAFETY: Caller guarantees that if data is non-null and len > 0, data points
        // to at least len valid, initialized, readable bytes.
        Some(unsafe { std::slice::from_raw_parts(data, len) })
    } else {
        None
    };

    if let Some(shm) = policy_shm() {
        if shm.update_slot(slot_id, generation, payload) {
            0
        } else {
            1
        }
    } else {
        1
    }
}

/// Clears a policy slot in SHM (marks disabled).
/// Returns 0 on success, 1 on error.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_policy_writer_clear(slot_id: u32, generation: u64) -> u32 {
    if let Some(shm) = policy_shm() {
        if shm.update_slot(slot_id, generation, None) {
            0
        } else {
            1
        }
    } else {
        1
    }
}

/// Stops policy SHM mapping and unmaps shared memory.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_stop_policy_shm() {
    let ptr = GATEWAY_POLICY_SHM.swap(ptr::null_mut(), Ordering::SeqCst);
    if !ptr.is_null() {
        // SAFETY: ptr was created via mmap with length POLICY_SHM_TOTAL_BYTES.
        unsafe {
            libc::munmap(ptr as *mut libc::c_void, POLICY_SHM_TOTAL_BYTES);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_ffi_roundtrip() {
        let tmp_path = format!("/tmp/test_aurora_policy_{}.bin", std::process::id());
        let c_path = std::ffi::CString::new(tmp_path.clone()).unwrap();

        assert_eq!(
            unsafe { aurora_gateway_init_policy_shm(c_path.as_ptr()) },
            0
        );
        assert_eq!(aurora_gateway_policy_generation(), 0);

        let json = br#"{"test": true}"#;
        assert_eq!(
            unsafe { aurora_gateway_policy_writer_update(0, 42, json.as_ptr(), json.len(),) },
            0
        );
        assert_eq!(aurora_gateway_policy_generation(), 1);

        let mut read_gen: u64 = 0;
        let mut len: usize = 0;
        let ptr = unsafe { aurora_gateway_policy_slot_get(0, &mut read_gen, &mut len) };
        assert!(!ptr.is_null());
        assert_eq!(read_gen, 42);
        assert_eq!(len, json.len());

        let read_slice = unsafe { std::slice::from_raw_parts(ptr, len) };
        assert_eq!(read_slice, json);

        // Clear
        assert_eq!(aurora_gateway_policy_writer_clear(0, 43), 0);
        assert_eq!(aurora_gateway_policy_generation(), 2);
        let ptr_cleared = unsafe { aurora_gateway_policy_slot_get(0, &mut read_gen, &mut len) };
        assert!(ptr_cleared.is_null());
        assert_eq!(read_gen, 43);
        assert_eq!(len, 0);

        aurora_gateway_stop_policy_shm();
        let _ = std::fs::remove_file(tmp_path);
    }
}
