//! Unified Access Phase Execution Space for Aurora Gateway Extensions.
//!
//! Orchestrates the ingress security, authentication, admission, and dynamic routing
//! extensions in a single, straight-through Rust execution pipeline.
//! Evaluates extensions directly against `AccessRequestContext` without coupling to
//! plugin-internal request structs.

use std::sync::Arc;

use crate::{
    AccessDecision, AccessDenial, AccessRequestContext, ConnectionToken,
    blue_green::BlueGreenEngine,
    canary_release::CanaryReleaseEngine,
    connection_limit::ConnectionLimitEngine,
    ip_restriction::IpRestrictionEngine,
    jwt::{JwtDecision, JwtEngine},
    rate_limit::RateLimitEngine,
    request_mirror::RequestMirrorEngine,
    request_termination::RequestTerminationEngine,
    resource_limit::ResourceLimiter,
    traffic_shaper::TrafficShaperEngine,
    traffic_split::TrafficSplitEngine,
};

/// The collection of active engines available for this route/location in the Access Phase.
#[derive(Default)]
pub struct AccessPhaseEngines<'a> {
    pub ip_restriction: Option<&'a IpRestrictionEngine>,
    pub jwt: Option<&'a JwtEngine>,
    pub rate_limit: Option<&'a RateLimitEngine>,
    pub connection_limit: Option<&'a ConnectionLimitEngine>,
    pub traffic_shaper: Option<&'a TrafficShaperEngine>,
    pub resource_limit: Option<&'a ResourceLimiter>,
    pub request_termination: Option<&'a RequestTerminationEngine>,
    pub traffic_split: Option<&'a TrafficSplitEngine>,
    pub canary_release: Option<&'a CanaryReleaseEngine>,
    pub blue_green: Option<&'a BlueGreenEngine>,
    pub request_mirror: Option<&'a RequestMirrorEngine>,
}

/// Execution Space for the Access Phase.
pub struct AccessPhaseSpace<'a> {
    pub engines: AccessPhaseEngines<'a>,
}

impl<'a> AccessPhaseSpace<'a> {
    #[inline]
    pub fn new(engines: AccessPhaseEngines<'a>) -> Self {
        Self { engines }
    }

    /// Single Responsibility: Early admission filtering (IP, payload size, termination).
    fn check_admission(
        &self,
        ctx: &AccessRequestContext<'a>,
        _header_lookup: &impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Option<AccessDenial<'a>> {
        if let Some(ip_eng) = self.engines.ip_restriction
            && let Ok(decision) = ip_eng.evaluate_ctx(ctx)
            && decision.action == 1
        {
            return Some(AccessDenial {
                status: 403,
                www_authenticate: false,
                content_type: None,
                body: None,
            });
        }

        if let Some(res_limiter) = self.engines.resource_limit {
            let decision = res_limiter.evaluate_ctx(ctx);
            if !decision.allowed {
                return Some(AccessDenial {
                    status: decision.status_code,
                    www_authenticate: false,
                    content_type: None,
                    body: (!decision.response_body.is_empty()).then_some(decision.response_body),
                });
            }
        }

        if let Some(term_eng) = self.engines.request_termination {
            let decision = term_eng.evaluate_ctx(ctx);
            if decision.matched && decision.should_terminate {
                return Some(AccessDenial {
                    status: decision.status_code,
                    www_authenticate: false,
                    content_type: (!decision.content_type.is_empty())
                        .then_some(decision.content_type),
                    body: (!decision.body.is_empty()).then_some(decision.body.as_bytes()),
                });
            }
        }

        None
    }

    /// Single Responsibility: Identity authentication & claim extraction (JWT).
    fn check_authentication(
        &self,
        ctx: &AccessRequestContext<'a>,
        header_lookup: &impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<Arc<[(String, String)]>, AccessDenial<'a>> {
        if let Some(jwt_eng) = self.engines.jwt {
            match jwt_eng.evaluate_ctx(ctx, header_lookup) {
                Ok(JwtDecision::Allow {
                    forwarded_headers: fwd,
                }) => Ok(fwd),
                Ok(JwtDecision::Unauthorized) => Err(AccessDenial {
                    status: 401,
                    www_authenticate: true,
                    content_type: None,
                    body: None,
                }),
                Err(_) => Err(AccessDenial {
                    status: 503,
                    www_authenticate: false,
                    content_type: None,
                    body: None,
                }),
            }
        } else {
            Ok(crate::jwt::empty_forwarded_headers())
        }
    }

