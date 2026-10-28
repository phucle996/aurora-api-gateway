//! In-memory raw metrics values & accumulator primitives.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RawHttpMetrics {
    pub requests_2xx: u64,
    pub requests_3xx: u64,
    pub requests_4xx: u64,
    pub requests_5xx: u64,
    pub requests_other: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub duration_sum_ms: u64,
    pub duration_buckets: [u64; 7],
    pub active_conns: u64,
    pub reading_conns: u64,
    pub writing_conns: u64,
    pub waiting_conns: u64,
}

impl RawHttpMetrics {
    #[inline]
    pub fn total_requests(&self) -> u64 {
        self.requests_2xx
            + self.requests_3xx
            + self.requests_4xx
            + self.requests_5xx
            + self.requests_other
    }
}
