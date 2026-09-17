mod engine;
pub mod trie;
pub mod types;

#[cfg(test)]
mod tests;

pub use engine::IpRestrictionEngine;
pub use trie::IpRadixTree;
pub use types::{IpRestrictionRequest, IpRestrictionRule, IpRestrictionSnapshot};

// Aliases for internal compatibility across crates
pub use engine::IpRestrictionEngine as AccessEngine;
pub use types::IpRestrictionRequest as AccessRequest;
