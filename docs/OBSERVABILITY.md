# Events và Metrics Telemetry — Aurora WAF

## 1. Hai chế độ vận hành Metrics Telemetry

Hệ thống hỗ trợ 2 chế độ thu thập metrics độc lập, chuyển đổi linh hoạt tại **Cài đặt > Tích hợp Hệ thống**:

### Chế độ 1: Standalone (Lab / Single Node / Local)
- NGINX Data Plane tự động chạy Background Telemetry Thread bên trong worker process.
- Đẩy trực tiếp gói binary Protobuf (~37-52 bytes) định kỳ về Control Plane: `POST /api/v1/nodes/:id/heartbeat`.
- Control Plane lưu vào In-Memory Ring Buffer (<1ms) cho Live UI và rollup vào SQLite `node_metrics_history` (TTL 7 ngày với pacing & jitter).

### Chế độ 2: External Prometheus / VictoriaMetrics (Production)
- **Zero-Dependency Exporter**: Không yêu cầu cài đặt thêm `nginx-prometheus-exporter` hay `node_exporter`.
- Module NGINX của Aurora WAF tự động phục vụ endpoint chuẩn OpenMetrics / Prometheus qua directive:

```nginx
server {
    listen 80;
    ...

    # Endpoint cung cấp metrics cho Prometheus server cào dữ liệu
    location = /metrics {
        aurora_waf_metrics;

        # Bảo mật: chỉ cho phép Prometheus server scrape
        allow 10.0.0.0/8;
        allow 127.0.0.1;
        deny all;
    }
}
```

- Các chỉ số cung cấp qua `GET /metrics`:
  - `aurora_waf_evaluations_total{action="allow|block|total",node_id="..."}` (Counter)
  - `aurora_node_cpu_percent{node_id="..."}` (Gauge)
  - `aurora_node_memory_percent{node_id="..."}` (Gauge)

- **Control Plane PromQL Query**:
  Khi ở chế độ `prometheus`, Control Plane truy vấn PromQL `/api/v1/query_range` tới Prometheus Server đã cấu hình để hiển thị Timeline trên Web UI Dashboard.

## 2. Cấu hình Prometheus Server (`prometheus.yml`)

```yaml
scrape_configs:
  - job_name: 'aurora-waf-nodes'
    metrics_path: '/metrics'
    scrape_interval: 15s
    static_configs:
      - targets:
          - '10.0.1.10:80' # Node NGINX 01
          - '10.0.1.11:80' # Node NGINX 02
```

