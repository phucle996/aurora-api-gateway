//! Aurora Gateway - 5-Phase HTTP Execution C-ABI Surface.
//!
//! Exclusively reflects the 5 core HTTP phases of the Gateway lifecycle:
//! - Phase 1: HTTP Access Phase (`access`)
//! - Phase 2: HTTP Content Phase (`content`)
//! - Phase 3: HTTP Header Filter Phase (`header_filter`)
//! - Phase 4: HTTP Body Filter Phase (`body_filter`)
//! - Phase 5: HTTP Log Phase (`log`)

pub mod access;
pub mod body_filter;
pub mod content;
pub mod header_filter;
pub mod log;

pub use access::*;
pub use body_filter::*;
pub use content::*;
pub use header_filter::*;
pub use log::*;
