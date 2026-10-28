use aurora_engine::MAX_POLICY_BYTES;
use std::io::{self, Read, Write};

/// aurora-compile là công cụ dòng lệnh (CLI tool) độc lập dùng để thẩm định chính sách hoặc snapshot.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();

    io::stdin()
        .take(MAX_POLICY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;

    if !bytes.is_empty() {
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|_| "invalid JSON")?;
    }

    io::stdout().write_all(&bytes)?;

    Ok(())
}
