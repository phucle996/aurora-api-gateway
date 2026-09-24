pub mod materialize;
pub mod schema;

// Re-exports for clean, top-level API
pub use materialize::extensions::ExtensionInstanceSpec;
pub use materialize::l4::{L4AclRuleSpec, L4ServerSpec, L4ServiceSpec, L4Spec, L4UpstreamSpec};
pub use materialize::route::{DomainRoutingSpec, LocationRoutingSpec, OriginTLSSpec, RoutingSpec};
pub use materialize::tls::CertificateSpec;
pub use materialize::upstream::{UpstreamServerSpec, UpstreamSpec};
pub use schema::{Spec, compute_sha256};

// Module namespaces pointing directly to their materialize owner
pub mod certificate {
    pub use super::materialize::tls::*;
}
pub mod extensions {
    pub use super::materialize::extensions::*;
}
pub mod l4 {
    pub use super::materialize::l4::*;
}
pub mod routing {
    pub use super::materialize::route::*;
}
pub mod upstream {
    pub use super::materialize::upstream::*;
}
