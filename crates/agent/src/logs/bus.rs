use super::entry::GatewayLogEntry;
use aurora_engine::telemetry::{GatewaySharedMetrics, SHM_DEFAULT_PATH, SHM_SIZE_BYTES};
use std::fs::OpenOptions;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UnixDatagram;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

pub const LOG_SOCK_DEFAULT_PATH: &str = "/dev/shm/aurora_access.sock";
pub const DEFAULT_CHANNEL_CAPACITY: usize = 4096;
pub const SOCKET_RCVBUF_BYTES: libc::c_int = 4 * 1024 * 1024; // 4MB

/// Handle to shared memory for atomically managing log consumer count.
pub struct LogShmHandle {
    ptr: *mut GatewaySharedMetrics,
}

unsafe impl Send for LogShmHandle {}
unsafe impl Sync for LogShmHandle {}

impl LogShmHandle {
    pub fn open_or_create() -> Option<Self> {
        let path = SHM_DEFAULT_PATH;
        if let Ok(file) = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o666)
            .open(path)
        {
            let _ = file.set_len(SHM_SIZE_BYTES as u64);
            let _ = file.set_permissions(std::fs::Permissions::from_mode(0o666));
            let fd = file.as_raw_fd();
            let mmap_ptr = unsafe {
                libc::mmap(
                    std::ptr::null_mut(),
                    SHM_SIZE_BYTES,
                    libc::PROT_READ | libc::PROT_WRITE,
                    libc::MAP_SHARED,
                    fd,
                    0,
                )
            };
            if mmap_ptr != libc::MAP_FAILED && !mmap_ptr.is_null() {
                let metrics_ptr = mmap_ptr as *mut GatewaySharedMetrics;
                unsafe {
                    (*metrics_ptr).ensure_header();
                    (*metrics_ptr).reset_log_consumers();
                }
                return Some(Self { ptr: metrics_ptr });
            }
        }
        None
    }

    pub fn from_ptr(ptr: *mut GatewaySharedMetrics) -> Self {
        Self { ptr }
    }

    pub fn register_consumer(&self) -> u64 {
        if !self.ptr.is_null() {
            unsafe { (*self.ptr).register_log_consumer() }
        } else {
            0
        }
    }

    pub fn unregister_consumer(&self) -> u64 {
        if !self.ptr.is_null() {
            unsafe { (*self.ptr).unregister_log_consumer() }
        } else {
            0
        }
    }

    pub fn active_consumers(&self) -> u64 {
        if !self.ptr.is_null() {
            unsafe { (*self.ptr).active_log_consumers_count() }
        } else {
            0
        }
    }

    pub fn is_log_active(&self) -> bool {
        if !self.ptr.is_null() {
            unsafe { (*self.ptr).is_log_active() }
        } else {
            false
        }
    }
}

impl Drop for LogShmHandle {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                libc::munmap(self.ptr as *mut libc::c_void, SHM_SIZE_BYTES);
            }
        }
    }
}

/// Active subscription to the high-performance log bus.
/// Implements RAII: dropping unregisters the consumer from shared memory.
pub struct LogSubscription {
    consumer_name: String,
    receiver: broadcast::Receiver<Arc<GatewayLogEntry>>,
    shm: Option<Arc<LogShmHandle>>,
}

impl LogSubscription {
    pub fn new(
        consumer_name: String,
        receiver: broadcast::Receiver<Arc<GatewayLogEntry>>,
        shm: Option<Arc<LogShmHandle>>,
    ) -> Self {
        if let Some(ref handle) = shm {
            let active = handle.register_consumer();
            info!(
                consumer = %consumer_name,
                active_consumers = active,
                "Registered active log consumer on shared memory bus"
            );
        }
        Self {
            consumer_name,
            receiver,
            shm,
        }
    }

    pub fn consumer_name(&self) -> &str {
        &self.consumer_name
    }

    /// Receive the next log entry from the bus.
    /// Recovers gracefully if receiver briefly lagged.
    pub async fn recv(&mut self) -> Result<Arc<GatewayLogEntry>, broadcast::error::RecvError> {
        loop {
            match self.receiver.recv().await {
                Ok(entry) => return Ok(entry),
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        consumer = %self.consumer_name,
                        skipped = skipped,
                        "Log consumer lagged behind bus broadcast queue; skipped messages"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    return Err(broadcast::error::RecvError::Closed);
                }
            }
        }
    }
}

