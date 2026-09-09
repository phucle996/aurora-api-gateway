use crate::grpc::client::InterceptedChannel;
use crate::grpc::pb::heartbeat_service_client::HeartbeatServiceClient;
use crate::grpc::pb::{HeartbeatRequest, HeartbeatResponse};
use tonic::Request;

#[derive(Clone)]
pub struct HeartbeatGrpcHandler {
    client: HeartbeatServiceClient<InterceptedChannel>,
}

impl HeartbeatGrpcHandler {
    pub fn new(client: HeartbeatServiceClient<InterceptedChannel>) -> Self {
        Self { client }
    }

    pub async fn send_heartbeat(
        &self,
        req: HeartbeatRequest,
    ) -> Result<HeartbeatResponse, String> {
        if req.node_id.is_empty() {
            return Err("node_id must not be empty".to_string());
        }

        let mut client = self.client.clone();
        let resp = client
            .send_heartbeat(Request::new(req))
            .await
            .map_err(|e| format!("gRPC send_heartbeat error: {}", e))?
            .into_inner();

        Ok(resp)
    }
}
