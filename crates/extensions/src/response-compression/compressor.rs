//! Zero-copy SIMD and Multi-Algorithm Compression Routines
//!
//! Provides hardware-accelerated compression directly into caller-provided
//! destination memory buffers (e.g. NGINX request memory pool).

use std::io::{Cursor, Write};

/// Supported response compression algorithms.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CompressionAlgorithm {
    None = 0,
    Zstd = 1,
    Brotli = 2,
    Gzip = 3,
}

impl CompressionAlgorithm {
    /// Returns the HTTP `Content-Encoding` token string.
    #[inline(always)]
    pub const fn as_content_encoding(&self) -> &'static str {
        match self {
            Self::None => "",
            Self::Zstd => "zstd",
            Self::Brotli => "br",
            Self::Gzip => "gzip",
        }
    }

    /// Parses from string token.
    pub fn from_token(token: &str) -> Option<Self> {
        let t = token.trim();
        if t.eq_ignore_ascii_case("zstd") {
            Some(Self::Zstd)
        } else if t.eq_ignore_ascii_case("br") || t.eq_ignore_ascii_case("brotli") {
            Some(Self::Brotli)
        } else if t.eq_ignore_ascii_case("gzip") {
            Some(Self::Gzip)
        } else {
            None
        }
    }
}

/// Computes upper-bound memory size required to store compressed payload.
#[inline(always)]
pub fn max_compressed_len(algorithm: CompressionAlgorithm, in_len: usize) -> usize {
    match algorithm {
        CompressionAlgorithm::None => in_len,
        CompressionAlgorithm::Zstd => {
            // zstd safe bound: in_len + (in_len >> 8) + 64
            in_len + (in_len >> 8) + 128
        }
        CompressionAlgorithm::Brotli => {
            // brotli encoder max bound: in_len + (in_len >> 2) + 1024
            in_len + (in_len >> 2) + 1024
        }
        CompressionAlgorithm::Gzip => {
            // gzip RFC 1952 bound: 10 bytes header + 8 bytes trailer + max deflate overhead
            in_len + (in_len >> 3) + 64
        }
    }
}

/// Compresses `input` directly into `output` slice using caller-provided buffer.
///
/// Returns the actual compressed byte length written into `output`.
/// Zero heap allocations on the hot path.
pub fn compress_into(
    algorithm: CompressionAlgorithm,
    level: u32,
    input: &[u8],
    output: &mut [u8],
) -> Result<usize, String> {
    if input.is_empty() {
        return Ok(0);
    }

    match algorithm {
        CompressionAlgorithm::None => {
            if output.len() < input.len() {
                return Err("output buffer too small for passthrough".to_string());
            }
            output[..input.len()].copy_from_slice(input);
            Ok(input.len())
        }
        CompressionAlgorithm::Zstd => {
            let clamped_level = level.clamp(1, 19) as i32;
            zstd::bulk::compress_to_buffer(input, output, clamped_level)
                .map_err(|err| format!("zstd compression error: {err}"))
        }
        CompressionAlgorithm::Brotli => {
            let params = brotli::enc::BrotliEncoderParams {
                quality: level.clamp(1, 11) as i32,
                ..Default::default()
            };
            let mut writer = Cursor::new(output);
            brotli::BrotliCompress(&mut Cursor::new(input), &mut writer, &params)
                .map_err(|err| format!("brotli compression error: {err}"))?;
            Ok(writer.position() as usize)
        }
        CompressionAlgorithm::Gzip => {
            let clamped_level = level.clamp(1, 9);
            let mut encoder = flate2::write::GzEncoder::new(
                Cursor::new(output),
                flate2::Compression::new(clamped_level),
            );
            encoder
                .write_all(input)
                .map_err(|err| format!("gzip write error: {err}"))?;
            let cursor = encoder
                .finish()
                .map_err(|err| format!("gzip finish error: {err}"))?;
            Ok(cursor.position() as usize)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PAYLOAD: &[u8] = b"{\"status\":\"success\",\"data\":{\"users\":[{\"id\":1,\"name\":\"Alice\",\"roles\":[\"admin\",\"developer\"]},{\"id\":2,\"name\":\"Bob\",\"roles\":[\"viewer\"]}]}}";

    #[test]
    fn test_zstd_compress_into() {
        let max_len = max_compressed_len(CompressionAlgorithm::Zstd, SAMPLE_PAYLOAD.len());
        let mut buf = vec![0u8; max_len];
        let written = compress_into(CompressionAlgorithm::Zstd, 3, SAMPLE_PAYLOAD, &mut buf).unwrap();
        assert!(written > 0 && written < SAMPLE_PAYLOAD.len());

        // Decompress to verify integrity
        let decompressed = zstd::bulk::decompress(&buf[..written], SAMPLE_PAYLOAD.len()).unwrap();
        assert_eq!(decompressed, SAMPLE_PAYLOAD);
    }

    #[test]
    fn test_brotli_compress_into() {
        let max_len = max_compressed_len(CompressionAlgorithm::Brotli, SAMPLE_PAYLOAD.len());
        let mut buf = vec![0u8; max_len];
        let written = compress_into(CompressionAlgorithm::Brotli, 4, SAMPLE_PAYLOAD, &mut buf).unwrap();
        assert!(written > 0 && written < SAMPLE_PAYLOAD.len());

        // Decompress using brotli-decompressor
        let mut decompressed = Vec::new();
        brotli::BrotliDecompress(&mut Cursor::new(&buf[..written]), &mut decompressed).unwrap();
        assert_eq!(decompressed, SAMPLE_PAYLOAD);
    }

    #[test]
    fn test_gzip_compress_into() {
        let max_len = max_compressed_len(CompressionAlgorithm::Gzip, SAMPLE_PAYLOAD.len());
        let mut buf = vec![0u8; max_len];
        let written = compress_into(CompressionAlgorithm::Gzip, 4, SAMPLE_PAYLOAD, &mut buf).unwrap();
        assert!(written > 0 && written < SAMPLE_PAYLOAD.len());

        // Decompress using flate2
        use std::io::Read;
        let mut decoder = flate2::read::GzDecoder::new(&buf[..written]);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed).unwrap();
        assert_eq!(decompressed, SAMPLE_PAYLOAD);
    }
}
