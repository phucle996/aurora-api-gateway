//! Dedicated Standard Stream / Access Log Background Plugin.

use super::task::StdLogTask;
use super::template::FastJsonLogTemplate;
use std::io::Write;

/// Dedicated Standard Stream / Access Log Plugin.
/// Batches rendered JSON log lines and flushes to the underlying `writer`.
pub struct StdLogPlugin<W: Write + Send + 'static> {
    writer: W,
    batch_size: usize,
    count: usize,
    buf: Vec<u8>,
}

impl<W: Write + Send + 'static> StdLogPlugin<W> {
    pub fn new(writer: W, batch_size: usize) -> Self {
        Self {
            writer,
            batch_size: batch_size.max(1),
            count: 0,
            buf: Vec::with_capacity(batch_size.max(1) * 256),
        }
    }

    pub fn handle_task(&mut self, task: &StdLogTask) {
        FastJsonLogTemplate::render_to_buf(task, &mut self.buf);
        self.count += 1;
        if self.count >= self.batch_size {
            self.flush_internal();
        }
    }

    pub fn tick(&mut self) {
        self.flush_internal();
    }

    pub fn flush(&mut self) {
        self.flush_internal();
    }

    fn flush_internal(&mut self) {
        if !self.buf.is_empty() {
            let _ = self.writer.write_all(&self.buf);
            let _ = self.writer.flush();
            self.buf.clear();
            self.count = 0;
        }
    }
}
