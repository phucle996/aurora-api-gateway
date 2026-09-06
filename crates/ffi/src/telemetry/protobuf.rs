/// Cấu trúc dữ liệu nhị phân Heartbeat tương thích 100% với Go Protocol Buffers wire format.
#[derive(Debug, Clone, Default)]
pub struct HeartbeatPayload {
    pub node_id: String,
    pub timestamp: i64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub active_connections: i64,
    pub requests_per_second: f64,
    pub active_release_id: i64,
    pub version: String,
    pub role: String,
    pub metrics_scope: String,
    pub hostname: String,
    pub runtime_started_at: i64,
    pub worker_identity: String,
    pub metrics_available: bool,
}

impl HeartbeatPayload {
    /// Tuần tự hóa HeartbeatPayload sang Protocol Buffers wire format thô không cần thư viện bên thứ 3.
    pub fn to_protobuf_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(96);

        // Tag 1: node_id (string, wire type 2)
        if !self.node_id.is_empty() {
            encode_tag(&mut buf, 1, 2);
            encode_varint(&mut buf, self.node_id.len() as u64);
            buf.extend_from_slice(self.node_id.as_bytes());
        }

        // Tag 2: timestamp (int64, wire type 0)
        if self.timestamp != 0 {
            encode_tag(&mut buf, 2, 0);
            encode_varint(&mut buf, self.timestamp as u64);
        }

        // Tag 3: cpu_usage (double / fixed64, wire type 1)
        if self.cpu_usage != 0.0 {
            encode_tag(&mut buf, 3, 1);
            buf.extend_from_slice(&self.cpu_usage.to_bits().to_le_bytes());
        }

        // Tag 4: memory_usage (double / fixed64, wire type 1)
        if self.memory_usage != 0.0 {
            encode_tag(&mut buf, 4, 1);
            buf.extend_from_slice(&self.memory_usage.to_bits().to_le_bytes());
        }

        // Tag 5: active_connections (int64, wire type 0)
        if self.active_connections != 0 {
            encode_tag(&mut buf, 5, 0);
            encode_varint(&mut buf, self.active_connections as u64);
        }

        // Tag 6: requests_per_second (double / fixed64, wire type 1)
        if self.requests_per_second != 0.0 {
            encode_tag(&mut buf, 6, 1);
            buf.extend_from_slice(&self.requests_per_second.to_bits().to_le_bytes());
        }

        // Tag 7: active_release_id (int64, wire type 0)
        if self.active_release_id != 0 {
            encode_tag(&mut buf, 7, 0);
            encode_varint(&mut buf, self.active_release_id as u64);
        }

        // Tag 8: version (string, wire type 2)
        if !self.version.is_empty() {
            encode_tag(&mut buf, 8, 2);
            encode_varint(&mut buf, self.version.len() as u64);
            buf.extend_from_slice(self.version.as_bytes());
        }

        // Tag 9: role (string, wire type 2)
        if !self.role.is_empty() {
            encode_tag(&mut buf, 9, 2);
            encode_varint(&mut buf, self.role.len() as u64);
            buf.extend_from_slice(self.role.as_bytes());
        }

        for (tag, value) in [
            (10, &self.metrics_scope),
            (11, &self.hostname),
            (13, &self.worker_identity),
        ] {
            if !value.is_empty() {
                encode_tag(&mut buf, tag, 2);
                encode_varint(&mut buf, value.len() as u64);
                buf.extend_from_slice(value.as_bytes());
            }
        }
        encode_tag(&mut buf, 12, 0);
        encode_varint(&mut buf, self.runtime_started_at as u64);
        encode_tag(&mut buf, 14, 0);
        encode_varint(&mut buf, u64::from(self.metrics_available));
        buf
    }
}

fn encode_tag(buf: &mut Vec<u8>, field_number: u32, wire_type: u8) {
    encode_varint(buf, ((field_number as u64) << 3) | (wire_type as u64));
}

fn encode_varint(buf: &mut Vec<u8>, mut val: u64) {
    while val >= 0x80 {
        buf.push(((val & 0x7f) as u8) | 0x80);
        val >>= 7;
    }
    buf.push(val as u8);
}
