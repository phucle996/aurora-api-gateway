use super::atomic_write_if_changed;
use super::route::RoutingSpec;
use crate::spec::schema::Spec;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CertificateSpec {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub snis: Vec<String>,
    #[serde(default)]
    pub cert_pem: String,
    #[serde(default)]
    pub key_pem: String,
    #[serde(default)]
    pub mtls_enabled: bool,
    #[serde(default)]
    pub client_ca_pem: String,
    #[serde(default = "default_verify_depth")]
    pub verify_depth: u32,
}

impl CertificateSpec {
    /// Returns the active Subject Alternative Name (SAN) domain list for this certificate.
    /// Extracts directly from `cert_pem`. If `cert_pem` is dummy test data or has no SANs,
    /// falls back to `snis` for backwards compatibility.
    pub fn sans(&self) -> Vec<String> {
        let extracted = extract_sans_from_pem(&self.cert_pem);
        if !extracted.is_empty() {
            extracted
        } else {
            self.snis.clone()
        }
    }
}

fn default_verify_depth() -> u32 {
    1
}

use x509_parser::pem::Pem;
use x509_parser::prelude::*;

/// Extracts Subject Alternative Name (SAN) DNS names directly from PEM certificate bytes.
pub fn extract_sans_from_pem(cert_pem: &str) -> Vec<String> {
    if cert_pem.trim().is_empty() {
        return Vec::new();
    }
    let mut sans = Vec::new();
    for pem in Pem::iter_from_buffer(cert_pem.as_bytes()) {
        if let Ok(pem) = pem {
            if let Ok(cert) = pem.parse_x509() {
                for ext in cert.extensions() {
                    if let ParsedExtension::SubjectAlternativeName(san) = ext.parsed_extension() {
                        for name in &san.general_names {
                            if let GeneralName::DNSName(dns) = name {
                                sans.push(dns.to_ascii_lowercase());
                            }
                        }
                    }
                }
                break; // Only the leaf certificate contains the domain SANs
            }
        }
    }
    sans.sort();
    sans.dedup();
    sans
}

/// Materialize Server SSL certificates and client CA certificates into `certs_dir`.
/// Also cleans up stale certificate and key files that are no longer referenced in `certs`.
pub async fn materialize_server_certificates(
    certs: &[CertificateSpec],
    certs_dir: &Path,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let mut changed = false;
    let mut expected_files: HashSet<String> = HashSet::new();

    if !certs.is_empty() && !certs_dir.exists() {
        tokio::fs::create_dir_all(certs_dir).await?;
    }

    for cert in certs {
        if !cert.cert_pem.trim().is_empty() {
            let filename = format!("{}.crt", cert.id);
            expected_files.insert(filename.clone());
            let cert_file = certs_dir.join(&filename);
            if atomic_write_if_changed(&cert_file, cert.cert_pem.as_bytes()).await? {
                info!("Updated SSL certificate file {}", cert_file.display());
                changed = true;
            }
        }
        if !cert.key_pem.trim().is_empty() {
            let filename = format!("{}.key", cert.id);
            expected_files.insert(filename.clone());
            let key_file = certs_dir.join(&filename);
            if atomic_write_if_changed(&key_file, cert.key_pem.as_bytes()).await? {
                info!("Updated SSL private key file {}", key_file.display());
                changed = true;
            }
            tokio::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600)).await?;
        }
        if cert.mtls_enabled && !cert.client_ca_pem.trim().is_empty() {
            let filename = format!("{}_ca.crt", cert.id);
            expected_files.insert(filename.clone());
            let ca_file = certs_dir.join(&filename);
            if atomic_write_if_changed(&ca_file, cert.client_ca_pem.as_bytes()).await? {
                info!("Updated SSL client CA file {}", ca_file.display());
                changed = true;
            }
        }
    }

    // Garbage Collection: remove stale certificate files in certs_dir
    if certs_dir.exists() {
        let mut entries = tokio::fs::read_dir(certs_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            if !file_type.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if (file_name.ends_with(".crt") || file_name.ends_with(".key"))
                && !expected_files.contains(&file_name)
            {
                info!(
                    "Removing stale SSL certificate file: {}",
                    entry.path().display()
                );
                tokio::fs::remove_file(entry.path()).await?;
                changed = true;
            }
        }
    }

    Ok(changed)
}

