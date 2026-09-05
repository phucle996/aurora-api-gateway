#include <ngx_config.h>
#include <ngx_core.h>
#include <ngx_http.h>
#include "aurora_waf.h"

/*
 * Cấu hình WAF cho từng location / server block trong NGINX.
 */
typedef struct {
    ngx_flag_t enabled;      /* Bật/tắt WAF (on/off) */
    ngx_uint_t mode;         /* Chế độ hoạt động: enforce (chặn) hoặc audit (chỉ log) */
    ngx_str_t policy;        /* Đường dẫn tới file policy snapshot */
    ngx_str_t controller;    /* URL của Control Plane (VD: http://127.0.0.1:8080) */
    ngx_str_t node_id;       /* ID của Node (VD: node-local-01) */
    ngx_str_t token;         /* Bearer token xác thực */
    ngx_uint_t interval;     /* Chu kỳ gửi heartbeat (giây) */
    AuroraEngine *engine;    /* Con trỏ tới instance Rust engine tương ứng với policy */
} ngx_http_aurora_conf_t;

/* Khai báo trước các hàm xử lý vòng đời và request */
static ngx_int_t ngx_http_aurora_init(ngx_conf_t *cf);
static void *ngx_http_aurora_create_conf(ngx_conf_t *cf);
static char *ngx_http_aurora_merge_conf(ngx_conf_t *cf, void *parent, void *child);
static ngx_int_t ngx_http_aurora_handler(ngx_http_request_t *r);
static void ngx_http_aurora_cleanup(void *data);
static ngx_int_t ngx_http_aurora_variables(ngx_conf_t *cf);
static ngx_int_t ngx_http_aurora_generation(ngx_http_request_t *r, ngx_http_variable_value_t *v, uintptr_t data);
static ngx_int_t ngx_http_aurora_init_process(ngx_cycle_t *cycle);
static void ngx_http_aurora_exit_process(ngx_cycle_t *cycle);

/* Best-effort match summaries: cap per-worker output, never queue raw requests. */
static time_t aurora_log_second;
static ngx_uint_t aurora_log_count;

/*
 * Danh sách enum cho directive aurora_waf_mode:
 * - enforce (0): Chặn các request vi phạm policy (trả về 403 Forbidden).
 * - audit (1): Không chặn, chỉ ghi log cảnh báo (cho phép request đi tiếp).
 */
static ngx_conf_enum_t ngx_http_aurora_modes[] = {
    { ngx_string("enforce"), 0 },
    { ngx_string("audit"), 1 },
    { ngx_null_string, 0 }
};

/*
 * Các directive cấu hình được module hỗ trợ trong file nginx.conf:
 * - aurora_waf: on | off
 * - aurora_waf_policy: <đường_dẫn_file_policy>
 * - aurora_waf_mode: enforce | audit
 * - aurora_waf_controller: <url_control_plane>
 * - aurora_waf_node_id: <id_node>
 * - aurora_waf_token: <bearer_token>
 * - aurora_waf_heartbeat_interval: <giây>
 */
static ngx_command_t ngx_http_aurora_commands[] = {
    { ngx_string("aurora_waf"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_FLAG,
      ngx_conf_set_flag_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, enabled),
      NULL },
    { ngx_string("aurora_waf_policy"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, policy),
      NULL },
    { ngx_string("aurora_waf_mode"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_enum_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, mode),
      ngx_http_aurora_modes },
    { ngx_string("aurora_waf_controller"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, controller),
      NULL },
    { ngx_string("aurora_waf_node_id"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, node_id),
      NULL },
    { ngx_string("aurora_waf_token"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_str_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, token),
      NULL },
    { ngx_string("aurora_waf_heartbeat_interval"),
      NGX_HTTP_MAIN_CONF|NGX_HTTP_SRV_CONF|NGX_HTTP_LOC_CONF|NGX_CONF_TAKE1,
      ngx_conf_set_num_slot,
      NGX_HTTP_LOC_CONF_OFFSET,
      offsetof(ngx_http_aurora_conf_t, interval),
      NULL },
    ngx_null_command
};

