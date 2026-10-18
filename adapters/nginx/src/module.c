#include "gateway.h"

static ngx_int_t ngx_http_gateway_init(ngx_conf_t *cf);
static void *ngx_http_gateway_create_conf(ngx_conf_t *cf);
static char *ngx_http_gateway_merge_conf(ngx_conf_t *cf, void *parent,
                                         void *child);
static ngx_int_t ngx_http_gateway_init_process(ngx_cycle_t *cycle);
static void ngx_http_gateway_exit_process(ngx_cycle_t *cycle);

static ngx_command_t ngx_http_gateway_commands[] = {
    /* Gateway Core Directives */
    {ngx_string("gateway"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF | NGX_CONF_FLAG,
     ngx_conf_set_flag_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, enabled), NULL},

    /* Extension: IP Restriction Policy */
    {ngx_string("gateway_ip_restriction_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, ip_restriction_policy), NULL},

    /* Legacy alias: Access Control Policy */
    {ngx_string("gateway_access_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, ip_restriction_policy), NULL},

    /* Extension: JWT Auth Policy */
    {ngx_string("gateway_jwt_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, jwt_policy), NULL},

    /* Extension: Rate Limit Policy */
    {ngx_string("gateway_rate_limit_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, rate_limit_policy), NULL},

    /* Extension: Connection Limit Policy */
    {ngx_string("gateway_conn_limit_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, conn_limit_policy), NULL},

    /* Extension: Traffic Shaper Policy */
    {ngx_string("gateway_traffic_shaper_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, traffic_shaper_policy), NULL},

    /* Extension: Request Size Limit Policy */
    {ngx_string("gateway_request_size_limit_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, request_size_limit_policy), NULL},

    /* Extension: Traffic Split Policy */
    {ngx_string("gateway_traffic_split_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, traffic_split_policy), NULL},

    /* Extension: Canary Release Policy */
    {ngx_string("gateway_canary_release_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, canary_release_policy), NULL},

    /* Extension: Blue-Green Deployment Policy */
    {ngx_string("gateway_blue_green_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, blue_green_policy), NULL},

    /* Extension: Request Mirror Policy */
    {ngx_string("gateway_request_mirror_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, request_mirror_policy), NULL},

    /* Extension: Request Termination Policy */
    {ngx_string("gateway_request_termination_policy"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF |
         NGX_CONF_TAKE1,
     ngx_conf_set_str_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, request_termination_policy), NULL},

    /* Metrics Directive */
    {ngx_string("gateway_metrics"), NGX_HTTP_LOC_CONF | NGX_CONF_NOARGS,
     ngx_http_gateway_metrics_directive, 0, 0, NULL},

    {ngx_string("aurora_waf_metrics"), NGX_HTTP_LOC_CONF | NGX_CONF_NOARGS,
     ngx_http_gateway_metrics_directive, 0, 0, NULL},

    /* Legacy aliases for backwards compatibility */
    {ngx_string("aurora_waf"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF | NGX_CONF_FLAG,
     ngx_conf_set_flag_slot, NGX_HTTP_LOC_CONF_OFFSET,
     offsetof(ngx_http_gateway_conf_t, enabled), NULL},

    ngx_null_command};

static ngx_http_module_t ngx_http_gateway_context = {
    ngx_http_gateway_variables,   /* preconfiguration */
    ngx_http_gateway_init,        /* postconfiguration */
    NULL,                         /* create main configuration */
    NULL,                         /* init main configuration */
    NULL,                         /* create server configuration */
    NULL,                         /* merge server configuration */
    ngx_http_gateway_create_conf, /* create location configuration */
    ngx_http_gateway_merge_conf   /* merge location configuration */
};

ngx_module_t ngx_http_gateway_module = {
    NGX_MODULE_V1,
    &ngx_http_gateway_context,     /* module context */
    ngx_http_gateway_commands,     /* module directives */
    NGX_HTTP_MODULE,               /* module type */
    NULL,                          /* init master */
    NULL,                          /* init module */
    ngx_http_gateway_init_process, /* init process */
    NULL,                          /* init thread */
    NULL,                          /* exit thread */
    ngx_http_gateway_exit_process, /* exit process */
    NULL,                          /* exit master */
    NGX_MODULE_V1_PADDING};

static void *ngx_http_gateway_create_conf(ngx_conf_t *cf) {
  ngx_http_gateway_conf_t *conf = ngx_pcalloc(cf->pool, sizeof(*conf));
  if (conf == NULL) {
    return NULL;
  }
  conf->enabled = NGX_CONF_UNSET;
  return conf;
}

static char *ngx_http_gateway_merge_conf(ngx_conf_t *cf, void *parent,
                                         void *child) {
  ngx_http_gateway_conf_t *prev = parent, *conf = child;

  /* Kế thừa giá trị mặc định từ parent nếu child chưa thiết lập */
  ngx_conf_merge_value(conf->enabled, prev->enabled, 0);

  /* Merge từng extension độc lập */
  if (ngx_http_gateway_merge_ip_restriction(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_jwt(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_rate_limit(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_conn_limit(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_traffic_shaper(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_request_size_limit(cf, prev, conf) !=
      NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_traffic_split(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_canary_release(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_blue_green(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_request_mirror(cf, prev, conf) != NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }
  if (ngx_http_gateway_merge_request_termination(cf, prev, conf) !=
      NGX_CONF_OK) {
    return NGX_CONF_ERROR;
  }

  return NGX_CONF_OK;
}

static ngx_int_t ngx_http_gateway_init(ngx_conf_t *cf) {
  ngx_http_core_main_conf_t *main;
  ngx_http_handler_pt *handler;

  /* Kiểm tra phiên bản ABI giữa C adapter và Rust FFI boundary */
  if (aurora_gateway_abi_version() != 4) {
    return NGX_ERROR;
  }
  ngx_str_t telemetry_name = ngx_string("aurora_telemetry_v1");
  gateway_telemetry_zone = ngx_shared_memory_add(
      cf, &telemetry_name, 8 * ngx_pagesize, &ngx_http_gateway_module);
  if (gateway_telemetry_zone == NULL) {
    return NGX_ERROR;
  }
  gateway_telemetry_zone->init = ngx_http_gateway_telemetry_zone_init;

  /* Đăng ký handler vào Access Phase của NGINX */
  main = ngx_http_conf_get_module_main_conf(cf, ngx_http_core_module);
  handler = ngx_array_push(&main->phases[NGX_HTTP_ACCESS_PHASE].handlers);
  if (handler == NULL) {
    return NGX_ERROR;
  }
  *handler = ngx_http_gateway_handler;

  /* Đăng ký handler vào Log Phase của NGINX */
  handler = ngx_array_push(&main->phases[NGX_HTTP_LOG_PHASE].handlers);
  if (handler == NULL) {
    return NGX_ERROR;
  }
  *handler = ngx_http_gateway_log_handler;

  return NGX_OK;
}

/* ========================================================================== */
/* Dynamic In-Memory Engine Registry & Out-of-band Hot-Swap Substrate        */
/*                                                                            */
/* Architecture & IPC Protection Guarantee:                                   */
/* - gateway_active_engines stores the active pointer for each extension.     */
/* - Request hot paths read from this registry directly (straight-line call). */
/* - Zero generation checking, zero IPC dilution, and zero lock contention    */
/*   inside the request processing pipeline.                                  */
/* - Out-of-band updates are driven by an NGINX epoll timer event (50ms).     */
/* ========================================================================== */

void *gateway_active_engines[AURORA_EXT_COUNT] = {NULL};
uint64_t gateway_active_generations[AURORA_EXT_COUNT] = {0};
static uint64_t gateway_last_policy_generation = 0;
static ngx_event_t gateway_policy_sync_event;

/**
 * Retrieves the currently active Rust engine instance for a given extension ID.
 * Returns NULL if the extension is disabled or not yet initialized.
 */
void *ngx_http_gateway_get_engine(uint32_t ext_id) {
  if (ext_id < AURORA_EXT_COUNT) {
    return gateway_active_engines[ext_id];
  }
  return NULL;
}

/**
 * Safely deallocates a Rust engine instance across the C-ABI boundary
 * using the corresponding extension-specific destructor.
 */
static void ngx_http_gateway_destroy_engine(uint32_t ext_id, void *engine) {
  if (engine == NULL) {
    return;
  }
  switch (ext_id) {
    case AURORA_EXT_IP_RESTRICTION:
      aurora_ip_restriction_destroy((AuroraIpRestrictionEngine *)engine);
      break;
    case AURORA_EXT_JWT:
      aurora_jwt_destroy((AuroraJwtEngine *)engine);
      break;
    case AURORA_EXT_RATE_LIMIT:
      aurora_rate_limit_destroy((AuroraRateLimitEngine *)engine);
      break;
    case AURORA_EXT_CONN_LIMIT:
      aurora_conn_limit_destroy((AuroraConnectionLimitEngine *)engine);
      break;
    case AURORA_EXT_TRAFFIC_SHAPER:
      aurora_traffic_shaper_destroy((AuroraTrafficShaperEngine *)engine);
      break;
    case AURORA_EXT_REQUEST_SIZE_LIMIT:
      aurora_request_size_limit_destroy((AuroraRequestSizeLimitEngine *)engine);
      break;
    case AURORA_EXT_TRAFFIC_SPLIT:
      aurora_traffic_split_destroy((AuroraTrafficSplitEngine *)engine);
      break;
    case AURORA_EXT_CANARY_RELEASE:
      aurora_canary_release_destroy((AuroraCanaryReleaseEngine *)engine);
      break;
    case AURORA_EXT_BLUE_GREEN:
      aurora_blue_green_destroy((AuroraBlueGreenEngine *)engine);
      break;
    case AURORA_EXT_REQUEST_MIRROR:
      aurora_request_mirror_destroy((AuroraRequestMirrorEngine *)engine);
      break;
    case AURORA_EXT_REQUEST_TERMINATION:
      aurora_request_termination_destroy((AuroraRequestTerminationEngine *)engine);
      break;
    default:
      break;
  }
}

/**
 * Synchronizes an individual policy slot from Shared Memory (SHM).
 *
 * Fault Tolerance Invariants:
 * 1. Checks slot generation; if unchanged, returns immediately (no-op).
 * 2. If data is present, attempts to parse and create a new engine instance.
 * 3. Only if creation succeeds (status == 0) or slot is disabled (len == 0):
 *    atomically swaps pointer in gateway_active_engines and destroys old engine.
 * 4. If payload is corrupted or invalid (status != 0), old engine is preserved.
 */
static void ngx_http_gateway_sync_slot(uint32_t ext_id) {
  uint64_t gen = 0;
  size_t len = 0;
  const uint8_t *data = aurora_gateway_policy_slot_get(ext_id, &gen, &len);

  if (gen == gateway_active_generations[ext_id]) {
    return;
  }

  void *new_engine = NULL;
  uint32_t status = 1;

  if (len > 0 && data != NULL) {
    switch (ext_id) {
      case AURORA_EXT_IP_RESTRICTION:
        status = aurora_ip_restriction_create(data, len, (AuroraIpRestrictionEngine **)&new_engine);
        break;
      case AURORA_EXT_JWT:
        status = aurora_jwt_create(data, len, (AuroraJwtEngine **)&new_engine);
        break;
      case AURORA_EXT_RATE_LIMIT:
        status = aurora_rate_limit_create(data, len, (AuroraRateLimitEngine **)&new_engine);
        break;
      case AURORA_EXT_CONN_LIMIT:
        status = aurora_conn_limit_create(data, len, (AuroraConnectionLimitEngine **)&new_engine);
        break;
      case AURORA_EXT_TRAFFIC_SHAPER:
        status = aurora_traffic_shaper_create(data, len, (AuroraTrafficShaperEngine **)&new_engine);
        break;
      case AURORA_EXT_REQUEST_SIZE_LIMIT:
        status = aurora_request_size_limit_create(data, len, (AuroraRequestSizeLimitEngine **)&new_engine);
        break;
      case AURORA_EXT_TRAFFIC_SPLIT:
        status = aurora_traffic_split_create(data, len, (AuroraTrafficSplitEngine **)&new_engine);
        break;
      case AURORA_EXT_CANARY_RELEASE:
        status = aurora_canary_release_create(data, len, (AuroraCanaryReleaseEngine **)&new_engine);
        break;
      case AURORA_EXT_BLUE_GREEN:
        status = aurora_blue_green_create(data, len, (AuroraBlueGreenEngine **)&new_engine);
        break;
      case AURORA_EXT_REQUEST_MIRROR:
        status = aurora_request_mirror_create(data, len, (AuroraRequestMirrorEngine **)&new_engine);
        break;
      case AURORA_EXT_REQUEST_TERMINATION:
        status = aurora_request_termination_create(data, len, (AuroraRequestTerminationEngine **)&new_engine);
        break;
      default:
        break;
    }
  }

  if (len == 0 || status == 0) {
    void *old_engine = gateway_active_engines[ext_id];
    gateway_active_engines[ext_id] = new_engine;
    gateway_active_generations[ext_id] = gen;
    ngx_http_gateway_destroy_engine(ext_id, old_engine);
  }
}

/**
 * Out-of-band timer callback executed by NGINX event loop (every 50ms).
 * Checks global atomic generation counter in SHM; if updated, triggers
 * slot-level synchronization and rearms timer.
 */
void ngx_http_gateway_policy_sync_handler(ngx_event_t *ev) {
  uint64_t total_gen = aurora_gateway_policy_generation();
  if (total_gen != gateway_last_policy_generation) {
    gateway_last_policy_generation = total_gen;
    for (uint32_t i = 0; i < AURORA_EXT_COUNT; i++) {
      ngx_http_gateway_sync_slot(i);
    }
  }

  if (!ngx_terminate && !ngx_quit) {
    ngx_add_timer(ev, 50);
  }
}

static ngx_int_t ngx_http_gateway_init_process(ngx_cycle_t *cycle) {
  /* Khởi tạo vùng nhớ chia sẻ liên tiến trình (SHM) phục vụ Agent Exporter */
  aurora_gateway_init_shm(NULL);

  /* Khởi tạo Policy SHM */
  aurora_gateway_init_policy_shm(NULL);

  /* Nạp policy ban đầu từ SHM nếu đã tồn tại */
  for (uint32_t i = 0; i < AURORA_EXT_COUNT; i++) {
    ngx_http_gateway_sync_slot(i);
  }
  gateway_last_policy_generation = aurora_gateway_policy_generation();

  /* Đăng ký timer kiểm tra cập nhật out-of-band trong event loop (50ms) */
  ngx_memzero(&gateway_policy_sync_event, sizeof(ngx_event_t));
  gateway_policy_sync_event.handler = ngx_http_gateway_policy_sync_handler;
  gateway_policy_sync_event.log = cycle->log;
  gateway_policy_sync_event.data = cycle;
  ngx_add_timer(&gateway_policy_sync_event, 50);

  if (gateway_telemetry_zone == NULL || gateway_telemetry_zone->data == NULL) {
    return NGX_OK;
  }
  if (sizeof(ngx_atomic_t) != sizeof(uint64_t) ||
      aurora_gateway_bind_telemetry(gateway_telemetry_zone->data, 64,
                                    (void *)ngx_stat_active) != 0) {
    return NGX_ERROR;
  }
  return NGX_OK;
}

static void ngx_http_gateway_exit_process(ngx_cycle_t *cycle) {
  (void)cycle;
  if (gateway_policy_sync_event.timer_set) {
    ngx_del_timer(&gateway_policy_sync_event);
  }
  for (uint32_t i = 0; i < AURORA_EXT_COUNT; i++) {
    if (gateway_active_engines[i] != NULL) {
      ngx_http_gateway_destroy_engine(i, gateway_active_engines[i]);
      gateway_active_engines[i] = NULL;
    }
  }
  aurora_gateway_stop_telemetry();
  aurora_gateway_stop_policy_shm();
}