/// Materialize origin TLS trust (CA cert) and client credentials (cert + key) into `origin_tls_dir`.
/// Also cleans up stale origin TLS files that are no longer referenced in `routing`.
pub async fn materialize_origin_tls(
    routing: &RoutingSpec,
    origin_tls_dir: &Path,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let mut changed = false;
    let mut expected_files: HashSet<String> = HashSet::new();

    let mut has_origin_tls = false;
    for domain in &routing.domains {
        for location in &domain.locations {
            let Some(tls) = location.origin_tls.as_ref().filter(|tls| tls.enabled) else {
                continue;
            };
            has_origin_tls = true;

            if tls.verify_cert && !tls.ca_cert.trim().is_empty() {
                let filename = format!("{}_ca.crt", location.upstream);
                expected_files.insert(filename.clone());
                let ca_file = origin_tls_dir.join(&filename);
                if atomic_write_if_changed(&ca_file, tls.ca_cert.as_bytes()).await? {
                    info!("Updated origin TLS CA file {}", ca_file.display());
                    changed = true;
                }
            }

            if tls.mtls {
                if !tls.client_cert.trim().is_empty() {
                    let cert_name = format!("{}_client.crt", location.upstream);
                    expected_files.insert(cert_name.clone());
                    let cert_file = origin_tls_dir.join(&cert_name);
                    if atomic_write_if_changed(&cert_file, tls.client_cert.as_bytes()).await? {
                        info!(
                            "Updated origin TLS client certificate {}",
                            cert_file.display()
                        );
                        changed = true;
                    }
                }

                if !tls.client_key.trim().is_empty() {
                    let key_name = format!("{}_client.key", location.upstream);
                    expected_files.insert(key_name.clone());
                    let key_file = origin_tls_dir.join(&key_name);
                    if atomic_write_if_changed(&key_file, tls.client_key.as_bytes()).await? {
                        info!(
                            "Updated origin TLS client private key {}",
                            key_file.display()
                        );
                        changed = true;
                    }
                    tokio::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600))
                        .await?;
                }
            }
        }
    }

    if has_origin_tls && !origin_tls_dir.exists() {
        tokio::fs::create_dir_all(origin_tls_dir).await?;
    }

    // Garbage Collection: remove stale origin TLS files
    if origin_tls_dir.exists() {
        let mut entries = tokio::fs::read_dir(origin_tls_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            if !file_type.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if (file_name.ends_with(".crt") || file_name.ends_with(".key"))
                && !expected_files.contains(&file_name)
            {
                info!(
                    "Removing stale origin TLS certificate file: {}",
                    entry.path().display()
                );
                tokio::fs::remove_file(entry.path()).await?;
                changed = true;
            }
        }
    }

    Ok(changed)
}

