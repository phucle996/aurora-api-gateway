use super::proto as pb;

use pb::access_sync_service_client::AccessSyncServiceClient;
use pb::domain_routing_sync_service_client::DomainRoutingSyncServiceClient;
use pb::heartbeat_service_client::HeartbeatServiceClient;
use pb::module_sync_service_client::ModuleSyncServiceClient;
use pb::policy_sync_service_client::PolicySyncServiceClient;
use pb::upstream_sync_service_client::UpstreamSyncServiceClient;
use pb::*;
use tonic::metadata::MetadataValue;
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Channel, Endpoint};
use tonic::Request;

#[derive(Clone)]
pub struct AuthInterceptor {
    token_header: MetadataValue<tonic::metadata::Ascii>,
}

impl tonic::service::Interceptor for AuthInterceptor {
    fn call(&mut self, mut request: Request<()>) -> Result<Request<()>, tonic::Status> {
        request
            .metadata_mut()
            .insert("authorization", self.token_header.clone());
        Ok(request)
    }
}

pub type InterceptedChannel = InterceptedService<Channel, AuthInterceptor>;

#[derive(Clone)]
pub struct GrpcClient {
    heartbeat: HeartbeatServiceClient<InterceptedChannel>,
    policy: PolicySyncServiceClient<InterceptedChannel>,
    access: AccessSyncServiceClient<InterceptedChannel>,
    upstream: UpstreamSyncServiceClient<InterceptedChannel>,
    routing: DomainRoutingSyncServiceClient<InterceptedChannel>,
    module: ModuleSyncServiceClient<InterceptedChannel>,
}

impl GrpcClient {
    pub fn new(endpoint: &str, token: &str) -> Result<Self, tonic::transport::Error> {
        let ep = Endpoint::from_shared(endpoint.to_string())?;
        let channel = ep.connect_lazy();

        let token_val = format!("Bearer {}", token);
        let token_header = token_val.parse().unwrap_or_else(|_| MetadataValue::from_static(""));

        let interceptor = AuthInterceptor { token_header };

        let heartbeat = HeartbeatServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let policy = PolicySyncServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let access = AccessSyncServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let upstream = UpstreamSyncServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let routing = DomainRoutingSyncServiceClient::with_interceptor(channel.clone(), interceptor.clone());
        let module = ModuleSyncServiceClient::with_interceptor(channel, interceptor);

        Ok(Self {
            heartbeat,
            policy,
            access,
            upstream,
            routing,
            module,
        })
    }

    // --- Caller Methods ---

    pub async fn send_heartbeat(&self, req: HeartbeatRequest) -> Result<HeartbeatResponse, tonic::Status> {
        let mut client = self.heartbeat.clone();
        let resp = client.send_heartbeat(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn get_policy(&self, node_id: &str) -> Result<PolicySyncResponse, tonic::Status> {
        let mut client = self.policy.clone();
        let req = GetPolicyRequest {
            node_id: node_id.to_string(),
        };
        let resp = client.get_policy(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn report_policy(
        &self,
        node_id: &str,
        release_id: i64,
        phase: &str,
        message: &str,
    ) -> Result<ReportPolicyResponse, tonic::Status> {
        let mut client = self.policy.clone();
        let req = ReportPolicyRequest {
            node_id: node_id.to_string(),
            release_id,
            phase: phase.to_string(),
            message: message.to_string(),
        };
        let resp = client.report_policy(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn get_access(&self, node_id: &str) -> Result<AccessSyncResponse, tonic::Status> {
        let mut client = self.access.clone();
        let req = GetAccessRequest {
            node_id: node_id.to_string(),
        };
        let resp = client.get_access(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn report_access(
        &self,
        node_id: &str,
        release_id: i64,
        phase: &str,
        message: &str,
    ) -> Result<ReportAccessResponse, tonic::Status> {
        let mut client = self.access.clone();
        let req = ReportAccessRequest {
            node_id: node_id.to_string(),
            release_id,
            phase: phase.to_string(),
            message: message.to_string(),
        };
        let resp = client.report_access(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn get_upstreams(&self, node_id: &str) -> Result<UpstreamSyncResponse, tonic::Status> {
        let mut client = self.upstream.clone();
        let req = GetUpstreamsRequest {
            node_id: node_id.to_string(),
        };
        let resp = client.get_upstreams(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn report_upstreams(
        &self,
        node_id: &str,
        release_id: i64,
        phase: &str,
        message: &str,
    ) -> Result<ReportUpstreamsResponse, tonic::Status> {
        let mut client = self.upstream.clone();
        let req = ReportUpstreamsRequest {
            node_id: node_id.to_string(),
            release_id,
            phase: phase.to_string(),
            message: message.to_string(),
        };
        let resp = client.report_upstreams(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn get_domain_routing_bundle(
        &self,
        node_id: &str,
    ) -> Result<DomainRoutingBundleResponse, tonic::Status> {
        let mut client = self.routing.clone();
        let req = GetDomainRoutingBundleRequest {
            node_id: node_id.to_string(),
        };
        let resp = client.get_domain_routing_bundle(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn poll_module_job(&self, node_id: &str) -> Result<PollModuleJobResponse, tonic::Status> {
        let mut client = self.module.clone();
        let req = PollModuleJobRequest {
            node_id: node_id.to_string(),
        };
        let resp = client.poll_module_job(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn append_module_job_log(
        &self,
        req: AppendModuleJobLogRequest,
    ) -> Result<AppendModuleJobLogResponse, tonic::Status> {
        let mut client = self.module.clone();
        let resp = client.append_module_job_log(Request::new(req)).await?;
        Ok(resp.into_inner())
    }

    pub async fn report_modules(
        &self,
        req: ModuleReportRequest,
    ) -> Result<ModuleReportResponse, tonic::Status> {
        let mut client = self.module.clone();
        let resp = client.report_modules(Request::new(req)).await?;
        Ok(resp.into_inner())
    }
}