/*
 * Ngữ cảnh HTTP module:
 * - ngx_http_aurora_init: Đăng ký handler vào access phase.
 * - ngx_http_aurora_create_conf: Khởi tạo cấu hình location.
 * - ngx_http_aurora_merge_conf: Kế thừa và tải policy vào Rust engine.
 */
static ngx_http_module_t ngx_http_aurora_context = {
    ngx_http_aurora_variables,      /* preconfiguration */
    ngx_http_aurora_init,         /* postconfiguration */
    NULL,                          /* create main configuration */
    NULL,                          /* init main configuration */
    NULL,                          /* create server configuration */
    NULL,                          /* merge server configuration */
    ngx_http_aurora_create_conf,  /* create location configuration */
    ngx_http_aurora_merge_conf    /* merge location configuration */
};

/* Định nghĩa NGINX module export */
ngx_module_t ngx_http_aurora_waf_module = {
    NGX_MODULE_V1,
    &ngx_http_aurora_context,      /* module context */
    ngx_http_aurora_commands,     /* module directives */
    NGX_HTTP_MODULE,               /* module type */
    NULL,                          /* init master */
    NULL,                          /* init module */
    ngx_http_aurora_init_process,  /* init process */
    NULL,                          /* init thread */
    NULL,                          /* exit thread */
    ngx_http_aurora_exit_process,  /* exit process */
    NULL,                          /* exit master */
    NGX_MODULE_V1_PADDING
};

/*
 * Cấp phát vùng nhớ cho cấu hình location và đặt trạng thái chưa thiết lập (UNSET).
 */
static void *
ngx_http_aurora_create_conf(ngx_conf_t *cf)
{
    ngx_http_aurora_conf_t *conf = ngx_pcalloc(cf->pool, sizeof(*conf));
    if (conf == NULL) { return NULL; }
    conf->enabled = NGX_CONF_UNSET;
    conf->mode = NGX_CONF_UNSET_UINT;
    conf->interval = NGX_CONF_UNSET_UINT;
    return conf;
}

/*
 * Callback giải phóng tài nguyên: Hủy instance Rust AuroraEngine khi pool NGINX bị hủy.
 */
static void
ngx_http_aurora_cleanup(void *data)
{
    aurora_waf_destroy(data);
}

/*
 * Gộp cấu hình từ block cha xuống block con và khởi tạo Rust WAF Engine từ file policy.
 */
