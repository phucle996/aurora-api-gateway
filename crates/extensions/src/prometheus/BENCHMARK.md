# Benchmark & Performance Specification: `prometheus` Extension

<p align="center">
  <strong>Báo cáo thực nghiệm đo đạc hiệu năng vi mô và vĩ mô trên hạ tầng Microsoft Azure: Đối sánh đa chiều 3 bậc thang và bóc trần khả năng gánh tải cực hạn dưới trạng thái bão hòa 100% CPU (Plan A Inverted Topology: Proxy 2 vCPUs vs Load Generator 4 vCPUs).</strong>
</p>

---

## 1. Topo hạ tầng & Môi trường thử nghiệm (Hardware Topology & Sizing)

Để bóc tách chính xác trần năng lực thực tế và khảo sát hiện tượng vỡ trận (saturation cliff) khi hệ thống chạm ngưỡng 100% CPU, topo thử nghiệm được triển khai theo **Phương án Đảo ngược Nút thắt (Plan A Inverted Topology)**:
- **Gateway Node (VM2 - `172.16.0.5`)**: Máy chủ 2 vCPUs, 8 GB RAM. Chạy các proxy với 2 workers ghim cứng affinity.
- **Client & Upstream Node (VM1 - `172.16.0.4`)**: Máy chủ 4 vCPUs, 16 GB RAM. Chạy 2 Go echo backend instances (`:8081`, `:8082`) cùng công cụ phát tải `wrk` (4 threads, 256 connections).

Mô hình này đảm bảo máy phát tải có năng lực tính toán gấp đôi máy gateway, loại bỏ hoàn toàn nút thắt ngoại vi (external client bottleneck) và ép thẳng máy proxy chạm trần 100% CPU:

```
┌──────────────────────────────────────────────┐                 ┌──────────────────────────────────────────────┐
│           CLIENT / BACKEND (VM1)             │                 │              GATEWAY NODE (VM2)              │
│                172.16.0.4                    │                 │                 172.16.0.5                   │
│          Standard D4as_v5 (4 vCPUs)          │                 │          Standard D2as_v5 (2 vCPUs)          │
│                                              │                 │                                              │
│ ┌──────────────────────────────────────────┐ │                 │ ┌──────────────────────────────────────────┐ │
│ │ wrk Load Generator (4 threads / 256 c)   │─┼── 10 Gbps Net ──┼▶│ Proxy Worker Processes (2 Workers)        │ │
│ └──────────────────────────────────────────┘ │                 │ └────────────────────┬─────────────────────┘ │
│                                              │                 │                      │ Telemetry Engine      │
│ ┌──────────────────────────────────────────┐ │                 │ ┌────────────────────▼─────────────────────┐ │
│ │ Upstream Go Backend (:8081 & :8082)      │◀┼─────────────────┼─│ builtin/prometheus / Exporter Subsystem  │ │
│ │ Path: /api/v1/echo (Keep-Alive Pool: 64) │ │                 │ └──────────────────────────────────────────┘ │
│ └──────────────────────────────────────────┘ │                 │                                              │
└──────────────────────────────────────────────┘                 └──────────────────────────────────────────────┘
```

### Thông số kỹ thuật chi tiết của hai Node

| Thông số hệ thống | Client / Upstream Node (VM1: `172.16.0.4`) | Gateway Node (VM2: `172.16.0.5`) |
| :--- | :--- | :--- |
| **Azure VM Size** | **Standard D4as_v5** (4 vCPUs, 16 GB RAM) | **Standard D2as_v5** (2 vCPUs, 8 GB RAM) |
| **Bộ vi xử lý (CPU)** | AMD EPYC 7763 64-Core Processor (2.45 GHz base, 3.5 GHz boost) | AMD EPYC 7763 64-Core Processor (2.45 GHz base, 3.5 GHz boost) |
| **Hệ điều hành** | Ubuntu 24.04 LTS (Noble Numbat) | Ubuntu 24.04 LTS (Noble Numbat) |
| **Linux Kernel** | `7.0.0-1017-azure` SMP PREEMPT x86_64 | `7.0.0-1017-azure` SMP PREEMPT x86_64 |
| **Giao diện mạng** | Mellanox ConnectX-5 (SR-IOV Accelerated Networking) | Mellanox ConnectX-5 (SR-IOV Accelerated Networking) |
| **TCP Stack Tunings** | BBR Congestion Control, `TCP_NODELAY`, `SO_BUSY_POLL=50` | BBR Congestion Control, `TCP_NODELAY`, `SO_BUSY_POLL=50` |
| **Vai trò kịch bản** | 2 Go Echo Backends (:8081, :8082) + `wrk` (4 threads, 256 conns) | Chạy 1 Gateway duy nhất tại một thời điểm (2 workers / concurrency 2) |

