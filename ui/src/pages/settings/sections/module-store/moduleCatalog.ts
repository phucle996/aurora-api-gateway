export type ModuleCategory = 'all' | 'performance' | 'security' | 'observability' | 'utilities';

export interface CatalogModule {
  id: string;
  name: string;
  packageName: string;
  category: 'performance' | 'security' | 'observability' | 'utilities';
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
  {
    id: 'brotli',
    name: 'Google Brotli Compression',
    packageName: 'ngx_brotli',
    category: 'performance',
    version: '1.0.0',
    author: 'Google',
    summary: 'Thuật toán nén thế hệ mới, tiết kiệm 20-30% băng thông so với Gzip.',
    description: 'Nén dữ liệu tĩnh và động (HTML, CSS, JS, SVG, JSON) với tỷ lệ nén vượt trội, giúp tăng tốc độ tải trang đáng kể cho người dùng cuối.',
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
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Bộ nén tiêu chuẩn tương thích 100% với tất cả trình duyệt và thiết bị.',
    description: 'Nén HTTP payloads bằng thuật toán Deflate, tối ưu tốc độ truyền tải trên toàn mạng Internet.',
    iconName: 'Minimize2',
    directivesExample: `gzip on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json;`,
    isDynamic: false,
  },
  {
    id: 'http2_upstream',
    name: 'HTTP/2 Upstream Proxy',
    packageName: 'ngx_http_v2_module',
    category: 'performance',
    version: 'Built-in',
    author: 'NGINX Core',
    summary: 'Ghép kênh đa luồng (Multiplexing) và nén tiêu đề HPACK cho kết nối Upstream.',
    description: 'Tối ưu hóa độ trễ kết nối từ WAF đến backend microservices qua giao thức HTTP/2 nhị phân.',
    iconName: 'Radio',
    directivesExample: `proxy_http_version 2;
proxy_pass http://backend_pool;`,
    isDynamic: false,
  },
  {
    id: 'geoip2',
    name: 'MaxMind GeoIP2 / Geo-Blocking',
    packageName: 'ngx_http_geoip2_module',
    category: 'security',
    version: '3.4',
    author: 'leev (MaxMind)',
    summary: 'Phân tích địa lý IP, chặn hoặc giới hạn truy cập theo quốc gia/thành phố.',
    description: 'Tích hợp cơ sở dữ liệu MaxMind GeoLite2/GeoIP2 để lọc truy cập từ các khu vực địa lý có rủi ro tấn công cao.',
    iconName: 'Globe',
    directivesExample: `geoip2 /var/lib/GeoIP/GeoLite2-Country.mmdb {
    $geoip2_data_country_code default=XX country iso_code;
}`,
    isDynamic: true,
  },
  {
    id: 'headers_more',
    name: 'Headers More / Security Obfuscation',
    packageName: 'ngx_http_headers_more_filter_module',
    category: 'security',
    version: '0.34',
    author: 'OpenResty',
    summary: 'Ẩn danh phiên bản NGINX và tinh chỉnh linh hoạt Request/Response Headers.',
    description: 'Loại bỏ hoàn toàn header Server: nginx, chống việc tin tặc quét lỗi theo phiên bản và bổ sung các header bảo mật HTTP Security Headers.',
    iconName: 'ShieldCheck',
    directivesExample: `more_clear_headers Server;
more_set_headers "X-Security-Protection: Aurora-WAF";`,
    isDynamic: true,
  },
  {
    id: 'vts',
    name: 'Virtual Host Traffic Status (VTS)',
    packageName: 'ngx_http_vhost_traffic_status_module',
    category: 'observability',
    version: '0.2.1',
    author: 'vozlt',
    summary: 'Thu thập số liệu đo lường chi tiết băng thông, request, mã lỗi HTTP theo từng Domain.',
    description: 'Cung cấp endpoint JSON/Prometheus chi tiết về lưu lượng truy cập, 2xx/3xx/4xx/5xx responses cho từng virtual host.',
    iconName: 'BarChart3',
    directivesExample: `vhost_traffic_status_zone;
location /status {
    vhost_traffic_status_display;
    vhost_traffic_status_display_format prometheus;
}`,
    isDynamic: true,
  },
  {
    id: 'zstd',
    name: 'Zstandard (zstd) Compression',
    packageName: 'ngx_http_zstd_module',
    category: 'performance',
    version: '0.1.1',
    author: 'Meta (Facebook)',
    summary: 'Thuật toán nén siêu tốc thời gian thực cho APIs và dynamic payloads.',
    description: 'Tốc độ nén cực nhanh với tỷ lệ nén gần bằng Brotli, rất phù hợp cho các luồng dữ liệu JSON/RPC tốc độ cao.',
    iconName: 'Cpu',
    directivesExample: `zstd on;
zstd_comp_level 3;`,
    isDynamic: true,
  },
  {
    id: 'fancyindex',
    name: 'Fancy Index / Directory Browsing',
    packageName: 'ngx_http_fancyindex_module',
    category: 'utilities',
    version: '0.5.2',
    author: 'aperezdc',
    summary: 'Giao diện duyệt file hiện đại, trực quan thay thế NGINX autoindex mặc định.',
    description: 'Hỗ trợ sắp xếp tên file, dung lượng, ngày sửa đổi, giao diện HTML5 chuẩn với theme responsive.',
    iconName: 'FolderTree',
    directivesExample: `fancyindex on;
fancyindex_exact_size off;`,
    isDynamic: true,
  },
  {
    id: 'echo',
    name: 'Echo / Fast Mock & Non-blocking I/O',
    packageName: 'ngx_http_echo_module',
    category: 'utilities',
    version: '0.63',
    author: 'OpenResty',
    summary: 'Hỗ trợ tạo mock API responses, sleep, dispatch subrequest kiểm thử WAF.',
    description: 'Cung cấp các công cụ mạnh mẽ để kiểm thử cấu hình phân luồng, gỡ lỗi ruleset WAF và giả lập API responses.',
    iconName: 'Code2',
    directivesExample: `location /health-echo {
    echo "Aurora WAF Cluster Online";
}`,
    isDynamic: true,
  },
];