impl Drop for LogSubscription {
    fn drop(&mut self) {
        if let Some(ref handle) = self.shm {
            let remaining = handle.unregister_consumer();
            info!(
                consumer = %self.consumer_name,
                remaining_active = remaining,
                "Unregistered log consumer from shared memory bus"
            );
        }
    }
}

/// Zero-Disk Non-Blocking Log Bus using Linux Unix Domain Datagram Socket (`AF_UNIX`, `SOCK_DGRAM`).
pub struct LogBus {
    socket_path: PathBuf,
    sender: broadcast::Sender<Arc<GatewayLogEntry>>,
    shm: Option<Arc<LogShmHandle>>,
    cancel_token: CancellationToken,
}

impl LogBus {
    /// Bind a Unix Datagram socket and initialize the LogBus listener.
    pub fn bind(
        socket_path_override: Option<&Path>,
        shm: Option<Arc<LogShmHandle>>,
    ) -> Result<Self, String> {
        let path = if let Some(p) = socket_path_override {
            p.to_path_buf()
        } else {
            PathBuf::from(LOG_SOCK_DEFAULT_PATH)
        };

        // Remove stale socket if present
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }

        let socket = UnixDatagram::bind(&path).map_err(|e| {
            format!(
                "failed to bind Unix datagram socket at {}: {e}",
                path.display()
            )
        })?;

