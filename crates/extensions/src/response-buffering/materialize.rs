//! Response Buffering extension materializer.
//!
//! Controls NGINX `proxy_buffering` directive for streaming APIs (SSE, gRPC-web, chunks).

pub fn materialize(server: &mut String, has_server: &mut bool) -> Result<(), String> {
    server.push_str("proxy_buffering off;\n");
    *has_server = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_response_buffering() {
        let mut server = String::new();
        let mut has_server = false;
        materialize(&mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("proxy_buffering off;"));
    }
}
