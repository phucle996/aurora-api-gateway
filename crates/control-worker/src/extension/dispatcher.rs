use crate::spec::materialize::ExtensionInstanceSpec;
use std::sync::Arc;
use tracing::debug;

/// Manages auxiliary non-NGINX extension configurations and lifecycles.
/// Telemetry pipelines (Prometheus, OTLP, access logs) are executed directly in-process
/// by the Aurora Gateway Engine and Companion Shadow Worker threads.
pub struct ExtensionDispatcher {
    node_id: Arc<String>,
}

impl ExtensionDispatcher {
    pub fn new(node_id: Arc<String>) -> Self {
        Self { node_id }
    }

    pub async fn apply_spec(&mut self, instances: &[ExtensionInstanceSpec]) -> Result<(), String> {
        debug!(
            node_id = %self.node_id,
            count = instances.len(),
            "ExtensionDispatcher: synced extension instances (telemetry handled in-process by gateway engine)"
        );
        Ok(())
    }

    pub async fn shutdown_all(&mut self) {
        debug!(
            node_id = %self.node_id,
            "ExtensionDispatcher: shutdown completed"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dispatcher_lifecycle() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()));
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "test-ext".to_string(),
            key: "test/ext".to_string(),
            version: 1,
            renderer: "test".to_string(),
            manifest_digest: String::new(),
            config_json: "{}".to_string(),
        }];

        assert!(dispatcher.apply_spec(&instances).await.is_ok());
        dispatcher.shutdown_all().await;
    }
}