/// Materialize all TLS assets (Server SSL certificates, mTLS CAs, and Origin TLS credentials)
/// into their respective subdirectories within `routing_dir`.
pub async fn materialize_tls(
    spec: &Spec,
    routing_dir: &Path,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let mut changed = false;
    let certs_dir = routing_dir.join("certs");
    if materialize_server_certificates(&spec.certificates, &certs_dir).await? {
        changed = true;
    }

    let origin_tls_dir = routing_dir.join("origin-tls");
    if materialize_origin_tls(&spec.routing, &origin_tls_dir).await? {
        changed = true;
    }

    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CERT_WITH_SANS: &str = r#"-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIUIONvtjdkcvVZM9NT2/ifgIpAqYgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJSWdub3JlZENOMB4XDTI2MDkxNzE2MDYxOFoXDTI2MDkx
ODE2MDYxOFowFDESMBAGA1UEAwwJSWdub3JlZENOMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAtqp8akWy+609SLACkw085SAR4qhwv8fDp3x6weO8Dsqp
0C7RJJIFjf1RFFD3bF0HCVJFhG90LN/dAA88/0lyI+dCIerU3KkX7c8durGmYWQW
3MC2PS3/UtP9jp0yz67OdppXbDwpVA4E+aNNqSEa0t+AV7knAsII4Cc4ELFE6+Gr
s45iqgjzT8wkB8MpcSzmzL1dr/J0eJuBaGGuIi84BlVlO3kRC8qQiKtY3zP0RH0B
i0FA7LwgWOPpGaDGi+Qg89lw3txAv/aymFDKKVmouHYp3mqWLhnsms3sRtNzqAfg
vLB3JfvFJOmfQTdl6pidl06f3P3uUo4Y7TFkmfdT5QIDAQABo4GOMIGLMB0GA1Ud
DgQWBBSfpHl5w7Ogdq3gdV5P1Elpp6yQqDAfBgNVHSMEGDAWgBSfpHl5w7Ogdq3g
dV5P1Elpp6yQqDAPBgNVHRMBAf8EBTADAQH/MDgGA1UdEQQxMC+CD2FwaS5leGFt
cGxlLmNvbYINKi5leGFtcGxlLmNvbYINYmlsbGluZy5sb2NhbDANBgkqhkiG9w0B
AQsFAAOCAQEAYHmTAX/rHqW+24rYKs/idx94pD5zGtdg0ZdIEMejOF44k1Y+jdqv
pFb0fYn3vL3eFJeUerzoFN1AxLrX0EtrRmwWorECzHf/Wsn8bIMZ2F7PTO0gfTgw
NxSGtyyOf+p7HACejgHvhrActOv2oMxTKNZ5J96dajJ/psa7b3L/BzgvIu0XxPl9
YjFR6hrdQ6H2kKIlUSjPPEIfpmXwOfAGUQW5pqTadbThPW9t2QcOI2pUppoRe+Jt
UVKSwVcokGPjPfUUPRYM20jY+Tq2TxnZvBgCssnkn8fWQrDQQgt04jBVq5RggMt/
1MHZoM8dnAeaqviAd7E33qUiAIYlSDRC/w==
-----END CERTIFICATE-----"#;

    #[test]
    fn test_extract_sans_from_pem() {
        let sans = extract_sans_from_pem(SAMPLE_CERT_WITH_SANS);
        // CommonName "IgnoredCN" must NOT be present
        assert!(!sans.contains(&"ignoredcn".to_string()));
        // Subject Alternative Names must be extracted
        assert_eq!(
            sans,
            vec![
                "*.example.com".to_string(),
                "api.example.com".to_string(),
                "billing.local".to_string(),
            ]
        );
    }

    #[test]
    fn test_extract_sans_empty_or_invalid() {
        assert!(extract_sans_from_pem("").is_empty());
        assert!(extract_sans_from_pem("not a pem").is_empty());
    }

    #[test]
    fn test_certificate_spec_sans_precedence() {
        let cert_with_pem = CertificateSpec {
            id: "real-cert".to_string(),
            cert_pem: SAMPLE_CERT_WITH_SANS.to_string(),
            snis: vec!["legacy.dummy.local".to_string()],
            ..Default::default()
        };
        // When real cert_pem has SANs, cert.sans() returns extracted SANs and ignores legacy snis
        let sans = cert_with_pem.sans();
        assert!(sans.contains(&"api.example.com".to_string()));
        assert!(!sans.contains(&"legacy.dummy.local".to_string()));

        // When cert_pem has no valid cert (mock unit test data), falls back to snis
        let mock_cert = CertificateSpec {
            id: "mock".to_string(),
            cert_pem: "DUMMY_MOCK".to_string(),
            snis: vec!["mock.local".to_string()],
            ..Default::default()
        };
        assert_eq!(mock_cert.sans(), vec!["mock.local".to_string()]);
    }
}
