//! Response Compression Extension
//!
//! Multi-algorithm SIMD compression (Zstd, Brotli, Gzip-SIMD) with zero-copy
//! pointer handover into host memory pools.

pub mod compressor;
pub mod evaluator;
pub mod materialize;
pub mod policy;

#[cfg(test)]
mod tests;

pub use compressor::{CompressionAlgorithm, compress_into, max_compressed_len};
pub use evaluator::{
    CLIENT_ENCODING_BR, CLIENT_ENCODING_GZIP, CLIENT_ENCODING_ZSTD, HeaderDecision,
    HeaderDecisionAction, ResponseCompressionEngine, parse_accept_encoding_mask,
    scan_accept_encoding_swar,
};
pub use materialize::materialize;
pub use policy::{ResponseCompressionConfig, RouteCompressionOverride};
