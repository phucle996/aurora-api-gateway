//! Response Buffering extension materializer.

pub fn materialize(server: &mut String, has_server: &mut bool) -> Result<(), String> {
    server.push_str("proxy_buffering off;\n");
    *has_server = true;
    Ok(())
}
