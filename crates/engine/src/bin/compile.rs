use aurora_engine::{Engine, MAX_POLICY_BYTES};
use std::io::{self, Read, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_POLICY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    // Portable JSON IR, not serialized Rust memory; same validator as NGINX load.
    Engine::from_policy(&bytes).map_err(|_| "invalid or unsupported policy")?;
    io::stdout().write_all(&bytes)?;
    Ok(())
}