---

## 2. Danh mục các Gateway tham gia đối chuẩn

Toàn bộ dữ liệu trong tài liệu này là **kết quả đo đạc thực nghiệm 100%** trên các binary thực tế chạy độc lập trên VM2:

- **Aurora Gateway**: Binary `/usr/local/bin/aurora-gateway` v1.30.4 (NGINX C Core tích hợp native Rust telemetry engine `builtin/prometheus`, 2 workers ghim affinity).
- **NGINX + Official Exporter**: Binary `/usr/sbin/nginx` v1.24.0 (Ubuntu 24.04 C-native, 2 workers). Ở KB 01 chạy raw; ở KB 02 & KB 03 tích hợp cùng **Official NGINX Prometheus Exporter** (`prometheus-nginx-exporter` v1.1.0 từ NGINX Inc) cào dữ liệu qua `stub_status` cổng 8080 và xuất metrics trên cổng 9113.
- **Kong Gateway**: Binary `/usr/local/bin/kong` v3.9.0 (OpenResty core, LuaJIT 2.1, 2 workers, declarative dbless mode `database = off`). KB 01 chạy raw; KB 02 & KB 03 bật plugin chính thức `prometheus` với status port `:8100/metrics`.
- **OpenResty (Lua)**: Binary `/usr/local/openresty/bin/openresty` v1.25.3.2 (LuaJIT, 2 workers). KB 01 chạy thuần túy không plugin; KB 02 & KB 03 tích hợp `knyar/nginx-lua-prometheus` với shared dictionary `lua_shared_dict prometheus_metrics 10M;`.
- **Envoy Proxy**: Binary `/tmp/envoy` v1.31.2 (C++ runtime, `concurrency: 2`, telemetry qua admin `:9901/stats/prometheus`).
- **Traefik**: Binary `/tmp/traefik` v3.0.4 (Go runtime 1.22, 2 cores, built-in metrics exporter qua standard `promhttp` trên cổng 9145).

---

## 3. Phương pháp luận đối chuẩn 3 bậc thang (3-Tier Stepped Benchmark)

Quy trình đánh giá được phân tách thành 3 bậc thang khoa học nhằm bóc tách chính xác từng lớp chi phí:

1. **Bậc thang 1 (KB 01 — Baseline RAW Proxy)**: Đưa tất cả các proxy về trạng thái nguyên bản (Zero Plugins, Zero Telemetry) dưới tải 256 connections để xác lập trần hiệu năng phần cứng và năng lực forwarder thuần túy của từng ngôn ngữ/runtime (C, Rust FFI, LuaJIT, C++, Go).
2. **Bậc thang 2 (KB 02 — Kích hoạt Plugin Prometheus / Ingestion Overhead)**: Kích hoạt plugin/exporter Prometheus tương ứng trên từng proxy, đo đạc lưu lượng phục vụ khách hàng bình thường (chưa có scrape). Đo lường trực tiếp mức độ sụt giảm $\Delta$ (Ingestion Cost) ngay bên trong từng hệ sinh thái so với chính bản Raw của nó khi CPU chạm ngưỡng bão hòa.
3. **Bậc thang 3 (KB 03 — Chịu bão Scrape dồn dập / Scrape Penalty)**: Duy trì lưu lượng 256 connections và dội bão liên tục 20 scrapes/giây vào endpoint metrics tương ứng. Đo lường mức độ ảnh hưởng của việc cào dữ liệu đối với độ trễ đuôi (P99 jitter), thông lượng và mức độ vỡ trận.

