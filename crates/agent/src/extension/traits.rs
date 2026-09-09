/// Base contract for all Aurora Agent extensions.
#[allow(dead_code)]
pub trait Extension: Send + Sync + 'static {
    /// Unique identifier for the extension (e.g. "metrics", "access_log").
    fn name(&self) -> &'static str;
}