static char *
ngx_http_aurora_merge_conf(ngx_conf_t *cf, void *parent, void *child)
{
    ngx_http_aurora_conf_t *prev = parent, *conf = child;
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    /* Kế thừa giá trị mặc định từ parent nếu child chưa thiết lập */
    ngx_conf_merge_value(conf->enabled, prev->enabled, 0);
    ngx_conf_merge_uint_value(conf->mode, prev->mode, 0);
    ngx_conf_merge_str_value(conf->policy, prev->policy, "");
    ngx_conf_merge_str_value(conf->controller, prev->controller, "");
    ngx_conf_merge_str_value(conf->node_id, prev->node_id, "");
    ngx_conf_merge_str_value(conf->token, prev->token, "");
    ngx_conf_merge_uint_value(conf->interval, prev->interval, 10);

    /* Nếu WAF không được kích hoạt, bỏ qua các bước nạp policy */
    if (!conf->enabled) { return NGX_CONF_OK; }

    /*
     * Yêu cầu cấu hình satisfy all: Ngăn chặn tình trạng bypass access-phase
     * nếu có module access khác cấu hình allow (ví dụ allow IP trong satisfy any).
     */
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Aurora requires satisfy all to prevent access-phase bypass");
        return NGX_CONF_ERROR;
    }

    /* Bắt buộc phải chỉ định file policy khi bật WAF */
    if (conf->policy.len == 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "aurora_waf on requires aurora_waf_policy");
        return NGX_CONF_ERROR;
    }

    /* Tái sử dụng instance engine nếu cùng trỏ tới cùng file policy của parent */
    if (prev->engine && conf->policy.data == prev->policy.data) {
        conf->engine = prev->engine;
        return NGX_CONF_OK;
    }

    /* Chuẩn hóa đường dẫn đầy đủ của file policy */
    if (ngx_conf_full_name(cf->cycle, &conf->policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    /* Mở file policy dạng non-blocking, chỉ đọc */
    fd = open((char *) conf->policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Aurora policy %V", &conf->policy);
        return NGX_CONF_ERROR;
    }

    /* Kiểm tra file hợp lệ và giới hạn kích thước an toàn (1 byte .. 64KB) */
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 65536) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Aurora policy must be a regular file of 1..65536 bytes");
        return NGX_CONF_ERROR;
    }

    /* Cấp phát bộ nhớ tạm từ pool để đọc nội dung file policy */
    bytes = ngx_pnalloc(cf->temp_pool, 65537);
    if (bytes == NULL) { close(fd); return NGX_CONF_ERROR; }

    /* Đọc toàn bộ nội dung file policy, xử lý ngắt tín hiệu EINTR */
    while (used < 65537) {
        n = read(fd, bytes + used, 65537 - used);
        if (n == -1 && errno == EINTR) { continue; }
        if (n <= 0) { break; }
        used += (size_t) n;
    }
    close(fd);
    if (n < 0 || used != (size_t) st.st_size) { return NGX_CONF_ERROR; }

    /* Đăng ký cleanup handler để giải phóng Rust engine khi pool NGINX bị hủy */
    cleanup = ngx_pool_cleanup_add(cf->pool, 0);
    if (cleanup == NULL) { return NGX_CONF_ERROR; }

    /* Gọi FFI tạo instance Rust AuroraEngine từ bytes policy đã đọc */
    status = aurora_waf_create(bytes, used, &conf->engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Aurora policy %V (status %ui)", &conf->policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }

    cleanup->handler = ngx_http_aurora_cleanup;
    cleanup->data = conf->engine;
    return NGX_CONF_OK;
}

/*
 * Handler chính xử lý request trong HTTP Access Phase.
 * Đánh giá URI của request qua Rust AuroraEngine và ra quyết định cho phép / chặn.
 */
static ngx_int_t
ngx_http_aurora_handler(ngx_http_request_t *r)
{
    ngx_http_aurora_conf_t *conf = ngx_http_get_module_loc_conf(r, ngx_http_aurora_waf_module);
    uint32_t status;
    AuroraDecision decision;
    ngx_log_t log;

    /* Nếu WAF không bật tại location này, chuyển tiếp cho handler tiếp theo */
    if (!conf->enabled) { return NGX_DECLINED; }

    /* Gọi FFI sang Rust core để đánh giá đường dẫn URI chuẩn hóa */
    status = aurora_waf_evaluate_v3(conf->engine, r->uri.data, r->uri.len, &decision);
    if (status != 0 || decision.action > 1) {
        /*
         * Xử lý lỗi engine / panic:
         * Xóa log.handler tạm thời để tránh rò rỉ query/request nhạy cảm vào access log NGINX.
         */
        log = *r->connection->log;
        log.handler = NULL; /* Do not append raw request/query via NGINX's HTTP log handler. */
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Aurora evaluation failed: %ui", (ngx_uint_t) status);
        return NGX_HTTP_SERVICE_UNAVAILABLE; /* 503 Service Unavailable khi engine lỗi */
    }

    /* Action = 1 (Block/Vi phạm rule) */
    if (aurora_log_second != ngx_time()) {
        aurora_log_second = ngx_time();
        aurora_log_count = 0;
    }
    if (decision.log_matches != 0 && aurora_log_count < 100) {
        aurora_log_count++;
        log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_INFO, &log, 0, "Aurora match generation=%uL rule=%uL score=%ui logs=%ui",
                      decision.generation, decision.rule_id, (ngx_uint_t) decision.score, (ngx_uint_t) decision.log_matches);
    }
    if (decision.action == 1) {
        /* Chế độ Audit: Chỉ ghi log cảnh báo, không chặn request */
        if (conf->mode == 1) {
            log = *r->connection->log;
            log.handler = NULL;
            ngx_log_error(NGX_LOG_NOTICE, &log, 0, "Aurora audit: would block normalized path");
            return NGX_DECLINED;
        }
        /* Chế độ Enforce: Trả về 403 Forbidden để chặn request */
        return NGX_HTTP_FORBIDDEN;
    }

    /* Action = 0 (Allow): Cho phép request đi tiếp qua các phase xử lý tiếp theo */
    return NGX_DECLINED;
}