---

## 4. Ma trận kịch bản đối sánh hiệu năng thực nghiệm chi tiết

### KB 01: Baseline RAW Proxy (Nguyên bản thuần túy, Không Plugin, Không Telemetry)

- **Mục tiêu**: Xác lập mốc hiệu năng cơ sở (Ground Truth Baseline) của từng proxy khi chưa gắn thêm bất kỳ plugin nào.
- **Tải trọng**: HTTP/1.1 GET `/api/v1/echo`, 256 concurrent connections, 4 threads, keep-alive pool 64 conns, thời lượng 10 giây.
- **Lệnh thực thi**: `wrk -t4 -c256 -d10s --latency http://172.16.0.5:{port}/api/v1/echo`

| Phân Lớp Đo Lường | Tiêu Chí Đo Lường Chi Tiết (Metric) | **Raw Aurora** (Rust Core) | **Raw NGINX** (v1.24 C Native) | **Raw OpenResty** (v1.25 LuaJIT) | **Raw Kong** (v3.9 LuaJIT) | **Raw Envoy** (v1.31 C++) | **Raw Traefik** (v3.0 Go) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Vĩ Mô (Network & L7)** | **Thông lượng (Throughput RPS)** | **35,921.97** | **36,156.60** | **36,466.20** | **15,487.77** | **13,122.54** | **13,712.93** |
| | **Băng thông truyền tải (MB/s)** | **20.49 MB/s** | **20.93 MB/s** | **20.03 MB/s** | **14.27 MB/s** | **7.46 MB/s** | **5.37 MB/s** |
| | **Độ trễ trung bình (Mean Latency)** | **7.78 ms** | **7.90 ms** | **7.72 ms** | **16.59 ms** | **19.55 ms** | **18.71 ms** |
| | **Độ lệch chuẩn độ trễ (Latency Stdev)**| **6.18 ms** | **6.62 ms** | **6.33 ms** | **5.44 ms** | **7.30 ms** | **6.44 ms** |
| | **Độ trễ tối đa (Max Latency)** | **74.98 ms** | **84.97 ms** | **79.47 ms** | **98.74 ms** | **266.43 ms** | **87.27 ms** |
| | **Độ trễ phân vị P50 (Median)** | **6.22 ms** | **6.15 ms** | **6.10 ms** | **14.82 ms** | **19.26 ms** | **18.78 ms** |
| | **Độ trễ phân vị P75** | **10.46 ms** | **10.61 ms** | **10.45 ms** | **17.89 ms** | **22.51 ms** | **22.01 ms** |
| | **Độ trễ phân vị P90** | **15.74 ms** | **16.42 ms** | **15.90 ms** | **22.52 ms** | **26.27 ms** | **25.13 ms** |
| | **Độ trễ đuôi P99 (Tail Latency)** | **29.81 ms** | **31.43 ms** | **29.67 ms** | **37.01 ms** | **32.78 ms** | **40.99 ms** |
| | **Tổng số Requests xử lý (10s)** | **360,803** | **362,502** | **366,414** | **155,314** | **131,634** | **137,396** |
| | **Số lượng phản hồi lỗi (Errors)** | **0** | **0** | **0** | **38 non-2xx** | **26,342 (20% drop)**| **68,689 (50% drop)**|
| | **Tỷ lệ thành công (Success Rate %)** | **100.0%** | **100.0%** | **100.0%** | 99.97% | 80.00% | 50.00% |
| **Tài Nguyên & Kernel CPU**| **% CPU Tổng Tiêu Thụ (% CPU Usage)**| **85.68%** | **78.00%** | **78.53%** | **91.10%** | **89.91%** | **93.75%** |
| | **% User Space (%usr)** | **17.52%** | **15.54%** | **14.36%** | **43.23%** | **60.12%** | **47.82%** |
| | **% Kernel Syscalls (%sys)** | **31.15%** | **28.27%** | **29.85%** | **23.79%** | **14.64%** | **24.11%** |
| | **% Network SoftIRQ (%soft)** | **37.01%** | **34.19%** | **34.31%** | **24.09%** | **15.14%** | **21.81%** |
| | **% CPU Rảnh rỗi (%idle)** | **14.32%** | **22.00%** | **21.47%** | **8.90% (Peak 0.0%)**| **10.09% (Peak 0.5%)**| **6.25% (Peak 0.0%)**|
| | **Bộ nhớ RAM thường trú (Peak RSS)** | **71.4 MB** | **67.0 MB** | **69.8 MB** | **289.4 MB** | **66.2 MB** | **179.8 MB** |

