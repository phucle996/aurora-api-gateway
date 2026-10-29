//! Dedicated Access Log Task & Buffer Definition.
//!
//! Encapsulates zero-allocation string storage and metadata strictly needed
//! for high-throughput JSON access logging.

pub const INLINE_CAPACITY: usize = 256;

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InlineStrBuffer {
    Inline {
        data: [u8; INLINE_CAPACITY],
        len: u16,
    },
    Spilled(Vec<u8>),
}

impl InlineStrBuffer {
    #[inline(always)]
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            InlineStrBuffer::Inline { data, len } => &data[..*len as usize],
            InlineStrBuffer::Spilled(v) => v.as_slice(),
        }
    }

    #[inline(always)]
    pub fn len(&self) -> usize {
        match self {
            InlineStrBuffer::Inline { len, .. } => *len as usize,
            InlineStrBuffer::Spilled(v) => v.len(),
        }
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Completed request snapshot passed directly from C NGINX adapter at `NGX_HTTP_LOG_PHASE`.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AuroraLogInput {
    pub client_ip: *const u8,
    pub client_ip_len: usize,
    pub method: *const u8,
    pub method_len: usize,
    pub uri: *const u8,
    pub uri_len: usize,
    pub host: *const u8,
    pub host_len: usize,
    pub user_agent: *const u8,
    pub user_agent_len: usize,
    pub request_id: *const u8,
    pub request_id_len: usize,
    pub trace_id: *const u8,
    pub trace_id_len: usize,
    pub status: u32,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u32,
    pub upstream_response_ms: u32,
    pub upstream_connect_ms: u32,
    pub is_ssl: u32,
    pub ssl_reused: u32,
    pub is_matched: u32,
    pub active_conns: u64,
    pub reading_conns: u64,
    pub writing_conns: u64,
    pub waiting_conns: u64,
    pub timestamp_unix_nano: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct StdLogSlices<'a> {
    pub client_ip: &'a [u8],
    pub method: &'a [u8],
    pub uri: &'a [u8],
    pub host: &'a [u8],
    pub user_agent: &'a [u8],
    pub request_id: &'a [u8],
    pub trace_id: &'a [u8],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StdLogMetadata {
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u16,
    pub upstream_response_ms: u32,
    pub timestamp_unix_nano: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StdLogTask {
    pub buffer: InlineStrBuffer,
    pub client_ip_range: (u32, u32),
    pub method_range: (u32, u32),
    pub uri_range: (u32, u32),
    pub host_range: (u32, u32),
    pub user_agent_range: (u32, u32),
    pub request_id_range: (u32, u32),
    pub trace_id_range: (u32, u32),
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u16,
    pub upstream_response_ms: u32,
    pub timestamp_unix_nano: u64,
}

impl StdLogTask {
    /// Zero-copy, branchless extraction directly from C NGINX `AuroraLogInput`.
    ///
    /// Triệt tiêu hoàn toàn trung gian `StdLogSlices` trên stack, triệt tiêu bounds-check của Rust
    /// bằng raw memory copy có kiểm soát, đạt mức tiêu thụ CPU tối thiểu tuyệt đối.
    #[inline]
    pub fn from_raw(raw: &AuroraLogInput) -> Self {
        let total_len = raw.client_ip_len
            + raw.method_len
            + raw.uri_len
            + raw.host_len
            + raw.user_agent_len
            + raw.request_id_len
            + raw.trace_id_len;

        let (buffer, ip_r, meth_r, uri_r, host_r, ua_r, req_r, trace_r) = if total_len <= INLINE_CAPACITY {
            let mut data = [0u8; INLINE_CAPACITY];
            let mut cursor = 0;

            macro_rules! append_raw {
                ($ptr:expr, $len:expr) => {{
                    let s = cursor as u32;
                    let l = $len;
                    let p = $ptr;
                    if l > 0 && !p.is_null() {
                        unsafe {
                            std::ptr::copy_nonoverlapping(p, data.as_mut_ptr().add(cursor), l);
                        }
                        cursor += l;
                    }
                    (s, cursor as u32)
                }};
            }

            let ip_r = append_raw!(raw.client_ip, raw.client_ip_len);
            let meth_r = append_raw!(raw.method, raw.method_len);
            let uri_r = append_raw!(raw.uri, raw.uri_len);
            let host_r = append_raw!(raw.host, raw.host_len);
            let ua_r = append_raw!(raw.user_agent, raw.user_agent_len);
            let req_r = append_raw!(raw.request_id, raw.request_id_len);
            let trace_r = append_raw!(raw.trace_id, raw.trace_id_len);

            (
                InlineStrBuffer::Inline {
                    data,
                    len: cursor as u16,
                },
                ip_r,
                meth_r,
                uri_r,
                host_r,
                ua_r,
                req_r,
                trace_r,
            )
        } else {
            let mut v = Vec::with_capacity(total_len);
            let mut cursor: usize = 0;

            macro_rules! append_vec_raw {
                ($ptr:expr, $len:expr) => {{
                    let s = cursor as u32;
                    let l = $len;
                    let p = $ptr;
                    if l > 0 && !p.is_null() {
                        unsafe {
                            let sl = std::slice::from_raw_parts(p, l);
                            v.extend_from_slice(sl);
                        }
                        cursor += l;
                    }
                    (s, cursor as u32)
                }};
            }

            let ip_r = append_vec_raw!(raw.client_ip, raw.client_ip_len);
            let meth_r = append_vec_raw!(raw.method, raw.method_len);
            let uri_r = append_vec_raw!(raw.uri, raw.uri_len);
            let host_r = append_vec_raw!(raw.host, raw.host_len);
            let ua_r = append_vec_raw!(raw.user_agent, raw.user_agent_len);
            let req_r = append_vec_raw!(raw.request_id, raw.request_id_len);
            let trace_r = append_vec_raw!(raw.trace_id, raw.trace_id_len);

            (
                InlineStrBuffer::Spilled(v),
                ip_r,
                meth_r,
                uri_r,
                host_r,
                ua_r,
                req_r,
                trace_r,
            )
        };

        Self {
            buffer,
            client_ip_range: ip_r,
            method_range: meth_r,
            uri_range: uri_r,
            host_range: host_r,
            user_agent_range: ua_r,
            request_id_range: req_r,
            trace_id_range: trace_r,
            status: raw.status as u16,
            duration_ms: raw.duration_ms,
            bytes_sent: raw.bytes_sent,
            bytes_recv: raw.bytes_recv,
            upstream_status: raw.upstream_status as u16,
            upstream_response_ms: raw.upstream_response_ms,
            timestamp_unix_nano: raw.timestamp_unix_nano,
        }
    }

    pub fn from_slices(slices: StdLogSlices<'_>, meta: StdLogMetadata) -> Self {
        let total_len = slices.client_ip.len()
            + slices.method.len()
            + slices.uri.len()
            + slices.host.len()
            + slices.user_agent.len()
            + slices.request_id.len()
            + slices.trace_id.len();

        let (buffer, ip_r, meth_r, uri_r, host_r, ua_r, req_r, trace_r) = if total_len <= INLINE_CAPACITY {
            let mut data = [0u8; INLINE_CAPACITY];
            let mut cursor = 0;

            macro_rules! append_slice {
                ($slice:expr) => {{
                    let s = cursor as u32;
                    let sl = $slice;
                    let len = sl.len();
                    if len > 0 {
                        unsafe {
                            std::ptr::copy_nonoverlapping(sl.as_ptr(), data.as_mut_ptr().add(cursor), len);
                        }
                        cursor += len;
                    }
                    (s, cursor as u32)
                }};
            }

            let ip_r = append_slice!(slices.client_ip);
            let meth_r = append_slice!(slices.method);
            let uri_r = append_slice!(slices.uri);
            let host_r = append_slice!(slices.host);
            let ua_r = append_slice!(slices.user_agent);
            let req_r = append_slice!(slices.request_id);
            let trace_r = append_slice!(slices.trace_id);

            (
                InlineStrBuffer::Inline {
                    data,
                    len: cursor as u16,
                },
                ip_r,
                meth_r,
                uri_r,
                host_r,
                ua_r,
                req_r,
                trace_r,
            )
        } else {
            let mut v = Vec::with_capacity(total_len);
            let mut cursor: usize = 0;

            macro_rules! append_vec {
                ($slice:expr) => {{
                    let s = cursor as u32;
                    let sl = $slice;
                    if !sl.is_empty() {
                        v.extend_from_slice(sl);
                        cursor += sl.len();
                    }
                    (s, cursor as u32)
                }};
            }

            let ip_r = append_vec!(slices.client_ip);
            let meth_r = append_vec!(slices.method);
            let uri_r = append_vec!(slices.uri);
            let host_r = append_vec!(slices.host);
            let ua_r = append_vec!(slices.user_agent);
            let req_r = append_vec!(slices.request_id);
            let trace_r = append_vec!(slices.trace_id);

            (
                InlineStrBuffer::Spilled(v),
                ip_r,
                meth_r,
                uri_r,
                host_r,
                ua_r,
                req_r,
                trace_r,
            )
        };

        Self {
            buffer,
            client_ip_range: ip_r,
            method_range: meth_r,
            uri_range: uri_r,
            host_range: host_r,
            user_agent_range: ua_r,
            request_id_range: req_r,
            trace_id_range: trace_r,
            status: meta.status,
            duration_ms: meta.duration_ms,
            bytes_sent: meta.bytes_sent,
            bytes_recv: meta.bytes_recv,
            upstream_status: meta.upstream_status,
            upstream_response_ms: meta.upstream_response_ms,
            timestamp_unix_nano: meta.timestamp_unix_nano,
        }
    }

    #[inline(always)]
    pub fn get_bytes(&self, range: (u32, u32)) -> &[u8] {
        let (s, e) = (range.0 as usize, range.1 as usize);
        let bytes = self.buffer.as_bytes();
        if s <= e && e <= bytes.len() {
            &bytes[s..e]
        } else {
            &[]
        }
    }

    #[inline(always)]
    fn get_str(&self, range: (u32, u32)) -> &str {
        std::str::from_utf8(self.get_bytes(range)).unwrap_or("")
    }

    #[inline(always)]
    pub fn client_ip(&self) -> &str {
        self.get_str(self.client_ip_range)
    }

    #[inline(always)]
    pub fn client_ip_bytes(&self) -> &[u8] {
        self.get_bytes(self.client_ip_range)
    }

    #[inline(always)]
    pub fn method(&self) -> &str {
        self.get_str(self.method_range)
    }

    #[inline(always)]
    pub fn method_bytes(&self) -> &[u8] {
        self.get_bytes(self.method_range)
    }

    #[inline(always)]
    pub fn uri(&self) -> &str {
        self.get_str(self.uri_range)
    }

    #[inline(always)]
    pub fn uri_bytes(&self) -> &[u8] {
        self.get_bytes(self.uri_range)
    }

    #[inline(always)]
    pub fn host(&self) -> &str {
        self.get_str(self.host_range)
    }

    #[inline(always)]
    pub fn host_bytes(&self) -> &[u8] {
        self.get_bytes(self.host_range)
    }

    #[inline(always)]
    pub fn user_agent(&self) -> &str {
        self.get_str(self.user_agent_range)
    }

    #[inline(always)]
    pub fn user_agent_bytes(&self) -> &[u8] {
        self.get_bytes(self.user_agent_range)
    }

    #[inline(always)]
    pub fn request_id(&self) -> &str {
        self.get_str(self.request_id_range)
    }

    #[inline(always)]
    pub fn request_id_bytes(&self) -> &[u8] {
        self.get_bytes(self.request_id_range)
    }

    #[inline(always)]
    pub fn trace_id(&self) -> &str {
        self.get_str(self.trace_id_range)
    }

    #[inline(always)]
    pub fn trace_id_bytes(&self) -> &[u8] {
        self.get_bytes(self.trace_id_range)
    }
}
