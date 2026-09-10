use super::proto as pb;
use pb::heartbeat_service_client::HeartbeatServiceClient;
use pb::spec_sync_service_client::SpecSyncServiceClient;
use tonic::metadata::MetadataValue;
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Channel, Endpoint};

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
    pub heartbeat: HeartbeatServiceClient<InterceptedChannel>,
    pub spec: SpecSyncServiceClient<InterceptedChannel>,
}

impl GrpcClient {
    pub fn new(endpoint: &str, token: &str) -> Result<Self, tonic::transport::Error> {
        let ep = Endpoint::from_shared(endpoint.to_string())?;
        let channel = ep.connect_lazy();

        let token_val = format!("Bearer {}", token);
        let token_header = token_val
            .parse()
            .unwrap_or_else(|_| MetadataValue::from_static(""));

        let interceptor = AuthInterceptor { token_header };

        let heartbeat =
            HeartbeatServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let spec = SpecSyncServiceClient::with_interceptor(channel, interceptor);

        Ok(Self { heartbeat, spec })
    }

    pub fn heartbeat_handler(&self) -> crate::grpc::handler::HeartbeatGrpcHandler {
        crate::grpc::handler::HeartbeatGrpcHandler::new(self.heartbeat.clone())
    }

    pub fn spec_handler(&self) -> crate::grpc::handler::SpecGrpcHandler {
        crate::grpc::handler::SpecGrpcHandler::new(self.spec.clone())
    }
}