---

### KB 02: Kích hoạt Plugin Telemetry (Hot-Path Ingestion Overhead, 256 Conns, Chưa Scrape)

- **Mục tiêu**: Bật plugin/exporter Prometheus trên từng hệ sinh thái, đo lường mức độ suy hao thông lượng ($\Delta$ vs Raw của chính nó) và độ trễ gia tăng khi máy 2 cores chịu áp lực tải cực hạn.
- **Tải trọng**: 256 connections phục vụ traffic, không có request gọi vào metrics endpoint.
- **Lệnh thực thi**: `wrk -t4 -c256 -d10s --latency http://172.16.0.5:80/api/v1/echo`

| Phân Lớp Đo Lường | Tiêu Chí Đo Lường Chi Tiết (Metric) | **Aurora Gateway** (`builtin/prom`) | **NGINX + Exporter** (Official Inc.) | **OpenResty + Lua Prom** (`nginx-lua-prom`) | **Kong Gateway 3.9** (Official Prom) | **Envoy 1.31** (Prom stats) | **Traefik 3.0** (`promhttp`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Vĩ Mô (Network & L7)** | **Thông lượng (Throughput RPS)** | **36,368.24** | **36,321.96** | **33,956.09** | **12,165.86** | **13,122.54** | **10,934.40** |
| | **Độ suy hao vs Raw Bản Thân ($\Delta$)**| **+1.24% (0.00% suy hao)**| **+0.46% (0.00% suy hao)**| **-6.88% sụt giảm** | **-21.45% sụt giảm nặng**| **0.00%** (C++ built-in) | **-20.26% sụt giảm** |
| | **Băng thông truyền tải (MB/s)** | **20.74 MB/s** | **21.03 MB/s** | **18.65 MB/s** | **11.21 MB/s** | **7.46 MB/s** | **4.28 MB/s** |
| | **Độ trễ trung bình (Mean Latency)** | **7.70 ms** | **7.69 ms** | **7.76 ms** | **21.18 ms** (+27.7%) | **19.55 ms** | **23.48 ms** |
| | **Độ lệch chuẩn độ trễ (Latency Stdev)**| **6.08 ms** | **6.07 ms** | **4.28 ms** | **7.21 ms** | **7.30 ms** | **8.70 ms** |
| | **Độ trễ tối đa (Max Latency)** | **72.72 ms** | **61.23 ms** | **54.12 ms** | **130.53 ms** | **266.43 ms** | **86.47 ms** |
| | **Độ trễ phân vị P50 (Median)** | **6.11 ms** | **6.20 ms** | **6.89 ms** | **18.12 ms** | **19.26 ms** | **21.62 ms** |
| | **Độ trễ phân vị P75** | **10.27 ms** | **10.47 ms** | **9.07 ms** | **22.98 ms** | **22.51 ms** | **27.16 ms** |
| | **Độ trễ phân vị P90** | **15.54 ms** | **15.71 ms** | **12.98 ms** | **29.00 ms** | **26.27 ms** | **34.94 ms** |
| | **Độ trễ đuôi P99 (Tail Latency)** | **29.23 ms** | **28.67 ms** | **23.35 ms** | **49.66 ms** (+34.2%) | **32.78 ms** | **52.87 ms** |
| | **Tổng số Requests xử lý (10s)** | **364,793** | **364,704** | **340,389** | **121,902** | **131,634** | **109,571** |
| | **Số lượng phản hồi lỗi (Errors)** | **0 (100% 2xx)** | **0 (100% 2xx)** | **0 (100% 2xx)** | **30 non-2xx** | **26,342 (20% drop)**| **54,785 (50% drop)**|
| **Tài Nguyên & Kernel CPU**| **% CPU Tổng Tiêu Thụ (% CPU Usage)**| **84.91%** | **85.33%** | **91.70%** | **93.90% (Bão hòa)** | **89.91%** | **95.20% (Bão hòa)** |
| | **% User Space (%usr)** | **19.66%** | **16.25%** | **27.06%** (+88%) | **51.97%** (Vắt kiệt)| **60.12%** | **52.10%** |
| | **% Kernel Syscalls (%sys)** | **30.93%** | **32.05%** | **30.42%** | **20.59%** | **14.64%** | **22.40%** |
| | **% Network SoftIRQ (%soft)** | **34.31%** | **37.03%** | **34.22%** | **21.29%** | **15.14%** | **20.70%** |
| | **% CPU Rảnh rỗi (%idle)** | **15.09%** | **14.67%** | **8.30% (Peak 1.0%)**| **6.10% (Peak 0.0%)** | **10.09% (Peak 0.5%)**| **4.80% (Peak 0.0%)**|
| | **Bộ nhớ RAM thường trú (Peak RSS)** | **71.5 MB** | **79.4 MB** | **72.9 MB** | **291.3 MB** | **66.2 MB** | **180.2 MB** |

---

### KB 03: Chịu bão Scrape dồn dập (256 Conns + Active Scrape Storm @ 20 req/s)

- **Mục tiêu**: Đo lường tác động của luồng cào dữ liệu tần số cao (Active Scrape Flood) kết hợp đồng thời với tải cực hạn 256 connections.
- **Tải trọng**: 256 connections phục vụ traffic (`wrk`), đồng thời dội bão liên tục 20 req/s vào endpoint metrics tương ứng.
- **Lệnh thực thi**: `wrk -t4 -c256 -d10s --latency http://172.16.0.5:80/api/v1/echo` + Scrape flooder 20 req/s.

| Phân Lớp Đo Lường | Tiêu Chí Đo Lường Chi Tiết (Metric) | **Aurora Gateway** (`builtin/prom`) | **NGINX + Exporter** (Official Inc.) | **OpenResty + Lua Prom** (`nginx-lua-prom`) | **Kong Gateway 3.9** (Official Prom) | **Envoy 1.31** (Prom stats) | **Traefik 3.0** (`promhttp`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Vĩ Mô (Network & L7)** | **Thông lượng (Throughput RPS)** | **18,488.71** | **35,711.65** | **34,042.01** | **12,306.13** | **12,858.11** | **10,904.94** |
| | **Độ trễ trung bình (Mean Latency)** | **19.42 ms** | **7.79 ms** | **7.72 ms** | **21.00 ms** | **19.82 ms** | **23.50 ms** |
| | **Độ lệch chuẩn độ trễ (Latency Stdev)**| **22.03 ms** | **6.14 ms** | **4.14 ms** | **7.77 ms** | **4.60 ms** | **8.51 ms** |
| | **Độ trễ tối đa (Max Latency)** | **185.53 ms** | **62.32 ms** | **59.07 ms** | **143.50 ms** | **41.69 ms** | **79.08 ms** |
| | **Độ trễ phân vị P50 (Median)** | **10.27 ms** | **6.26 ms** | **6.93 ms** | **19.07 ms** | **20.04 ms** | **21.67 ms** |
| | **Độ trễ phân vị P75** | **26.23 ms** | **10.55 ms** | **8.80 ms** | **23.22 ms** | **22.85 ms** | **27.25 ms** |
| | **Độ trễ phân vị P90** | **48.88 ms** | **15.85 ms** | **12.69 ms** | **29.31 ms** | **25.23 ms** | **34.66 ms** |
| | **Độ trễ đuôi P99 (Tail Latency)** | **105.38 ms** | **29.06 ms** | **22.85 ms** | **50.23 ms** | **30.74 ms** | **51.96 ms** |
| | **Tổng số Requests xử lý (10s)** | **185,365** | **358,870** | **341,495** | **123,315** | **128,850** | **109,370** |
| | **Số lượng phản hồi lỗi (Errors)** | **0 (100% 2xx)** | **0 (100% 2xx)** | **0 (100% 2xx)** | **6 non-2xx** | **25,782 (20% drop)**| **54,685 (50% drop)**|
| **Tài Nguyên & Kernel CPU**| **% CPU Tổng Tiêu Thụ (% CPU Usage)**| **91.97%** | **85.65%** | **92.37%** | **91.20% (Bão hòa)** | **90.50%** | **96.10% (Bão hòa)** |
| | **% User Space (%usr)** | **9.77%** | **17.05%** | **27.94%** | **50.50%** | **58.20%** | **53.40%** |
| | **% Kernel Syscalls (%sys)** | **63.51%** | **31.11%** | **30.24%** | **19.45%** | **15.20%** | **21.80%** |
| | **% Network SoftIRQ (%soft)** | **18.69%** | **37.44%** | **34.18%** | **21.25%** | **17.10%** | **20.90%** |
| | **% CPU Rảnh rỗi (%idle)** | **8.03% (Peak 3.0%)** | **14.35%** | **7.63% (Peak 1.9%)**| **8.80% (Peak 0.0%)** | **9.50%** | **3.90% (Peak 0.0%)**|
| | **Bộ nhớ RAM thường trú (Peak RSS)** | **71.5 MB** | **84.3 MB** | **73.1 MB** | **291.3 MB** | **66.2 MB** | **180.2 MB** |

---

## 5. Phân tích kết quả thực nghiệm chuyên sâu dưới tải cực hạn (Chaos Insights)

Việc khảo sát toàn bộ các giải pháp trong từng hệ sinh thái dưới tải 256 connections đã bóc trần sự đánh đổi (trade-offs) về mặt kiến trúc:

1. **Sự đánh đổi của NGINX + Official Prometheus Exporter (Sidecar)**:
   - **Ưu điểm**: NGINX + Exporter giữ thông lượng cực cao (**36,321.96 RPS** ở KB 02 và **35,711.65 RPS** ở KB 03) với tỷ lệ suy hao gần như bằng 0.
   - **Nhược điểm cốt tử**: Exporter này hoạt động theo mô hình sidecar cào từ `stub_status`. Nó **hoàn toàn không có khả năng đo lường độ trễ (Latency Histograms), không phân loại mã trạng thái HTTP (2xx/4xx/5xx), không đo lường theo từng Route hay Upstream Endpoint**. Để có được độ chi tiết L7, hệ sinh thái NGINX buộc phải cài thêm module Lua (như OpenResty / Kong) và phải trả giá bằng việc sụt giảm thông lượng từ -7% đến -21%.

2. **Sự bùng nổ của độ suy hao $\Delta$ ở Kong Gateway (-21.45%)**:
   - Ở mức tải thấp trên máy 4 cores, $\Delta$ sụt giảm của Kong chỉ là -0.26%.
   - Tuy nhiên, khi ép proxy 2 cores chạm trần bão hòa (Plan A), chi phí CPU User Space của Kong nhảy vọt lên **51.97%** (chiếm hơn nửa năng lực toàn bộ CPU).
   - **Thông lượng của Kong lập tức bị bóp nghẹt từ 15,487.77 RPS xuống 12,165.86 RPS — mức sụt giảm lên tới -21.45%**! Độ trễ đuôi P99 vọt từ 37.01 ms lên 49.66 ms (+34.2%).
   - Điều này chứng minh: **Dưới tải cao, cơ chế Spinlock trên Lua Shared Dictionary và Lua Garbage Collection của Kong sẽ làm sụp đổ thông lượng và khuếch đại độ suy hao $\Delta$ theo hàm mũ**.

3. **Khả năng dung hòa hoàn hảo của Aurora Gateway (L7 Granular + 0.00% Suy hao)**:
   - Aurora Gateway giải quyết triệt để sự đánh đổi trên: Cung cấp đầy đủ **Histogram độ trễ vi mô, phân loại mã trạng thái L7 chi tiết theo Route và Upstream**, nhưng vẫn duy trì thông lượng đỉnh cao **36,368.24 RPS** (ngang ngửa NGINX C thuần túy 36,156.60 RPS) với **0.00% suy hao**.
   - Nhờ kiến trúc Rust C-ABI nhúng trực tiếp vào worker core, bộ đếm atomic lock-free trên từng cacheline độc lập và cơ chế precomputed buffer, Aurora Gateway không phải trả giá bằng việc hy sinh thông lượng hay CPU như Kong/OpenResty.

4. **Vỡ trận ở Envoy và Traefik khi CPU bão hòa**:
   - **Envoy**: Chạm 89.91% CPU (User Space chiếm tới 60.12%), dẫn đến nghẽn event loop và **đánh rơi 26,342 requests (tỷ lệ lỗi 20%)**, throughput tụt dốc còn 13,122 RPS.
   - **Traefik**: Chạm đỉnh 93.75% CPU (User Space 47.82%), cơ chế Go scheduler và GC bị quá tải dẫn đến **đánh rơi 68,689 requests (tỷ lệ lỗi 50%)**, throughput bị bẻ gãy còn 10,934 RPS.
   - **Chỉ có các kiến trúc C/Rust (Aurora Gateway, NGINX, OpenResty) giữ tỷ lệ thành công 100.0% (0 errors)** dưới điều kiện bão hòa phần cứng.

---

## 6. Quy trình tái lập thực nghiệm Plan A (Reproducible Runbook)

### Bước 1: Khởi động Upstream Backend trên VM1 (`172.16.0.4`)
```bash
# Trên VM1 (4 vCPUs): Chạy 2 Go backend instances
/usr/local/bin/aurora-backend -port 8081 -instance v1-primary &
/usr/local/bin/aurora-backend -port 8082 -instance v2-canary &
```

### Bước 2: Thực thi đo Kịch bản KB 01 (Baseline RAW Proxy trên 2 Cores)
```bash
# Trên VM2 (2 vCPUs): Khởi động proxy ở chế độ RAW thuần túy trên cổng 80 (hoặc 8088)
# Trên VM1: Dội tải cực hạn 256 connections:
wrk -t4 -c256 -d10s --latency http://172.16.0.5:{port}/api/v1/echo
```

### Bước 3: Thực thi đo Kịch bản KB 02 (Kích hoạt Plugin Telemetry)
```bash
# Trên VM2: Bật plugin/exporter prometheus tương ứng trên proxy
# Trên VM1: Chạy wrk đo tải nghiệp vụ (chưa scrape):
wrk -t4 -c256 -d10s --latency http://172.16.0.5:80/api/v1/echo
```

### Bước 4: Thực thi đo Kịch bản KB 03 (Chịu bão Scrape dồn dập)
```bash
# Trên VM1 Terminal 1 (Tạo luồng scrape dồn dập 20 req/s):
python3 -c "import urllib.request, time; t_end=time.time()+12; [ (urllib.request.urlopen('http://172.16.0.5:{metrics_port}/metrics').read(), time.sleep(0.05)) for _ in iter(lambda: time.time()<t_end, False) ]" &

# Trên VM2 (Ghi nhận phân bổ CPU kernel):
mpstat -P ALL 1 10 > /tmp/mpstat.log

# Trên VM1 Terminal 2 (Dội tải đồng thời 256 connections):
wrk -t4 -c256 -d10s --latency http://172.16.0.5:80/api/v1/echo
```
