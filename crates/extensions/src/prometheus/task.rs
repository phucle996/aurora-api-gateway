//! Dedicated Prometheus Metric Task Definition.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct HttpMetricTask {
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub active_conns: u64,
    pub reading_conns: u64,
    pub writing_conns: u64,
    pub waiting_conns: u64,
}