    /// Single Responsibility: Rate & capacity limits enforcement (RateLimit, ConnLimit, TrafficShaper).
    fn check_limits(
        &self,
        ctx: &AccessRequestContext<'a>,
        header_lookup: &impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<(Option<ConnectionToken>, (u64, u64)), AccessDenial<'a>> {
        if let Some(rl_eng) = self.engines.rate_limit {
            match rl_eng.evaluate_ctx(ctx, header_lookup) {
                Ok(decision) => {
                    if !decision.allowed {
                        return Err(AccessDenial {
                            status: decision.status_code,
                            www_authenticate: false,
                            content_type: None,
                            body: None,
                        });
                    }
                }
                Err(_) => {
                    return Err(AccessDenial {
                        status: 500,
                        www_authenticate: false,
                        content_type: None,
                        body: None,
                    });
                }
            }
        }

        let mut conn_token = None;
        if let Some(cl_eng) = self.engines.connection_limit {
            match cl_eng.acquire_ctx(ctx, header_lookup) {
                Ok(decision) => {
                    if !decision.allowed {
                        return Err(AccessDenial {
                            status: decision.status_code,
                            www_authenticate: false,
                            content_type: None,
                            body: None,
                        });
                    }
                    if let Some(token) = decision.token {
                        conn_token = Some(ConnectionToken {
                            is_redis: token.is_redis,
                            rule_id: token.rule_id,
                            identifier: String::from_utf8_lossy(&token.identifier).to_string(),
                        });
                    }
                }
                Err(_) => {
                    return Err(AccessDenial {
                        status: 500,
                        www_authenticate: false,
                        content_type: None,
                        body: None,
                    });
                }
            }
        }

        let mut rate_bytes_per_sec = 0;
        let mut burst_bytes = 0;
        if let Some(ts_eng) = self.engines.traffic_shaper {
            let decision = ts_eng.evaluate_ctx(ctx, header_lookup);
            if decision.matched {
                rate_bytes_per_sec = decision.rate_bytes_per_sec;
                burst_bytes = decision.burst_bytes;
            }
        }

        Ok((conn_token, (rate_bytes_per_sec, burst_bytes)))
    }

    /// Single Responsibility: Upstream destination & shadow mirror routing resolution.
    fn resolve_routing(
        &self,
        ctx: &AccessRequestContext<'a>,
        header_lookup: &impl Fn(&str) -> Option<&'a [u8]>,
    ) -> (Option<&'a str>, Option<Arc<[(String, String)]>>) {
        let mut target_upstream = None;
        let mut routing_headers = None;

        if let Some(ts_eng) = self.engines.traffic_split {
            let decision = ts_eng.evaluate_ctx(ctx, header_lookup);
            if decision.matched && !decision.upstream.is_empty() {
                target_upstream = Some(decision.upstream);
            }
        }

        if let Some(canary_eng) = self.engines.canary_release {
            let decision = canary_eng.evaluate_ctx(ctx, header_lookup);
            if decision.matched && !decision.upstream.is_empty() {
                target_upstream = Some(decision.upstream);
            }
        }

        if let Some(bg_eng) = self.engines.blue_green {
            let decision = bg_eng.evaluate_ctx(ctx, header_lookup);
            if decision.matched && !decision.upstream.is_empty() {
                target_upstream = Some(decision.upstream);
                if decision.headers_arc.is_some() {
                    routing_headers = decision.headers_arc;
                }
            }
        }

        if let Some(mirror_eng) = self.engines.request_mirror {
            let decision = mirror_eng.evaluate_ctx(ctx);
            if decision.is_mirrored && !decision.mirror_upstream.is_empty() {
                let _ = aurora_engine::shadow::try_dispatch_shadow(Box::pin(async move {
                    // Shadow task executed asynchronously on shadow worker
                }));
            }
        }

        (target_upstream, routing_headers)
    }

    /// Executes the entire Access Phase across Admission, Authentication, Limiting, and Routing.
    pub fn evaluate(
        &self,
        ctx: &AccessRequestContext<'a>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> AccessDecision<'a> {
        if let Some(denial) = self.check_admission(ctx, &header_lookup) {
            return denial.into();
        }

        let forwarded_headers = match self.check_authentication(ctx, &header_lookup) {
            Ok(headers) => headers,
            Err(denial) => return denial.into(),
        };

        let (conn_token, (rate_limit_bytes_per_sec, _)) =
            match self.check_limits(ctx, &header_lookup) {
                Ok(tuple) => tuple,
                Err(denial) => return denial.into(),
            };

        let (target_upstream, routing_headers) = self.resolve_routing(ctx, &header_lookup);

        let forwarded_headers = match (forwarded_headers.is_empty(), routing_headers) {
            (true, Some(rh)) => rh,
            (false, Some(rh)) => {
                let mut combined = Vec::with_capacity(forwarded_headers.len() + rh.len());
                combined.extend_from_slice(&forwarded_headers);
                combined.extend_from_slice(&rh);
                Arc::from(combined)
            }
            _ => forwarded_headers,
        };

        AccessDecision::Allow {
            forwarded_headers,
            target_upstream,
            rate_limit_bytes_per_sec,
            conn_token,
        }
    }
}
