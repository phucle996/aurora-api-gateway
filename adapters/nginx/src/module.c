#include "gateway.h"

static ngx_int_t ngx_http_gateway_init(ngx_conf_t *cf);
static void *ngx_http_gateway_create_conf(ngx_conf_t *cf);
static char *ngx_http_gateway_merge_conf(ngx_conf_t *cf, void *parent, void *child);
static ngx_int_t ngx_http_gateway_init_process(ngx_cycle_t *cycle);
static void ngx_http_gateway_exit_process(ngx_cycle_t *cycle);

static ngx_conf_enum_t ngx_http_gateway_modes[] = {
    { ngx_string("enforce"), 0 },
    { ngx_string("audit"), 1 },
    { ngx_null_string, 0 }
};

static ngx_command_t ngx_http_gateway_commands[] = {
    /* Gateway Core Directives */
    { ngx_string("gateway"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_FLAG,
      ngx_conf_set_flag_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, enabled),
      NULL },

    /* Extension: Access Control Policy */
    { ngx_string("gateway_access_policy"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, access_policy), NULL },

    /* Extension: JWT Auth Policy */
    { ngx_string("gateway_jwt_policy"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, jwt_policy), NULL },

    /* Extension: Rate Limit Policy */
    { ngx_string("gateway_rate_limit_policy"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, rate_limit_policy), NULL },

    /* Extension: Core WAF Policy */
    { ngx_string("gateway_waf_policy"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, policy),
      NULL },

    /* Extension: Core WAF Mode */
    { ngx_string("gateway_waf_mode"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_enum_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, mode),
      ngx_http_gateway_modes },

    /* Control Plane Directives */
    { ngx_string("gateway_controller"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, controller),
      NULL },

    { ngx_string("gateway_node_id"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, node_id),
      NULL },

    { ngx_string("gateway_token"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, token),
      NULL },

    { ngx_string("gateway_heartbeat_interval"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_num_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_gateway_conf_t, interval),
      NULL },

    /* Metrics Directive */
    { ngx_string("gateway_metrics"),
      NGX_HTTP_LOC_CONF|NGX_CONF_NOARGS,
      ngx_http_gateway_metrics_directive,
      0,
      0,
      NULL },

    ngx_null_command
};

static ngx_http_module_t ngx_http_gateway_context = {
    ngx_http_gateway_variables,     /* preconfiguration */
    ngx_http_gateway_init,          /* postconfiguration */
    NULL,                           /* create main configuration */
    NULL,                           /* init main configuration */
    NULL,                           /* create server configuration */
    NULL,                           /* merge server configuration */
    ngx_http_gateway_create_conf,   /* create location configuration */
    ngx_http_gateway_merge_conf     /* merge location configuration */
};

ngx_module_t ngx_http_gateway_module = {
    NGX_MODULE_V1,
    &ngx_http_gateway_context,      /* module context */
    ngx_http_gateway_commands,      /* module directives */
    NGX_HTTP_MODULE,                /* module type */
    NULL,                           /* init master */
    NULL,                           /* init module */
    ngx_http_gateway_init_process,  /* init process */
    NULL,                           /* init thread */
    NULL,                           /* exit thread */
    ngx_http_gateway_exit_process,  /* exit process */
    NULL,                           /* exit master */
    NGX_MODULE_V1_PADDING
};


static void *
ngx_http_gateway_create_conf(ngx_conf_t *cf)
{
    ngx_http_gateway_conf_t *conf = ngx_pcalloc(cf->pool, sizeof(*conf));
    if (conf == NULL) { return NULL; }
    conf->enabled = NGX_CONF_UNSET;
    conf->mode = NGX_CONF_UNSET_UINT;
    conf->interval = NGX_CONF_UNSET_UINT;
    return conf;
}

static char *
ngx_http_gateway_merge_conf(ngx_conf_t *cf, void *parent, void *child)
{
    ngx_http_gateway_conf_t *prev = parent, *conf = child;

    /* Kế thừa giá trị mặc định từ parent nếu child chưa thiết lập */
    ngx_conf_merge_value(conf->enabled, prev->enabled, 0);
    ngx_conf_merge_uint_value(conf->mode, prev->mode, 0);
    ngx_conf_merge_str_value(conf->policy, prev->policy, "");
    ngx_conf_merge_str_value(conf->controller, prev->controller, "");
    ngx_conf_merge_str_value(conf->node_id, prev->node_id, "");
    ngx_conf_merge_str_value(conf->token, prev->token, "");
    ngx_conf_merge_uint_value(conf->interval, prev->interval, 10);

    /* Merge từng extension độc lập */
    if (ngx_http_gateway_merge_access(cf, prev, conf) != NGX_CONF_OK) { return NGX_CONF_ERROR; }
    if (ngx_http_gateway_merge_jwt(cf, prev, conf) != NGX_CONF_OK) { return NGX_CONF_ERROR; }
    if (ngx_http_gateway_merge_rate_limit(cf, prev, conf) != NGX_CONF_OK) { return NGX_CONF_ERROR; }
    if (ngx_http_gateway_merge_waf(cf, prev, conf) != NGX_CONF_OK) { return NGX_CONF_ERROR; }

    return NGX_CONF_OK;
}