        // Grant 0o666 permissions so unprivileged NGINX workers can write datagrams
        if let Err(e) = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666)) {
            warn!(
                path = %path.display(),
                "Failed to set 0666 permissions on Unix datagram socket: {e}"
            );
        }

        // Configure SO_RCVBUF to 4MB to prevent drops under high burst loads
        let fd = socket.as_raw_fd();
        let res = unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_RCVBUF,
                &SOCKET_RCVBUF_BYTES as *const _ as *const libc::c_void,
                std::mem::size_of_val(&SOCKET_RCVBUF_BYTES) as libc::socklen_t,
            )
        };
        if res != 0 {
            warn!("Failed to set SO_RCVBUF on log datagram socket: errno {res}");
        }

        let (sender, _) = broadcast::channel::<Arc<GatewayLogEntry>>(DEFAULT_CHANNEL_CAPACITY);
        let cancel_token = CancellationToken::new();

        let worker_cancel = cancel_token.clone();
        let worker_sender = sender.clone();
        let socket_path_display = path.display().to_string();

        tokio::spawn(async move {
            info!(path = %socket_path_display, "Started Unix datagram log listener worker");
            let mut buf = vec![0u8; 65536];

            loop {
                tokio::select! {
                    _ = worker_cancel.cancelled() => {
                        debug!("Unix datagram log listener worker cancelled");
                        break;
                    }
                    res = socket.recv_from(&mut buf) => {
                        match res {
                            Ok((len, _addr)) => {
                                if len == 0 {
                                    continue;
                                }
                                let lossy;
                                let raw = match std::str::from_utf8(&buf[..len]) {
                                    Ok(s) => s.trim(),
                                    Err(_) => {
                                        lossy = String::from_utf8_lossy(&buf[..len]);
                                        lossy.trim()
                                    }
                                };
                                if raw.is_empty() {
                                    continue;
                                }

                                let entry = parse_log_payload(raw);
                                let _ = worker_sender.send(Arc::new(entry));
                            }
                            Err(e) => {
                                if worker_cancel.is_cancelled() {
                                    break;
                                }
                                error!("Error receiving from Unix datagram socket: {e}");
                                tokio::time::sleep(Duration::from_millis(10)).await;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            socket_path: path,
            sender,
            shm,
            cancel_token,
        })
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Subscribe to the log bus. Automatically registers this consumer on shared memory.
    pub fn subscribe(&self, consumer_name: &str) -> LogSubscription {
        LogSubscription::new(
            consumer_name.to_string(),
            self.sender.subscribe(),
            self.shm.clone(),
        )
    }

    /// Sender handle for testing or internal synthetic events.
    pub fn sender(&self) -> broadcast::Sender<Arc<GatewayLogEntry>> {
        self.sender.clone()
    }
}

impl Drop for LogBus {
    fn drop(&mut self) {
        self.cancel_token.cancel();
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Parse raw log payload, stripping any syslog prefix (RFC 3164/5424) to locate JSON body.
pub fn parse_log_payload(raw: &str) -> GatewayLogEntry {
    let json_candidate = if let Some(idx) = raw.find('{') {
        &raw[idx..]
    } else {
        raw
    };

    if let Ok(entry) = serde_json::from_str::<GatewayLogEntry>(json_candidate) {
        entry
    } else {
        GatewayLogEntry {
            message: Some(raw.to_string()),
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_log_payload_json() {
        let raw = r#"{"status": 200, "request_method": "GET", "request_uri": "/api/v1/test", "remote_addr": "1.2.3.4"}"#;
        let entry = parse_log_payload(raw);
        assert_eq!(entry.status, Some(200));
        assert_eq!(entry.method.as_deref(), Some("GET"));
        assert_eq!(entry.uri.as_deref(), Some("/api/v1/test"));
        assert_eq!(entry.client_ip.as_deref(), Some("1.2.3.4"));
    }

    #[test]
    fn test_parse_log_payload_syslog_header() {
        let raw = r#"<134>Sep 14 06:45:00 aurora nginx: {"status": 403, "request_method": "POST", "request_uri": "/login", "waf_action": "block"}"#;
        let entry = parse_log_payload(raw);
        assert_eq!(entry.status, Some(403));
        assert_eq!(entry.method.as_deref(), Some("POST"));
        assert_eq!(entry.uri.as_deref(), Some("/login"));
        assert_eq!(entry.waf_action.as_deref(), Some("block"));
    }

    #[test]
    fn test_parse_log_payload_plain_text() {
        let raw = "connection refused by upstream server";
        let entry = parse_log_payload(raw);
        assert_eq!(entry.status, None);
        assert_eq!(
            entry.message.as_deref(),
            Some("connection refused by upstream server")
        );
    }

    #[tokio::test]
    async fn test_log_bus_e2e_unix_datagram() {
        let test_sock = format!(
            "/tmp/test_aurora_sock_{}.sock",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let bus = LogBus::bind(Some(Path::new(&test_sock)), None).unwrap();
        let mut sub1 = bus.subscribe("test-consumer-1");
        let mut sub2 = bus.subscribe("test-consumer-2");

        // Send a datagram from an external Unix datagram client
        let client = std::os::unix::net::UnixDatagram::unbound().unwrap();
        let msg =
            r#"<190>nginx: {"status": 200, "request_method": "GET", "request_uri": "/health"}"#;
        client.send_to(msg.as_bytes(), &test_sock).unwrap();

        // Verify both subscribers receive the broadcast
        let rec1 = tokio::time::timeout(Duration::from_secs(2), sub1.recv())
            .await
            .expect("sub1 timeout")
            .unwrap();
        assert_eq!(rec1.status, Some(200));
        assert_eq!(rec1.method.as_deref(), Some("GET"));
        assert_eq!(rec1.uri.as_deref(), Some("/health"));

        let rec2 = tokio::time::timeout(Duration::from_secs(2), sub2.recv())
            .await
            .expect("sub2 timeout")
            .unwrap();
        assert_eq!(rec2.status, Some(200));
    }

    #[test]
    fn test_consumer_count_crash_recovery_reset() {
        let mut metrics = GatewaySharedMetrics::new();
        // Simulate stale consumer count left over from prior agent crash / SIGKILL
        metrics.register_log_consumer();
        metrics.register_log_consumer();
        assert_eq!(metrics.active_log_consumers_count(), 2);
        assert!(metrics.is_log_active());

        // Call reset_log_consumers as LogBus::open does on startup
        metrics.reset_log_consumers();
        assert_eq!(metrics.active_log_consumers_count(), 0);
        assert!(!metrics.is_log_active());

        // Subsequent subscriptions increment and decrement cleanly
        let bus_shm = LogShmHandle::from_ptr(&mut metrics as *mut _);
        assert_eq!(bus_shm.register_consumer(), 1);
        assert_eq!(metrics.active_log_consumers_count(), 1);
        assert!(metrics.is_log_active());

        assert_eq!(bus_shm.unregister_consumer(), 0);
        assert_eq!(metrics.active_log_consumers_count(), 0);
        assert!(!metrics.is_log_active());
    }
}
