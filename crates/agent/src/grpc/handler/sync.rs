use crate::grpc::client::InterceptedChannel;
use crate::grpc::pb::spec_sync_service_client::SpecSyncServiceClient;
use crate::grpc::pb::{ReportSpecRequest, SyncSpecRequest, SyncSpecResponse};
use tonic::Request;

#[derive(Clone)]
pub struct SpecGrpcHandler {
    client: SpecSyncServiceClient<InterceptedChannel>,
}

impl SpecGrpcHandler {
    pub fn new(client: SpecSyncServiceClient<InterceptedChannel>) -> Self {
        Self { client }
    }

    pub async fn sync_spec(
        &self,
        node_id: &str,
        current_hash: &str,
    ) -> Result<SyncSpecResponse, String> {
        if node_id.is_empty() {
            return Err("node_id must not be empty".to_string());
        }

        let mut client = self.client.clone();
        let req = SyncSpecRequest {
            node_id: node_id.to_string(),
            current_hash: current_hash.to_string(),
        };

        let resp = client
            .sync_spec(Request::new(req))
            .await
            .map_err(|e| format!("gRPC sync_spec error: {}", e))?
            .into_inner();

        // Validate response
        if !resp.in_sync {
            if resp.spec_yaml.trim().is_empty() {
                return Err("Control Plane returned empty spec_yaml when in_sync is false".to_string());
            }
            if resp.hash.len() != 64 || !resp.hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!("Invalid SHA-256 hash returned from Control Plane: {}", resp.hash));
            }
        }

        Ok(resp)
    }

    pub async fn report_spec(
        &self,
        node_id: &str,
        release_id: i64,
        hash: &str,
        status: &str,
        message: &str,
    ) -> Result<(), String> {
        if node_id.is_empty() {
            return Err("node_id must not be empty".to_string());
        }

        let mut client = self.client.clone();
        let req = ReportSpecRequest {
            node_id: node_id.to_string(),
            release_id,
            hash: hash.to_string(),
            status: status.to_string(),
            message: message.to_string(),
        };

        client
            .report_spec(Request::new(req))
            .await
            .map_err(|e| format!("gRPC report_spec error: {}", e))?;

        Ok(())
    }
}
