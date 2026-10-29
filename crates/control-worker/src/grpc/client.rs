use super::proto as pb;
use pb::spec_sync_service_client::SpecSyncServiceClient;
use tonic::metadata::MetadataValue;
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};

#[derive(Clone)]
pub struct AuthInterceptor {
    token_header: MetadataValue<tonic::metadata::Ascii>,
}

impl tonic::service::Interceptor for AuthInterceptor {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        request
            .metadata_mut()
            .insert("authorization", self.token_header.clone());
        Ok(request)
    }
}

pub type InterceptedChannel = InterceptedService<Channel, AuthInterceptor>;

#[derive(Clone)]
pub struct GrpcClient {
    pub spec: SpecSyncServiceClient<InterceptedChannel>,
}

impl GrpcClient {
    /// Create a GrpcClient using application configuration (supports Plaintext, TLS, and mTLS).
    pub fn new(cfg: &crate::config::Config) -> anyhow::Result<Self> {
        let endpoint = cfg.grpc_endpoint();
        let mut ep = Endpoint::from_shared(endpoint)?;

        match cfg.grpc_tls_mode {
            crate::config::GrpcTlsMode::Plaintext => {
                // Plaintext TCP, no TLS config
            }
            crate::config::GrpcTlsMode::Tls => {
                let mut tls = ClientTlsConfig::new();
                if let Some(ref ca_path) = cfg.grpc_ca_cert {
                    let ca_pem = std::fs::read(ca_path).map_err(|e| {
                        anyhow::anyhow!(
                            "failed to read GRPC_CA_CERT at {}: {}",
                            ca_path.display(),
                            e
                        )
                    })?;
                    tls = tls.ca_certificate(Certificate::from_pem(ca_pem));
                }
                if let Some(ref domain) = cfg.grpc_tls_domain {
                    tls = tls.domain_name(domain.clone());
                }
                ep = ep.tls_config(tls)?;
            }
            crate::config::GrpcTlsMode::Mtls => {
                let mut tls = ClientTlsConfig::new();
                if let Some(ref ca_path) = cfg.grpc_ca_cert {
                    let ca_pem = std::fs::read(ca_path).map_err(|e| {
                        anyhow::anyhow!(
                            "failed to read GRPC_CA_CERT at {}: {}",
                            ca_path.display(),
                            e
                        )
                    })?;
                    tls = tls.ca_certificate(Certificate::from_pem(ca_pem));
                }
                if let (Some(cert_path), Some(key_path)) =
                    (&cfg.grpc_client_cert, &cfg.grpc_client_key)
                {
                    let cert_pem = std::fs::read(cert_path).map_err(|e| {
                        anyhow::anyhow!(
                            "failed to read GRPC_CLIENT_CERT at {}: {}",
                            cert_path.display(),
                            e
                        )
                    })?;
                    let key_pem = std::fs::read(key_path).map_err(|e| {
                        anyhow::anyhow!(
                            "failed to read GRPC_CLIENT_KEY at {}: {}",
                            key_path.display(),
                            e
                        )
                    })?;
                    let identity = Identity::from_pem(cert_pem, key_pem);
                    tls = tls.identity(identity);
                }
                if let Some(ref domain) = cfg.grpc_tls_domain {
                    tls = tls.domain_name(domain.clone());
                }
                ep = ep.tls_config(tls)?;
            }
        }

        let channel = ep.connect_lazy();

        let token_val = format!("Bearer {}", cfg.auth_token);
        let token_header = token_val
            .parse()
            .unwrap_or_else(|_| MetadataValue::from_static(""));

        let interceptor = AuthInterceptor { token_header };
        let spec = SpecSyncServiceClient::with_interceptor(channel, interceptor);

        Ok(Self { spec })
    }