/*
 * Khởi tạo module sau khi đọc xong cấu hình:
 * 1. Kiểm tra phiên bản ABI tương thích với thư viện Rust C ABI (phải bằng 3).
 * 2. Đăng ký ngx_http_aurora_handler vào mảng handlers của NGX_HTTP_ACCESS_PHASE.
 */
static ngx_int_t
ngx_http_aurora_init(ngx_conf_t *cf)
{
    ngx_http_core_main_conf_t *main;
    ngx_http_handler_pt *handler;

    /* Kiểm tra phiên bản ABI giữa C adapter và Rust FFI boundary */
    if (aurora_waf_abi_version() != 3) { return NGX_ERROR; }

    /* Đăng ký handler vào Access Phase của NGINX */
    main = ngx_http_conf_get_module_main_conf(cf, ngx_http_core_module);
    handler = ngx_array_push(&main->phases[NGX_HTTP_ACCESS_PHASE].handlers);
    if (handler == NULL) { return NGX_ERROR; }
    *handler = ngx_http_aurora_handler;

    return NGX_OK;
}

/* Optional observability variable, not an all-workers activation acknowledgement. */
static ngx_int_t
ngx_http_aurora_variables(ngx_conf_t *cf)
{
    ngx_str_t name = ngx_string("aurora_waf_generation");
    ngx_http_variable_t *v = ngx_http_add_variable(cf, &name, NGX_HTTP_VAR_NOCACHEABLE);
    if (v == NULL) { return NGX_ERROR; }
    v->get_handler = ngx_http_aurora_generation;
    return NGX_OK;
}

static ngx_int_t
ngx_http_aurora_generation(ngx_http_request_t *r, ngx_http_variable_value_t *v, uintptr_t data)
{
    ngx_http_aurora_conf_t *conf = ngx_http_get_module_loc_conf(r, ngx_http_aurora_waf_module);
    u_char *p = ngx_pnalloc(r->pool, NGX_INT64_LEN);
    (void) data;
    if (p == NULL) { return NGX_ERROR; }
    v->len = ngx_sprintf(p, "%uL", aurora_waf_generation(conf->engine)) - p;
    v->data = p;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
}

/*
 * Khởi tạo tiến trình NGINX worker:
 * Chỉ Worker 0 (hoặc single process) khởi chạy background telemetry thread.
 */
static ngx_int_t
ngx_http_aurora_init_process(ngx_cycle_t *cycle)
{
    if (ngx_process == NGX_PROCESS_SINGLE || ngx_worker == 0) {
        char *controller = NULL;
        char *node_id = NULL;
        char *token = NULL;
        uint32_t interval = 10;
        int64_t release_id = 0;

        if (cycle->conf_ctx) {
            ngx_http_conf_ctx_t *ctx = (ngx_http_conf_ctx_t *) cycle->conf_ctx[ngx_http_module.index];
            if (ctx && ctx->loc_conf) {
                ngx_http_aurora_conf_t *conf = ctx->loc_conf[ngx_http_aurora_waf_module.ctx_index];
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
                    if (conf->interval != NGX_CONF_UNSET_UINT && conf->interval > 0) {
                        interval = (uint32_t) conf->interval;
                    }
                    if (conf->engine) {
                        release_id = (int64_t) aurora_waf_generation(conf->engine);
                    }
                }
            }
        }

        aurora_waf_start_telemetry(controller, node_id, token, interval, release_id);
    }
    return NGX_OK;
}

/*
 * Khi tiến trình NGINX worker dừng:
 * Dừng background telemetry thread an toàn.
 */
static void
ngx_http_aurora_exit_process(ngx_cycle_t *cycle)
{
    if (ngx_process == NGX_PROCESS_SINGLE || ngx_worker == 0) {
        aurora_waf_stop_telemetry();
    }
}

