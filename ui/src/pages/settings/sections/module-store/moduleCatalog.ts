export type ModuleCategory = 'all' | 'performance' | 'security' | 'observability' | 'routing' | 'utilities';

export interface CatalogModule {
  id: string;
  name: string;
  packageName: string;
  aliases: string[];
  category: 'performance' | 'security' | 'observability' | 'routing' | 'utilities';
  version: string;
  author: string;
  description: string;
  summary: string;
  iconName: string;
  directivesExample: string;
  action?: 'install_brotli' | 'check';
  isDynamic: boolean;
  docUrl?: string;
}

export const MODULE_CATALOG: CatalogModule[] = [
  // --- PROTOCOLS & PERFORMANCE ---
  {
    id: 'http_v3_module',
    name: 'HTTP/3 & QUIC (UDP Protocol)',
    packageName: 'ngx_http_v3_module',
    aliases: ['http_v3', 'http_v3_module', 'quic', 'http3'],
    category: 'performance',
    version: 'RFC 9114',
    author: 'NGINX Core',
    summary: 'Giao thức HTTP/3 chạy trên nền QUIC/UDP, giảm độ trễ 0-RTT và khắc phục Head-of-Line Blocking.',
    description: 'Cung cấp khả năng phục vụ lưu lượng HTTP/3 qua cổng UDP 443. QUIC kết hợp TLS 1.3 ngay trong tầng vận chuyển, giúp kết nối mạng di động chuyển vùng mượt mà và tải tài nguyên web với tốc độ tối đa.',
    iconName: 'Network',
    directivesExample: `server {
    # Lắng nghe cả cổng TCP 443 và UDP 443 cho QUIC/HTTP3
    listen 443 ssl;
    listen 443 quic reuseport;

    ssl_protocols TLSv1.3;
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # Thông báo cho trình duyệt biết website hỗ trợ HTTP/3
    add_header Alt-Svc 'h3=":443"; ma=86400' always;
    add_header QUIC-Status $http3 always;
}`,
    isDynamic: false,
  },
  {
    id: 'http_v2_module',
    name: 'HTTP/2 Protocol (Multiplexing)',
    packageName: 'ngx_http_v2_module',
    aliases: ['http_v2', 'http_v2_module', 'http2'],
    category: 'performance',
    version: 'RFC 7540',
    author: 'NGINX Core',
    summary: 'Ghép kênh nhị phân đa luồng (Multiplexing) và nén tiêu đề HPACK cho client kết nối.',
    description: 'Cho phép truyền tải đồng thời hàng trăm request/response trên cùng 1 kết nối TCP duy nhất mà không bị nghẽn thứ tự, giảm thiểu tối đa thời gian chờ của trình duyệt.',
    iconName: 'Radio',
    directivesExample: `server {
    listen 443 ssl;
    http2 on;
}`,
    isDynamic: false,
  },
  {
    id: 'brotli',
    name: 'Google Brotli Compression',
    packageName: 'ngx_brotli',
    aliases: ['brotli', 'ngx_http_brotli_filter_module', 'ngx_http_brotli_static_module'],
    category: 'performance',
    version: '1.0.0',
    author: 'Google',
    summary: 'Thuật toán nén thế hệ mới, tiết kiệm 20-30% dung lượng băng thông so với Gzip.',
    description: 'Nén dữ liệu tĩnh và động (HTML, CSS, JS, SVG, JSON) với tỷ lệ nén vượt trội của Google, giúp trang web load nhanh hơn hẳn.',
    iconName: 'Zap',
    directivesExample: `brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/javascript application/json image/svg+xml;`,
    action: 'install_brotli',
    isDynamic: true,
  },
  {
    id: 'gzip',
    name: 'Standard Gzip Compression',
    packageName: 'ngx_http_gzip_module',
    aliases: ['gzip', 'http_gzip_module'],
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Bộ nén tiêu chuẩn tương thích 100% với tất cả các trình duyệt và thiết bị từ cổ điển đến hiện đại.',
    description: 'Nén HTTP payloads thời gian thực bằng thuật toán Deflate, tối ưu tốc độ truyền tải trên toàn mạng Internet.',
    iconName: 'Minimize2',
    directivesExample: `gzip on;
gzip_min_length 1024;
gzip_proxied any;
gzip_comp_level 5;
gzip_types text/plain text/css application/json application/javascript;`,
    isDynamic: false,
  },
  {
    id: 'http_gzip_static_module',
    name: 'Gzip Static Pre-compression',
    packageName: 'ngx_http_gzip_static_module',
    aliases: ['http_gzip_static_module', 'gzip_static'],
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Truy xuất trực tiếp file nén sẵn .gz trên ổ cứng, giải phóng 100% tài nguyên CPU khi nén.',
    description: 'Khi client gửi header Accept-Encoding: gzip, NGINX sẽ kiểm tra xem file file.ext.gz có sẵn trên đĩa hay không để trả về trực tiếp mà không cần nén on-the-fly.',
    iconName: 'Layers',
    directivesExample: `gzip_static on;
gzip_http_version 1.1;
gzip_proxied any;`,
    isDynamic: false,
  },
  {
    id: 'zstd',
    name: 'Zstandard (zstd) Compression',
    packageName: 'ngx_http_zstd_module',
    aliases: ['zstd', 'ngx_http_zstd_filter_module'],
    category: 'performance',
    version: '0.1.1',
    author: 'Meta (Facebook)',
    summary: 'Thuật toán nén siêu tốc thời gian thực của Meta, lý tưởng cho REST API và gRPC payloads.',
    description: 'Tốc độ nén cực nhanh ở cấp độ microsecond với tỷ lệ nén gần bằng Brotli, rất phù hợp cho các dịch vụ đòi hỏi throughput cao.',
    iconName: 'Cpu',
    directivesExample: `zstd on;
zstd_comp_level 3;
zstd_types application/json application/xml text/plain;`,
    isDynamic: true,
  },
  {
    id: 'http_gunzip_module',
    name: 'Gunzip Decompression Filter',
    packageName: 'ngx_http_gunzip_module',
    aliases: ['http_gunzip_module', 'gunzip'],
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Tự động giải nén dữ liệu từ upstream để phục vụ các client cũ hoặc cho WAF phân tích nội dung.',
    description: 'Giải nén các response nén gzip nếu client không hỗ trợ gzip hoặc khi WAF engine cần soi quét deep-inspection nội dung payload.',
    iconName: 'RefreshCw',
    directivesExample: `gunzip on;`,
    isDynamic: false,
  },
  {
    id: 'cache_purge',
    name: 'FastCGI & Proxy Cache Purge',
    packageName: 'ngx_cache_purge',
    aliases: ['cache_purge', 'ngx_http_cache_purge_module'],
    category: 'performance',
    version: '2.5.3',
    author: 'FRiCKLE',
    summary: 'Xóa cache NGINX tức thì (Instant Invalidation) chỉ qua một HTTP request PURGE.',
    description: 'Hỗ trợ xóa cache cục bộ hoặc cache phân tán khi bài viết được cập nhật trên CMS/Backend mà không cần restart service.',
    iconName: 'Sparkles',
    directivesExample: `location ~ /purge(/.*) {
    allow 127.0.0.1;
    deny all;
    proxy_cache_purge cache_zone $1$is_args$args;
}`,
    isDynamic: true,
  },
  {
    id: 'pagespeed',
    name: 'Google PageSpeed Optimization',
    packageName: 'ngx_pagespeed',
    aliases: ['pagespeed', 'ngx_http_pagespeed_module'],
    category: 'performance',
    version: '1.14.36',
    author: 'Google',
    summary: 'Tự động tối ưu hóa tài nguyên web, gộp CSS/JS, nén ảnh sang định dạng WebP/AVIF.',
    description: 'Bộ công cụ tối ưu frontend tự động hàng đầu của Google, tự động rewrite tài nguyên HTML/CSS/JS để đạt điểm Google Core Web Vitals tối đa.',
    iconName: 'Zap',
    directivesExample: `pagespeed on;
pagespeed FileCachePath /var/cache/ngx_pagespeed;
pagespeed RewriteLevel CoreFilters;`,
    isDynamic: true,
  },
  {
    id: 'http_slice_module',
    name: 'HTTP Slice (Range Caching)',
    packageName: 'ngx_http_slice_module',
    aliases: ['http_slice_module', 'slice'],
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Cắt file dung lượng lớn thành từng mảnh nhỏ để cache cục bộ cho Video/Download.',
    description: 'Cho phép NGINX cache các tệp tin video, file ISO lớn từ upstream theo từng dải byte (byte ranges), tránh việc tải lại toàn bộ file khi client tạm dừng xem.',
    iconName: 'Film',
    directivesExample: `slice 1m;
proxy_cache_key $uri$is_args$args$slice_range;
proxy_set_header Range $slice_range;`,
    isDynamic: false,
  },

  // --- SECURITY & WAF ---
  {
    id: 'ngx_http_aurora_waf_module',
    name: 'Aurora WAF Native Rust Engine',
    packageName: 'ngx_http_aurora_waf_module',
    aliases: ['ngx_http_aurora_waf_module', 'aurora_waf'],
    category: 'security',
    version: '0.4.1 (Rust ABI v3)',
    author: 'Aurora Security Lab',
    summary: 'Engine WAF in-process siêu tốc viết bằng Rust, bảo vệ trước SQLi, RCE, XSS và DDoS.',
    description: 'Nạp trực tiếp vào NGINX access phase, thực thi các thuật toán phân tích URI, Header, Body và Access Policy hoàn toàn trong RAM không gây độ trễ mạng.',
    iconName: 'ShieldCheck',
    directivesExample: `aurora_waf on;
aurora_waf_mode enforce;
aurora_waf_policy /var/lib/aurora-policy/active-policy.json;`,
    isDynamic: true,
  },
  {
    id: 'geoip2',
    name: 'MaxMind GeoIP2 / Geo-Blocking',
    packageName: 'ngx_http_geoip2_module',
    aliases: ['geoip2', 'ngx_http_geoip2_module'],
    category: 'security',
    version: '3.4',
    author: 'leev (MaxMind)',
    summary: 'Phân tích địa lý IP, chặn hoặc rate-limit truy cập theo quốc gia/thành phố.',
    description: 'Tích hợp cơ sở dữ liệu MaxMind GeoLite2/GeoIP2 để lọc truy cập từ các khu vực địa lý có rủi ro cao hoặc phân luồng người dùng theo vị trí.',
    iconName: 'Globe',
    directivesExample: `geoip2 /var/lib/GeoIP/GeoLite2-Country.mmdb {
    $geoip2_data_country_code default=XX country iso_code;
}
if ($geoip2_data_country_code ~ (RU|CN|KP)) {
    return 403 "Access denied from your region";
}`,
    isDynamic: true,
  },
  {
    id: 'headers_more',
    name: 'Headers More / Obfuscation',
    packageName: 'ngx_http_headers_more_filter_module',
    aliases: ['headers_more', 'ngx_http_headers_more_filter_module'],
    category: 'security',
    version: '0.34',
    author: 'OpenResty',
    summary: 'Ẩn danh hoàn toàn thông tin phiên bản NGINX và tinh chỉnh linh hoạt Request/Response Headers.',
    description: 'Loại bỏ hoàn toàn header Server: nginx, chống việc tin tặc quét lỗi tự động và bổ sung các header HTTP Strict Transport Security (HSTS).',
    iconName: 'Lock',
    directivesExample: `more_clear_headers Server;
more_set_headers "X-Security-Protection: Aurora-WAF";
more_set_headers "X-Frame-Options: SAMEORIGIN";`,
    isDynamic: true,
  },
  {
    id: 'http_ssl_module',
    name: 'SSL/TLS Cryptographic Engine',
    packageName: 'ngx_http_ssl_module',
    aliases: ['http_ssl_module', 'ssl'],
    category: 'security',
    version: 'OpenSSL 3.5.5',
    author: 'NGINX Core',
    summary: 'Mã hóa HTTPS TLS 1.2 / 1.3 với ALPN, SNI, OCSP Stapling và Session Resumption.',
    description: 'Module bảo mật cốt lõi xử lý mã hóa dữ liệu HTTPS an toàn, quản lý chứng chỉ SSL/TLS và bảo vệ đường truyền người dùng.',
    iconName: 'Lock',
    directivesExample: `ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;`,
    isDynamic: false,
  },
  {
    id: 'http_realip_module',
    name: 'Real IP / Reverse Proxy Client ID',
    packageName: 'ngx_http_realip_module',
    aliases: ['http_realip_module', 'realip'],
    category: 'security',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Trích xuất IP thật của Client từ các header X-Forwarded-For, Cloudflare hoặc PROXY Protocol.',
    description: 'Đảm bảo WAF và Access Logs luôn ghi nhận chính xác địa chỉ IP gốc của người dùng cuối thay vì IP của Load Balancer hay CDN trung gian.',
    iconName: 'Share2',
    directivesExample: `set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
real_ip_header X-Forwarded-For;
real_ip_recursive on;`,
    isDynamic: false,
  },
  {
    id: 'http_secure_link_module',
    name: 'Secure Link (Anti-Hotlinking)',
    packageName: 'ngx_http_secure_link_module',
    aliases: ['http_secure_link_module', 'secure_link'],
    category: 'security',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Bảo vệ đường link tải file bằng chữ ký băm MD5 kèm thời hạn hết hạn (TTL).',
    description: 'Chống hành vi trộm link (hotlinking), chỉ cho phép tải tệp tin khi có chữ ký hợp lệ được sinh từ backend ứng dụng.',
    iconName: 'KeyRound',
    directivesExample: `secure_link $arg_st,$arg_expires;
secure_link_md5 "$secure_link_expires$uri$remote_addr secret_key";
if ($secure_link = "") { return 403; }
if ($secure_link = "0") { return 410; }`,
    isDynamic: false,
  },
  {
    id: 'http_auth_request_module',
    name: 'Auth Request (SSO / Subrequest)',
    packageName: 'ngx_http_auth_request_module',
    aliases: ['http_auth_request_module', 'auth_request'],
    category: 'security',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Xác thực truy cập qua subrequest nội bộ tới dịch vụ xác thực SSO, OAuth2 hoặc Authelia.',
    description: 'NGINX gửi một subrequest ngầm tới endpoint xác thực trước khi cho phép truy cập tài nguyên bảo mật.',
    iconName: 'KeyRound',
    directivesExample: `location /private/ {
    auth_request /auth-verify;
}
location = /auth-verify {
    proxy_pass http://auth_service/verify;
    proxy_pass_request_body off;
}`,
    isDynamic: false,
  },
  {
    id: 'modsecurity',
    name: 'ModSecurity / OWASP Core Rule Set',
    packageName: 'ngx_http_modsecurity_module',
    aliases: ['modsecurity', 'ngx_http_modsecurity_module'],
    category: 'security',
    version: '3.0.12',
    author: 'Trustwave / OWASP',
    summary: 'Engine WAF chữ ký truyền thống tương thích với bộ quy tắc phòng thủ OWASP CRS.',
    description: 'Hỗ trợ phân tích cú pháp regex sâu cho các payload HTTP phức tạp, kiểm tra SQLi, XSS, Command Injection dựa trên signature database.',
    iconName: 'ShieldCheck',
    directivesExample: `modsecurity on;
modsecurity_rules_file /etc/nginx/modsec/main.conf;`,
    isDynamic: true,
  },

  // --- OBSERVABILITY & TRAFFIC ---
  {
    id: 'vts',
    name: 'Virtual Host Traffic Status (VTS)',
    packageName: 'ngx_http_vhost_traffic_status_module',
    aliases: ['vts', 'ngx_http_vhost_traffic_status_module'],
    category: 'observability',
    version: '0.2.1',
    author: 'vozlt',
    summary: 'Thu thập số liệu đo lường chi tiết băng thông, request, mã lỗi HTTP theo từng Domain.',
    description: 'Cung cấp endpoint JSON/Prometheus chi tiết về lưu lượng truy cập, 2xx/3xx/4xx/5xx responses cho từng virtual host theo thời gian thực.',
    iconName: 'BarChart3',
    directivesExample: `vhost_traffic_status_zone;
location /status {
    vhost_traffic_status_display;
    vhost_traffic_status_display_format prometheus;
}`,
    isDynamic: true,
  },
  {
    id: 'http_stub_status_module',
    name: 'Stub Status (Basic Metrics)',
    packageName: 'ngx_http_stub_status_module',
    aliases: ['http_stub_status_module', 'stub_status'],
    category: 'observability',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Cung cấp trang trạng thái căn bản về số kết nối active, số request đã phục vụ.',
    description: 'Endpoint siêu nhẹ phục vụ Prometheus NGINX Exporter hoặc Datadog Agent đọc metrics trạng thái kết nối worker.',
    iconName: 'Activity',
    directivesExample: `location = /nginx_status {
    stub_status;
    allow 127.0.0.1;
    deny all;
}`,
    isDynamic: false,
  },
  {
    id: 'opentelemetry',
    name: 'OpenTelemetry Distributed Tracing',
    packageName: 'ngx_http_opentelemetry_module',
    aliases: ['opentelemetry', 'otel', 'ngx_http_opentelemetry_module', 'ngx_otel_module'],
    category: 'observability',
    version: '0.1.0',
    author: 'NGINX / CNCF',
    summary: 'Distributed tracing chuẩn OTLP — tự động tạo Trace ID, Span và Context Propagation cho mọi request.',
    description: 'Tích hợp OpenTelemetry trực tiếp vào NGINX, tự động sinh trace/span cho mỗi request HTTP và truyền context (W3C Trace Context, B3) sang các upstream microservices. Xuất dữ liệu tracing qua gRPC/HTTP OTLP tới Jaeger, Zipkin, Tempo hoặc bất kỳ backend nào hỗ trợ OTLP.',
    iconName: 'Activity',
    directivesExample: `otel_exporter {
    endpoint localhost:4317;
}
otel_service_name "aurora-waf-nginx";
otel_trace on;

server {
    location / {
        otel_trace_context propagate;
        otel_span_name "\$request_method \$uri";
        proxy_pass http://backend;
    }
}`,
    isDynamic: true,
    docUrl: 'https://github.com/nginxinc/nginx-otel',
  },
  {
    id: 'http_log_module',
    name: 'Access Log (JSON / Conditional)',
    packageName: 'ngx_http_log_module',
    aliases: ['http_log_module', 'access_log', 'log'],
    category: 'observability',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Ghi log truy cập chi tiết với định dạng tùy biến JSON, hỗ trợ conditional logging và buffer.',
    description: 'Module logging cốt lõi của NGINX cho phép định nghĩa log format tùy biến (JSON structured logs), ghi log có điều kiện (chỉ log lỗi 4xx/5xx), buffer để tối ưu I/O, và gửi log qua syslog tới ELK/Loki/Fluentd.',
    iconName: 'FileText',
    directivesExample: `log_format json_combined escape=json
  '{'
    '"time":"\$time_iso8601",'
    '"remote_addr":"\$remote_addr",'
    '"request":"\$request",'
    '"status":\$status,'
    '"body_bytes_sent":\$body_bytes_sent,'
    '"request_time":\$request_time,'
    '"upstream_response_time":"\$upstream_response_time",'
    '"http_user_agent":"\$http_user_agent",'
    '"trace_id":"\$otel_trace_id"'
  '}';

access_log /var/log/nginx/access.json json_combined buffer=64k flush=5s;
access_log syslog:server=loki:1514,tag=nginx json_combined;`,
    isDynamic: false,
  },
  {
    id: 'http_mirror_module',
    name: 'Traffic Mirror (Shadow Testing)',
    packageName: 'ngx_http_mirror_module',
    aliases: ['http_mirror_module', 'mirror'],
    category: 'observability',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Nhân bản (mirror) 100% lưu lượng thật sang dịch vụ phân tích hoặc shadow environment.',
    description: 'Gửi bản sao của mọi request HTTP tới một endpoint phụ (shadow backend) mà không ảnh hưởng đến response trả về client. Lý tưởng cho việc kiểm thử phiên bản mới, phân tích traffic pattern, hoặc gửi dữ liệu sang hệ thống IDS/WAF thử nghiệm.',
    iconName: 'Share2',
    directivesExample: `location / {
    mirror /mirror_backend;
    mirror_request_body on;
    proxy_pass http://production_upstream;
}

location = /mirror_backend {
    internal;
    proxy_pass http://shadow_analysis_service\$request_uri;
}`,
    isDynamic: false,
  },
  {
    id: 'stream_log_module',
    name: 'Stream L4 Access Log',
    packageName: 'ngx_stream_log_module',
    aliases: ['stream_log_module', 'stream_log'],
    category: 'observability',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Ghi log kết nối TCP/UDP Layer 4 chi tiết cho Stream proxy — bytes, duration, upstream status.',
    description: 'Ghi nhật ký cho mọi kết nối TCP/UDP đi qua stream block: thời gian kết nối, số bytes truyền nhận, trạng thái upstream và thời gian phản hồi. Hỗ trợ cùng định dạng log tùy biến và syslog như HTTP log module.',
    iconName: 'Network',
    directivesExample: `stream {
    log_format stream_json escape=json
      '{'
        '"time":"\$time_iso8601",'
        '"remote_addr":"\$remote_addr",'
        '"protocol":"\$protocol",'
        '"status":\$status,'
        '"bytes_sent":\$bytes_sent,'
        '"bytes_received":\$bytes_received,'
        '"session_time":"\$session_time",'
        '"upstream_addr":"\$upstream_addr"'
      '}';

    access_log /var/log/nginx/stream.json stream_json;
}`,
    isDynamic: false,
  },
  {
    id: 'njs',
    name: 'NGINX JavaScript (njs) Telemetry',
    packageName: 'ngx_http_js_module',
    aliases: ['njs', 'ngx_http_js_module', 'js_module', 'http_js_module'],
    category: 'observability',
    version: '0.8.9',
    author: 'NGINX / F5',
    summary: 'Scripting engine JavaScript ES6 cho NGINX — custom metrics, JWT decode, request enrichment.',
    description: 'Thực thi mã JavaScript (ECMAScript 5.1+/ES6) trực tiếp bên trong NGINX để xử lý logic telemetry phức tạp: tính toán custom metrics, decode JWT token để ghi vào log, enrichment request headers với thông tin trace, hoặc tạo dynamic routing dựa trên nội dung request.',
    iconName: 'Code2',
    directivesExample: `js_import telemetry from /etc/nginx/njs/telemetry.js;

server {
    location / {
        # Gắn request_id và timing vào header
        js_set \$request_id telemetry.generateRequestId;
        js_header_filter telemetry.addTimingHeaders;

        add_header X-Request-ID \$request_id;
        proxy_pass http://backend;
    }

    location /metrics/custom {
        js_content telemetry.exportCustomMetrics;
    }
}`,
    isDynamic: true,
    docUrl: 'https://nginx.org/en/docs/njs/',
  },
  {
    id: 'prometheus_exporter',
    name: 'Prometheus NGINX Exporter',
    packageName: 'nginx-prometheus-exporter',
    aliases: ['prometheus', 'prometheus_exporter', 'nginx_exporter'],
    category: 'observability',
    version: '1.4.1',
    author: 'NGINX / F5',
    summary: 'Xuất toàn bộ metrics NGINX ra định dạng Prometheus — tích hợp Grafana dashboard sẵn.',
    description: 'Sidecar exporter đọc dữ liệu từ stub_status hoặc NGINX Plus API và chuyển đổi sang Prometheus exposition format. Tích hợp sẵn với Grafana dashboard cộng đồng để giám sát connections, requests/sec, response codes và upstream health.',
    iconName: 'BarChart3',
    directivesExample: `# 1. Bật stub_status endpoint cho exporter đọc
location = /nginx_status {
    stub_status;
    allow 127.0.0.1;
    deny all;
}

# 2. Chạy exporter sidecar (docker/systemd)
# nginx-prometheus-exporter \\
#   -nginx.scrape-uri=http://127.0.0.1/nginx_status \\
#   -web.listen-address=:9113

# 3. Prometheus scrape config
# scrape_configs:
#   - job_name: nginx
#     static_configs:
#       - targets: ['node-01:9113']`,
    isDynamic: true,
    docUrl: 'https://github.com/nginxinc/nginx-prometheus-exporter',
  },
  {
    id: 'upstream_hc',
    name: 'Upstream Active Health Check',
    packageName: 'ngx_http_upstream_hc_module',
    aliases: ['upstream_hc', 'health_check', 'ngx_http_upstream_hc_module'],
    category: 'observability',
    version: 'NGINX Plus / OSS Patch',
    author: 'NGINX Core',
    summary: 'Kiểm tra sức khỏe backend chủ động (Active Probe) — tự động loại bỏ upstream lỗi khỏi pool.',
    description: 'Gửi request kiểm tra sức khỏe định kỳ đến từng upstream backend, tự động đánh dấu server down/up và loại bỏ khỏi load balancing pool. Trong NGINX OSS, sử dụng passive health check qua max_fails và fail_timeout.',
    iconName: 'Activity',
    directivesExample: `upstream backend {
    zone backend_zone 64k;
    server 10.0.0.1:8080 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8080 max_fails=3 fail_timeout=30s;

    # Passive health check (NGINX OSS)
    # Server bị đánh dấu down sau 3 lần thất bại
    # và sẽ được thử lại sau 30 giây
}

# Active health check (NGINX Plus hoặc bản patch)
# location / {
#     proxy_pass http://backend;
#     health_check interval=5s fails=3 passes=2;
#     health_check_timeout 3s;
# }`,
    isDynamic: false,
    docUrl: 'https://nginx.org/en/docs/http/ngx_http_upstream_hc_module.html',
  },

  // --- ROUTING & STREAM (LAYER 4) ---
  {
    id: 'stream_core',
    name: 'Stream TCP/UDP Reverse Proxy (L4)',
    packageName: 'ngx_stream_core_module',
    aliases: ['stream', 'stream_core', 'ngx_stream_module'],
    category: 'routing',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Cân bằng tải và định tuyến tầng 4 (Layer 4) cho kết nối TCP thô và UDP.',
    description: 'Chuyển tiếp và cân bằng tải hiệu năng cao cho cơ sở dữ liệu MySQL, PostgreSQL, Redis, DNS hoặc các dịch vụ game server qua TCP/UDP.',
    iconName: 'Network',
    directivesExample: `stream {
    upstream backend_db {
        server 10.0.0.1:5432 weight=5;
        server 10.0.0.2:5432 max_fails=3;
    }
    server {
        listen 5432;
        proxy_pass backend_db;
    }
}`,
    isDynamic: false,
  },
  {
    id: 'stream_ssl_preread_module',
    name: 'Stream SSL Preread (SNI Routing)',
    packageName: 'ngx_stream_ssl_preread_module',
    aliases: ['stream_ssl_preread_module', 'ssl_preread'],
    category: 'routing',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Đọc SNI (Server Name Indication) trong gói tin TLS ClientHello mà không cần giải mã chứng chỉ.',
    description: 'Cho phép định tuyến lưu lượng HTTPS sang các cụm backend khác nhau chỉ dựa vào tên miền SNI mà không cần cấp quyền giải mã chứng chỉ SSL trên WAF Edge.',
    iconName: 'Network',
    directivesExample: `stream {
    map $ssl_preread_server_name $name {
        backend.local    10.0.0.10:443;
        internal.local   10.0.0.11:443;
    }
    server {
        listen 443;
        ssl_preread on;
        proxy_pass $name;
    }
}`,
    isDynamic: false,
  },

  // --- UTILITIES & MEDIA ---
  {
    id: 'lua',
    name: 'OpenResty Lua Scripting Engine',
    packageName: 'ngx_http_lua_module',
    aliases: ['lua', 'ngx_http_lua_module'],
    category: 'utilities',
    version: '0.10.26',
    author: 'OpenResty',
    summary: 'Thực thi mã script Lua non-blocking thời gian thực bên trong tiến trình NGINX.',
    description: 'Mở rộng khả năng xử lý request tùy biến linh hoạt: tích hợp microservices, tạo token JWT, xử lý logic bảo mật phức tạp ở tốc độ C.',
    iconName: 'Code2',
    directivesExample: `location /lua-test {
    content_by_lua_block {
        ngx.say("Hello from Lua inside NGINX!")
    }
}`,
    isDynamic: true,
  },
  {
    id: 'echo',
    name: 'Echo / Mock & Subrequest Helper',
    packageName: 'ngx_http_echo_module',
    aliases: ['echo', 'ngx_http_echo_module'],
    category: 'utilities',
    version: '0.63',
    author: 'OpenResty',
    summary: 'Tạo mock API responses, sleep, dispatch subrequest kiểm thử và debug cấu hình NGINX.',
    description: 'Cung cấp các công cụ mạnh mẽ để kiểm thử cấu hình phân luồng, gỡ lỗi ruleset WAF và giả lập API responses trực tiếp.',
    iconName: 'Code2',
    directivesExample: `location /health-echo {
    echo "Aurora WAF Cluster Online";
}`,
    isDynamic: true,
  },
  {
    id: 'http_sub_module',
    name: 'Sub Filter (Response Content Rewriter)',
    packageName: 'ngx_http_sub_module',
    aliases: ['http_sub_module', 'sub'],
    category: 'utilities',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Tìm và thay thế chuỗi văn bản trong response HTML/JSON trước khi gửi tới người dùng.',
    description: 'Sửa đổi nội dung web on-the-fly, ví dụ thay thế URL http:// thành https:// hoặc chèn script theo dõi mà không cần can thiệp code ứng dụng.',
    iconName: 'FileText',
    directivesExample: `sub_filter 'http://example.com' 'https://example.com';
sub_filter_once off;
sub_filter_types text/html text/css;`,
    isDynamic: false,
  },
  {
    id: 'http_mp4_module',
    name: 'MP4 / H.264 Video Streaming',
    packageName: 'ngx_http_mp4_module',
    aliases: ['http_mp4_module', 'mp4'],
    category: 'utilities',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Hỗ trợ phát video MP4 dạng pseudo-streaming với thanh tua thời gian (start parameter).',
    description: 'Cho phép người xem tua video trực tiếp đến bất kỳ giây nào trong video mà không cần tải toàn bộ file về máy.',
    iconName: 'FileVideo',
    directivesExample: `location /videos/ {
    mp4;
    mp4_buffer_size 1m;
    mp4_max_buffer_size 5m;
}`,
    isDynamic: false,
  },
  {
    id: 'http_dav_module',
    name: 'WebDAV Protocol (File Management)',
    packageName: 'ngx_http_dav_module',
    aliases: ['http_dav_module', 'dav'],
    category: 'utilities',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Hỗ trợ các phương thức HTTP mở rộng: PUT, DELETE, MKCOL, COPY, MOVE.',
    description: 'Biến NGINX thành một máy chủ lưu trữ tệp tin từ xa hỗ trợ giao thức WebDAV chuẩn doanh nghiệp.',
    iconName: 'FolderTree',
    directivesExample: `location /webdav/ {
    dav_methods PUT DELETE MKCOL COPY MOVE;
    create_full_put_path on;
    dav_access user:rw group:rw all:r;
}`,
    isDynamic: false,
  },
  {
    id: 'fancyindex',
    name: 'Fancy Index / HTML5 Directory Browsing',
    packageName: 'ngx_http_fancyindex_module',
    aliases: ['fancyindex', 'ngx_http_fancyindex_module'],
    category: 'utilities',
    version: '0.5.2',
    author: 'aperezdc',
    summary: 'Giao diện duyệt thư mục web hiện đại, đẹp mắt thay thế NGINX autoindex mặc định.',
    description: 'Hỗ trợ sắp xếp tên file, dung lượng, ngày sửa đổi, giao diện HTML5 chuẩn với theme responsive và thanh tìm kiếm file.',
    iconName: 'FolderTree',
    directivesExample: `fancyindex on;
fancyindex_exact_size off;
fancyindex_header "/theme/header.html";`,
    isDynamic: true,
  },
];