    pub fn spec_handler(&self) -> crate::grpc::handler::SpecGrpcHandler {
        crate::grpc::handler::SpecGrpcHandler::new(self.spec.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, GrpcTlsMode};

    #[tokio::test]
    async fn test_grpc_client_new_plaintext() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            auth_token: "test-token".to_string(),
            grpc_tls_mode: GrpcTlsMode::Plaintext,
            ..Default::default()
        };

        let client = GrpcClient::new(&cfg);
        assert!(client.is_ok());
    }

    #[tokio::test]
    async fn test_grpc_client_new_tls() {
        let dir =
            std::env::temp_dir().join(format!("test-grpc-client-tls-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let ca_file = dir.join("ca.crt");
        std::fs::write(
            &ca_file,
            b"-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n",
        )
        .unwrap();

        let cfg = Config {
            controller_url: "https://controller.internal:8080".to_string(),
            auth_token: "test-token".to_string(),
            grpc_tls_mode: GrpcTlsMode::Tls,
            grpc_ca_cert: Some(ca_file),
            grpc_tls_domain: Some("controller.internal".to_string()),
            ..Default::default()
        };

        let client = GrpcClient::new(&cfg);
        assert!(client.is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn test_grpc_client_new_mtls() {
        let dir =
            std::env::temp_dir().join(format!("test-grpc-client-mtls-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let ca_file = dir.join("ca.crt");
        let cert_file = dir.join("client.crt");
        let key_file = dir.join("client.key");
        let valid_cert = b"-----BEGIN CERTIFICATE-----\nMIIBfzCCASWgAwIBAgIUaj6+hj4viorWD9T7Pl1/GfMniegwCgYIKoZIzj0EAwIw\nFTETMBEGA1UEAwwKdGVzdC1hZ2VudDAeFw0yNjA5MTcxNjM1MDJaFw0yNzA5MTcx\nNjM1MDJaMBUxEzARBgNVBAMMCnRlc3QtYWdlbnQwWTATBgcqhkjOPQIBBggqhkjO\nPQMBBwNCAAQ9ZvB8W+cI6GLezflyyM38f2GZK4So0r4lXUjVzUkx0U4Rd7lSBRye\n4qQ7GjDKCBzsmTCMrjbROSg1eJR039mro1MwUTAdBgNVHQ4EFgQUPFCv+sEK7y2B\n0JCp5wFiTobYzhUwHwYDVR0jBBgwFoAUPFCv+sEK7y2B0JCp5wFiTobYzhUwDwYD\nVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBIMCazEo3sRfCLnQ6PTusp\nkp/PN3DslZ1XZo1bOg6UKwIhAPEQ0G5gyDwsZZreVgHVXGtp5Dk7/jmEglRfPdFv\nQSrc\n-----END CERTIFICATE-----\n";
        let valid_key = b"-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIC29qusHuPHII0sMJN+bF2ziSdZTKmDrgteyjaFhykpSoAoGCCqGSM49\nAwEHoUQDQgAEPWbwfFvnCOhi3s35csjN/H9hmSuEqNK+JV1I1c1JMdFOEXe5UgUc\nnuKkOxowyggc7JkwjK420TkoNXiUdN/Zqw==\n-----END EC PRIVATE KEY-----\n";
        std::fs::write(&ca_file, valid_cert).unwrap();
        std::fs::write(&cert_file, valid_cert).unwrap();
        std::fs::write(&key_file, valid_key).unwrap();

        let cfg = Config {
            controller_url: "https://controller.internal:8080".to_string(),
            auth_token: "test-token".to_string(),
            grpc_tls_mode: GrpcTlsMode::Mtls,
            grpc_ca_cert: Some(ca_file),
            grpc_client_cert: Some(cert_file),
            grpc_client_key: Some(key_file),
            grpc_tls_domain: Some("controller.internal".to_string()),
            ..Default::default()
        };

        let client = GrpcClient::new(&cfg);
        if let Err(ref e) = client {
            eprintln!("mtls error: {e}");
        }
        assert!(client.is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }
}
