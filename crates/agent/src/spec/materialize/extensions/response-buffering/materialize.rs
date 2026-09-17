//! Response Buffering extension materializer.
//!
//! Controls upstream response buffering via `proxy_buffering off`.
//! Crucial for real-time applications including Server-Sent Events (SSE), HTTP chunked streaming,
//! LLM token streaming, and WebSocket tunnels. Emits chunks directly to the downstream client as
//! they arrive from backend services without intermediate proxy buffer pauses.
//!
//! Generated directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, taking effect with zero downtime via `aurora-gateway -s reload`.

pub fn materialize(server: &mut String, has_server: &mut bool) -> Result<(), String> {
    server.push_str("proxy_buffering off;\n");
    *has_server = true;
    Ok(())
}