static ngx_int_t
ngx_http_gateway_init(ngx_conf_t *cf)
{
    ngx_http_core_main_conf_t *main;
    ngx_http_handler_pt *handler;

    /* Kiểm tra phiên bản ABI giữa C adapter và Rust FFI boundary */
    if (aurora_waf_abi_version() != 4) { return NGX_ERROR; }
    ngx_str_t telemetry_name = ngx_string("aurora_telemetry_v1");
    gateway_telemetry_zone = ngx_shared_memory_add(cf, &telemetry_name, 8 * ngx_pagesize, &ngx_http_gateway_module);
    if (gateway_telemetry_zone == NULL) { return NGX_ERROR; }
    gateway_telemetry_zone->init = ngx_http_gateway_telemetry_zone_init;

    /* Đăng ký handler vào Access Phase của NGINX */
    main = ngx_http_conf_get_module_main_conf(cf, ngx_http_core_module);
    handler = ngx_array_push(&main->phases[NGX_HTTP_ACCESS_PHASE].handlers);
    if (handler == NULL) { return NGX_ERROR; }
    *handler = ngx_http_gateway_handler;

    return NGX_OK;
}

static ngx_int_t
ngx_http_gateway_init_process(ngx_cycle_t *cycle)
{
    if (gateway_telemetry_zone == NULL) { return NGX_OK; }
    if (sizeof(ngx_atomic_t) != sizeof(uint64_t) ||
        aurora_waf_bind_telemetry(gateway_telemetry_zone->data, 64, (void *) ngx_stat_active) != 0) {
        return NGX_ERROR;
    }
    {
        uint32_t is_leader = (ngx_process == NGX_PROCESS_SINGLE || ngx_worker == 0) ? 1 : 0;
        char *controller = NULL;
        char *node_id = NULL;
        char *token = NULL;
        char *policy_path = NULL;
        char *access_path = NULL;
        uint32_t interval = 5;
        int64_t release_id = 0;

        if (cycle->conf_ctx) {
            ngx_http_conf_ctx_t *ctx = (ngx_http_conf_ctx_t *) cycle->conf_ctx[ngx_http_module.index];
            if (ctx) {
                ngx_http_gateway_conf_t *conf = NULL;
                if (ctx->loc_conf) {
                    conf = ctx->loc_conf[ngx_http_gateway_module.ctx_index];
                }
                if ((!conf || conf->controller.len == 0) && ctx->main_conf) {
                    ngx_http_core_main_conf_t *cmcf = ctx->main_conf[ngx_http_core_module.ctx_index];
                    if (cmcf && cmcf->servers.nelts > 0) {
                        ngx_http_core_srv_conf_t **cscfp = cmcf->servers.elts;
                        if (cscfp && cscfp[0] && cscfp[0]->ctx && cscfp[0]->ctx->loc_conf) {
                            conf = cscfp[0]->ctx->loc_conf[ngx_http_gateway_module.ctx_index];
                        }
                    }
                }

                if (conf) {
                    if (conf->controller.len > 0) {
                        u_char *c = ngx_pcalloc(cycle->pool, conf->controller.len + 1);
                        if (c) {
                            ngx_memcpy(c, conf->controller.data, conf->controller.len);
                            controller = (char *) c;
                        }
                    }
                    if (conf->node_id.len > 0) {
                        u_char *n = ngx_pcalloc(cycle->pool, conf->node_id.len + 1);
                        if (n) {
                            ngx_memcpy(n, conf->node_id.data, conf->node_id.len);
                            node_id = (char *) n;
                        }
                    }
                    if (conf->token.len > 0) {
                        u_char *t = ngx_pcalloc(cycle->pool, conf->token.len + 1);
                        if (t) {
                            ngx_memcpy(t, conf->token.data, conf->token.len);
                            token = (char *) t;
                        }
                    }
                    if (conf->policy.len > 0) {
                        u_char *p = ngx_pcalloc(cycle->pool, conf->policy.len + 1);
                        if (p) {
                            ngx_memcpy(p, conf->policy.data, conf->policy.len);
                            policy_path = (char *) p;
                        }
                    }
                    if (conf->access_policy.len > 0) {
                        u_char *a = ngx_pcalloc(cycle->pool, conf->access_policy.len + 1);
                        if (a) {
                            ngx_memcpy(a, conf->access_policy.data, conf->access_policy.len);
                            access_path = (char *) a;
                        }
                    }
                    if (conf->interval != NGX_CONF_UNSET_UINT && conf->interval > 0) {
                        interval = (uint32_t) conf->interval;
                    }
                    if (conf->engine) {
                        release_id = (int64_t) aurora_waf_generation(conf->engine);
                    }
                }
            }
        }

        aurora_waf_start_runtime(controller, node_id, token, interval, release_id, policy_path, access_path, is_leader);
    }
    return NGX_OK;
}

static void
ngx_http_gateway_exit_process(ngx_cycle_t *cycle)
{
    (void) cycle;
    aurora_waf_stop_telemetry();
}
