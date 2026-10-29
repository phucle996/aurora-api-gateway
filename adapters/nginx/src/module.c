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

    /* Metrics Directive */
    {ngx_string("gateway_metrics"), NGX_HTTP_LOC_CONF | NGX_CONF_NOARGS,
     ngx_http_gateway_metrics_directive, 0, 0, NULL},

    /* Standard Stream & Structured Log Directive */
    {ngx_string("gateway_std_log"),
     NGX_HTTP_MAIN_CONF | NGX_HTTP_SRV_CONF | NGX_HTTP_LOC_CONF | NGX_CONF_TAKE1,
     ngx_http_gateway_std_log_directive, 0, 0, NULL},

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
  ngx_conf_merge_value(conf->enabled, prev->enabled, 0);
  return NGX_CONF_OK;
}

static ngx_int_t ngx_http_gateway_init(ngx_conf_t *cf) {
  ngx_http_core_main_conf_t *main;
  ngx_http_handler_pt *handler;

  /* Kiểm tra phiên bản ABI giữa C adapter và Rust FFI boundary */
  if (aurora_gateway_abi_version() != 4) {
    return NGX_ERROR;
  }

  /* Đăng ký handler vào Access Phase của NGINX */
  main = ngx_http_conf_get_module_main_conf(cf, ngx_http_core_module);
  handler = ngx_array_push(&main->phases[NGX_HTTP_ACCESS_PHASE].handlers);
  if (handler == NULL) {
    return NGX_ERROR;
  }
  *handler = ngx_http_gateway_handler;

  /*
   * TRIỆT TIÊU HOÀN TOÀN NGINX NATIVE LOG HANDLER:
   * Loại bỏ toàn bộ handler của ngx_http_log_module khỏi NGX_HTTP_LOG_PHASE.
   * Ngăn NGINX thực thi ngx_http_log_handler và kiểm tra lcf->off trên hot path,
   * triệt tiêu hoàn toàn 100% chi phí CPU của module log NGINX cũ dù access_log on hay off.
   */
  main->phases[NGX_HTTP_LOG_PHASE].handlers.nelts = 0;

  /* Đăng ký handler duy nhất vào Log Phase của NGINX */
  handler = ngx_array_push(&main->phases[NGX_HTTP_LOG_PHASE].handlers);
  if (handler == NULL) {
    return NGX_ERROR;
  }
  *handler = ngx_http_gateway_log_handler;

  return NGX_OK;
}

/* ========================================================================== */
/* Process Lifecycle & Out-of-band Policy Sync Timer                          */
/* ========================================================================== */

static ngx_event_t gateway_policy_sync_event;

static void ngx_http_gateway_policy_sync_handler(ngx_event_t *ev) {
  aurora_gateway_policy_sync();

  if (!ngx_terminate && !ngx_quit) {
    ev->cancelable = 1;
    ngx_add_timer(ev, 50);
  }
}

static ngx_int_t ngx_http_gateway_init_process(ngx_cycle_t *cycle) {
  if (aurora_gateway_process_init((uint32_t)ngx_worker) != 0) {
    ngx_log_error(NGX_LOG_WARN, cycle->log, 0,
                  "Gateway: failed to initialize process substrates on worker %ui",
                  ngx_worker);
  }

  if (ngx_worker == 0) {
    uint32_t caps = aurora_gateway_probe_kernel();
    ngx_log_error(NGX_LOG_NOTICE, cycle->log, 0,
                  "Gateway: kernel acceleration capabilities: 0x%04uxd "
                  "(notsent_lowat=%d, cpu_affinity=%d, busy_poll=%d, user_timeout=%d, fastopen=%d, bbr=%d)",
                  caps,
                  (caps & AURORA_CAP_TCP_NOTSENT_LOWAT) != 0,
                  (caps & AURORA_CAP_SO_INCOMING_CPU) != 0,
                  (caps & AURORA_CAP_SO_BUSY_POLL) != 0,
                  (caps & AURORA_CAP_TCP_USER_TIMEOUT) != 0,
                  (caps & AURORA_CAP_TCP_FASTOPEN) != 0,
                  (caps & AURORA_CAP_TCP_BBR) != 0);
  }

  /* Đăng ký timer kiểm tra cập nhật policy out-of-band trong event loop (50ms) */
  ngx_memzero(&gateway_policy_sync_event, sizeof(ngx_event_t));
  gateway_policy_sync_event.handler = ngx_http_gateway_policy_sync_handler;
  gateway_policy_sync_event.log = cycle->log;
  gateway_policy_sync_event.data = cycle;
  gateway_policy_sync_event.cancelable = 1;
  ngx_add_timer(&gateway_policy_sync_event, 50);

  return NGX_OK;
}

static void ngx_http_gateway_exit_process(ngx_cycle_t *cycle) {
  (void)cycle;
  if (gateway_policy_sync_event.timer_set) {
    ngx_del_timer(&gateway_policy_sync_event);
  }
  aurora_gateway_process_exit();
}
