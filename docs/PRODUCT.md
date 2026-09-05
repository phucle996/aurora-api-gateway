# Phạm vi sản phẩm

Người dùng đích: đội vận hành self-host NGINX cần policy HTTP cục bộ, có thể quản
lý bằng file/CLI trước khi cần console tập trung.

## MVP đích

- Một node Linux/NGINX, nhiều virtual host, policy selection xác định.
- Match method, URI/query, header, CIDR và body được hỗ trợ với resource limits.
- Actions allow/block, detection-only, anomaly scoring và rule exclusions.
- Snapshot offline, validation trước activation, reload và rollback.
- Security events đã redact, health và counters hoạt động không cần UI.

MVP engine/adaptor ở Stage 2. Managed alpha bổ sung Go controller/agent ở Stage 3;
React workflows ở Stage 4. Production candidate chỉ sau gate Stage 5.

## Không thuộc MVP

JS challenge/CAPTCHA, ML bot detection, managed IP reputation/GeoIP feeds,
distributed global rate limit, response inspection, HTTP/3, Envoy adapter,
standalone proxy, full CRS compatibility và HA controller. WebSocket chỉ inspect
handshake ở giai đoạn đầu; frame sau upgrade và gRPC message streaming ngoài scope.

## Tiêu chí giá trị

Chạy được khi controller/UI dừng, cài core độc lập, giải thích được rule nào match,
có rollback policy, đo được chi phí xử lý và false positive trước khi bật block.
Không quảng bá “ultra-fast”, tỷ lệ phát hiện hoặc throughput khi chưa có phép đo.

