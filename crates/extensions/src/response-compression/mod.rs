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

pub use compressor::{compress_into, max_compressed_len, CompressionAlgorithm};
pub use evaluator::{
    CLIENT_ENCODING_BR, CLIENT_ENCODING_GZIP, CLIENT_ENCODING_ZSTD,
    parse_accept_encoding_mask, HeaderDecision, HeaderDecisionAction, ResponseCompressionEngine,
};
pub use materialize::materialize;
pub use policy::{ResponseCompressionConfig, RouteCompressionOverride};
