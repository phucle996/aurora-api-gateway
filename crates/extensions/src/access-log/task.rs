//! Dedicated Access Log Task & Buffer Definition.
//!
//! Encapsulates zero-allocation string storage and metadata strictly needed
//! for high-throughput JSON access logging.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InlineStrBuffer {
    inline: [u8; 384],
    spilled: Vec<u8>,
    len: u16,
}

impl InlineStrBuffer {
    #[inline(always)]
    pub fn as_bytes(&self) -> &[u8] {
        if self.len as usize <= 384 {
            &self.inline[..self.len as usize]
        } else {
            self.spilled.as_slice()
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AccessLogSlices<'a> {
    pub client_ip: &'a [u8],
    pub method: &'a [u8],
    pub uri: &'a [u8],
    pub host: &'a [u8],
    pub user_agent: &'a [u8],
    pub request_id: &'a [u8],
    pub trace_id: &'a [u8],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AccessLogMetadata {
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u16,
    pub upstream_response_ms: u32,
    pub upstream_connect_ms: u32,
    pub is_ssl: bool,
    pub ssl_reused: bool,
    pub is_matched: bool,
    pub timestamp_unix_nano: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccessLogTask {
    pub buffer: InlineStrBuffer,
    pub client_ip_range: (u16, u16),
    pub method_range: (u16, u16),
    pub uri_range: (u16, u16),
    pub host_range: (u16, u16),
    pub user_agent_range: (u16, u16),
    pub request_id_range: (u16, u16),
    pub trace_id_range: (u16, u16),
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u16,
    pub upstream_response_ms: u32,
    pub upstream_connect_ms: u32,
    pub is_ssl: bool,
    pub ssl_reused: bool,
    pub is_matched: bool,
    pub timestamp_unix_nano: u64,
}

impl AccessLogTask {
    pub fn from_slices(slices: AccessLogSlices<'_>, meta: AccessLogMetadata) -> Self {
        let total_len = slices.client_ip.len()
            + slices.method.len()
            + slices.uri.len()
            + slices.host.len()
            + slices.user_agent.len()
            + slices.request_id.len()
            + slices.trace_id.len();

        let (buffer, ip_r, meth_r, uri_r, host_r, ua_r, req_r, trace_r) = if total_len <= 384 {
            let mut data = [0u8; 384];
            let mut cursor = 0;

            let ip_s = cursor as u16;
            data[cursor..cursor + slices.client_ip.len()].copy_from_slice(slices.client_ip);
            cursor += slices.client_ip.len();
            let ip_r = (ip_s, cursor as u16);

            let meth_s = cursor as u16;
            data[cursor..cursor + slices.method.len()].copy_from_slice(slices.method);
            cursor += slices.method.len();
            let meth_r = (meth_s, cursor as u16);

            let uri_s = cursor as u16;
            data[cursor..cursor + slices.uri.len()].copy_from_slice(slices.uri);
            cursor += slices.uri.len();
            let uri_r = (uri_s, cursor as u16);

            let host_s = cursor as u16;
            data[cursor..cursor + slices.host.len()].copy_from_slice(slices.host);
            cursor += slices.host.len();
            let host_r = (host_s, cursor as u16);

            let ua_s = cursor as u16;
            data[cursor..cursor + slices.user_agent.len()].copy_from_slice(slices.user_agent);
            cursor += slices.user_agent.len();
            let ua_r = (ua_s, cursor as u16);

            let req_s = cursor as u16;
            data[cursor..cursor + slices.request_id.len()].copy_from_slice(slices.request_id);
            cursor += slices.request_id.len();
            let req_r = (req_s, cursor as u16);

            let trace_s = cursor as u16;
            data[cursor..cursor + slices.trace_id.len()].copy_from_slice(slices.trace_id);
            cursor += slices.trace_id.len();
            let trace_r = (trace_s, cursor as u16);

            (
                InlineStrBuffer {
                    inline: data,
                    spilled: Vec::new(),
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
            let mut cursor = 0;

            let ip_s = cursor as u16;
            v.extend_from_slice(slices.client_ip);
            cursor += slices.client_ip.len();
            let ip_r = (ip_s, cursor as u16);

            let meth_s = cursor as u16;
            v.extend_from_slice(slices.method);
            cursor += slices.method.len();
            let meth_r = (meth_s, cursor as u16);

            let uri_s = cursor as u16;
            v.extend_from_slice(slices.uri);
            cursor += slices.uri.len();
            let uri_r = (uri_s, cursor as u16);

            let host_s = cursor as u16;
            v.extend_from_slice(slices.host);
            cursor += slices.host.len();
            let host_r = (host_s, cursor as u16);

            let ua_s = cursor as u16;
            v.extend_from_slice(slices.user_agent);
            cursor += slices.user_agent.len();
            let ua_r = (ua_s, cursor as u16);

            let req_s = cursor as u16;
            v.extend_from_slice(slices.request_id);
            cursor += slices.request_id.len();
            let req_r = (req_s, cursor as u16);

            let trace_s = cursor as u16;
            v.extend_from_slice(slices.trace_id);
            cursor += slices.trace_id.len();
            let trace_r = (trace_s, cursor as u16);

            (
                InlineStrBuffer {
                    inline: [0u8; 384],
                    spilled: v,
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
            upstream_connect_ms: meta.upstream_connect_ms,
            is_ssl: meta.is_ssl,
            ssl_reused: meta.ssl_reused,
            is_matched: meta.is_matched,
            timestamp_unix_nano: meta.timestamp_unix_nano,
        }
    }

    #[inline(always)]
    fn get_str(&self, range: (u16, u16)) -> &str {
        let (s, e) = (range.0 as usize, range.1 as usize);
        let bytes = self.buffer.as_bytes();
        if s <= e && e <= bytes.len() {
            std::str::from_utf8(&bytes[s..e]).unwrap_or("")
        } else {
            ""
        }
    }

    #[inline(always)]
    pub fn client_ip(&self) -> &str {
        self.get_str(self.client_ip_range)
    }

    #[inline(always)]
    pub fn method(&self) -> &str {
        self.get_str(self.method_range)
    }

    #[inline(always)]
    pub fn uri(&self) -> &str {
        self.get_str(self.uri_range)
    }

    #[inline(always)]
    pub fn host(&self) -> &str {
        self.get_str(self.host_range)
    }

    #[inline(always)]
    pub fn user_agent(&self) -> &str {
        self.get_str(self.user_agent_range)
    }

    #[inline(always)]
    pub fn request_id(&self) -> &str {
        self.get_str(self.request_id_range)
    }

    #[inline(always)]
    pub fn trace_id(&self) -> &str {
        self.get_str(self.trace_id_range)
    }
}
