# Kiến Trúc Codebase Aurora API Gateway & WAF (Ma Trận Hệ Thống)

Tài liệu này là **Single Source of Truth (SSOT)** về ranh giới thẩm quyền (authority boundaries), luồng thực thi và ma trận ánh xạ giữa **Object (Mô hình dữ liệu / Khế ước / Snapshot)** và **Behavior (Hành vi / Chuyển dịch trạng thái / Invariants)** xuyên suốt toàn bộ hệ sinh thái Aurora WAF.

---

## 1. Bản Đồ Luồng Tổng Thể (System Architecture Flow)

```mermaid
flowchart TD
    subgraph UI ["Console Frontend"]
        Browser["Admin / SecOps Console"]
    end

    subgraph ControlPlane ["Control Plane"]
        direction TB
        EntryStep["Entry"] --> InitStep["Init (Config, DB Pools, Migrations)"]
        InitStep --> CompStep["Composition (Module, Route Wiring, gRPC Server)"]
        CompStep --> ExecStep["Process Path (Handler -> Service -> Repository)"]
        CompStep --> WorkerStep["Background Providers (Spec, Catalog, Backup, Alerts)"]
        ExecStep --> Storage[("Durable WAL Storage")]
        WorkerStep --> Storage
    end

    subgraph DataplaneNode ["Data Plane Node"]
        direction TB
        AgentDaemon["Dataplane Agent"]
        AgentDaemon -->|gRPC Bi-directional Stream| ReconcileLoop["Spec Reconciler & Jitter"]
        ReconcileLoop -->|Materialize Conf| StaticConf["Static NGINX Configurations"]
        ReconcileLoop -->|Dynamic Dispatch| Runners["Dynamic Extension Runners"]
        
        subgraph WorkerEngine ["NGINX Worker Engine"]
            HttpPipeline["HTTP Pipeline Hook"]
            CModule["C Module Adapter"]
            RustFFI["FFI Safety Layer"]
            CoreEngine["WAF Vectorized Matching Engine"]
            
            HttpPipeline --> CModule
            CModule --> RustFFI
            RustFFI --> CoreEngine
        end
        
        Runners -.->|Telemetry Scrape| HttpPipeline
    end

    Browser -->|HTTP REST / SPA| CompStep
    AgentDaemon -->|gRPC Stream :9090| CompStep
```

---

## 2. Control Plane: Ma Trận Vòng Đời Khởi Tạo (Lifecycle Path Matrix)

Mô hình khởi động và chuyển tiếp trạng thái của bộ điều khiển Control Plane:

| Pha Vòng Đời | Object / Context Sở Hữu | Behavior / Nhiệm Vụ Cốt Lõi | Ranh Giới Thẩm Quyền & Invariants |
| :--- | :--- | :--- | :--- |
| **1. Entry** | `AppContext`<br>`OSSignalChannel` | - Tiếp nhận tín hiệu hệ điều hành (`SIGINT`, `SIGTERM`).<br>- Khởi tạo context hủy đồng bộ để đóng toàn bộ subsystem một cách an toàn. | Điểm khởi đầu duy nhất; đảm bảo graceful termination không làm gián đoạn transaction đang commit. |
| **2. Init** | `SystemConfig`<br>`SQLiteWriterPool`<br>`SQLiteReaderPool`<br>`MigrationPlan` | - Đọc và kiểm chuẩn các biến cấu hình hệ thống.<br>- Phân tách ranh giới lưu trữ: **1 Connection Writer độc quyền** (chống xung đột WAL write-lock) và **N Connections Reader đồng thời**.<br>- Thực thi chuỗi migration tự động theo thứ tự nghiêm ngặt: Tables $\to$ Indexes $\to$ Triggers $\to$ Seeds. | Source of Truth của trạng thái bền vững; đảm bảo DB integrity trước khi bất kỳ port nào mở đón traffic. |
| **3. Composition** | `ModuleContainer`<br>`HTTPRouter`<br>`GRPCServer`<br>`ProviderRegistry` | - Wire toàn bộ quan hệ phụ thuộc: Repository $\to$ Service $\to$ Handler.<br>- Gắn các middleware bảo mật: Bearer Auth, CORS, Strict Security Headers, SPA Fallback Handler.<br>- Mở socket gRPC Stream phục vụ Data Plane spec replication.<br>- Đăng ký và kích hoạt các Background Worker Providers. | Vùng composition gốc; tuyệt đối không để rò rỉ Business Logic vào tầng liên kết phụ thuộc. |
| **4. Process Path** | `RequestContext`<br>`CommandDTO`<br>`ResultProjection` | - Thực thi nghiệp vụ theo luồng đơn hướng: `Handler` (Transport/Validation) $\rightarrow$ `Service` (Business Rules/Invariants) $\rightarrow$ `Repository` (CTE-First SQL Query). | Workflow Isolation: Mỗi nghiệp vụ có DTO, Service Port và Repository Port riêng biệt; không dùng chung Entity chéo. |

---

## 3. Control Plane: Ma Trận Nghiệp Vụ (Object $\leftrightarrow$ Behavior Matrix)

| Phân Vùng Nghiệp Vụ | Core Objects (Entities / DTOs / Payloads) | Behaviors (Hành Vi & Chức Năng Cốt Lõi) | Authority Boundary, Durable State & Invariants |
| :--- | :--- | :--- | :--- |
| **Spec & Cluster State** | `ClusterSpecRecord`<br>`ClusterSpecSnapshot`<br>`SpecReleaseCommand`<br>`SpecReleaseDigest` | - `GetHeadSpec()`: Đọc snapshot cấu hình đang kích hoạt.<br>- `GenerateSpecSnapshot()`: Biên dịch toàn bộ trạng thái DB thành 1 file YAML hợp nhất.<br>- `PublishRelease()`: Sinh băm SHA-256 digest và ghi sổ cái bất biến.<br>- `RollbackSpec()`: Kích hoạt phiên bản snapshot lịch sử đã kiểm chứng. | **Bảng `cluster_spec_releases` & `cluster_spec_head`**.<br>Invariants: Mọi bản phát hành là bất biến (immutable) qua Database Triggers. Cấm update/delete release đã sinh. |
| **gRPC Node Spec Stream** | `WatchSpecRequest`<br>`SpecReleaseChunk`<br>`NodeHeartbeat`<br>`StreamAck` | - `WatchSpec()`: Mở luồng Server-Streaming gRPC đẩy spec mới tới Edge Nodes.<br>- `Heartbeat()`: Ghi nhận nhịp tim, phiên bản và telemetry từ agent.<br>- `AcknowledgeRelease()`: Xác nhận node đã biên dịch và nạp cấu hình thành công. | **Bảng `cluster_nodes`**.<br>Invariants: Phát hiện drift trạng thái nếu `observed_release_id` lệch với `head_release_id`. |
| **Extensions Catalog** | `ExtensionItem`<br>`ExtensionRule`<br>`ExtensionConfigUpdate`<br>`CatalogSchema` | - `ListExtensions()`: Lấy danh mục 115+ plugins.<br>- `UpdateConfig()`: Cập nhật JSON cấu hình và rules tùy biến theo từng extension.<br>- `ToggleStatus()`: Bật / Tắt tức thì plugin.<br>- `TriggerSpecReconciliation()`: Phát tín hiệu biên dịch spec mới khi cấu hình extension đổi. | **Bảng `extensions`**.<br>Invariants: Config JSON phải thỏa mãn json_valid constraint và tương thích với dynamic runners của Agent. |
| **Domains & TLS** | `DomainRecord`<br>`CreateDomainCommand`<br>`UpdateDomainCommand`<br>`DomainBinding` | - `CreateDomain()`, `UpdateDomain()`, `DeleteDomain()`.<br>- `ValidateDomainBinding()`: Kiểm tra upstream đích có tồn tại hợp lệ hay không.<br>- `EnforceTLSProfile()`: Cấu hình min_tls_version, HSTS, OCSP stapling. | **Bảng `domains`**.<br>Invariants: Tên miền là duy nhất (`UNIQUE(domain)`). Không cho phép domain trỏ tới upstream rỗng. |
| **Upstreams Topology** | `UpstreamRecord`<br>`UpstreamServer`<br>`HealthCheckPolicy`<br>`UpstreamRelease` | - `CreateUpstream()`, `UpdateUpstream()`.<br>- `CompileUpstreamTopology()`: Tính toán danh sách backend servers, weights và thuật toán load balancing (`round_robin`, `ip_hash`, `least_conn`).<br>- `RecordNodeSync()`: Theo dõi pha nạp upstream của node. | **Bảng `upstreams`, `upstream_releases`, `upstream_node_sync`**.<br>Invariants: Không xóa upstream đang được một hoặc nhiều domain kích hoạt tham chiếu tới. |
| **WAF Rules Core** | `RuleItem`<br>`RuleRevision`<br>`CreateRuleCommand`<br>`RuleDefinition` | - `CreateRule()`, `UpdateRule()`: Tạo quy tắc và snapshot version bất biến.<br>- `CompileRuleset()`: Gọi binary compiler sinh snapshot nhị phân WAF.<br>- `FreezeRevision()`: Đóng băng revision của quy tắc khi phát hành ruleset. | **Bảng `rules`, `rule_revisions`, `ruleset_releases`, `rule_definitions`**.<br>Invariants: Revisions có tính append-only, có trigger chặn sửa đổi/xóa lịch sử. |
| **Access Control (IP/CIDR)** | `AccessObject`<br>`AccessRevision`<br>`AccessRelease`<br>`AccessMatchEvent` | - `ApplyChanges()`: Thêm/sửa/xóa quy tắc CIDR/ASN dạng flat entity.<br>- `Desired()`: Cung cấp snapshot access rule cho node.<br>- `RecordViolation()`: Ghi nhận sự kiện chặn IP vi phạm theo node_id. | **Bảng `access_objects`, `access_revisions`, `access_releases`, `access_events`**.<br>Invariants: Kiểm tra tính hợp lệ của dải CIDR trước khi commit transaction. |
| **Cluster Nodes** | `ClusterNodeRecord`<br>`NodeHeartbeatPayload`<br>`NodeDirective` | - `RegisterNode()`: Tự động đăng ký node mới khi nhận heartbeat hợp lệ.<br>- `TriggerReload()`: Đưa lệnh reload vào hàng đợi rolling reload.<br>- `DrainNode()`: Đánh dấu trạng thái Draining để chuyển hướng traffic. | **Bảng `cluster_nodes`, `node_sync_logs`**.<br>Invariants: Node không gửi nhịp tim quá 60 giây sẽ tự động chuyển trạng thái `Not Ready`. |
| **Analytics Explorer** | `AnalyticsQuery`<br>`MetricSeries`<br>`TimeSeriesPoint`<br>`NodeMetricsSnapshot` | - `QueryMetrics()`: Phân giải số liệu thống kê.<br>- `IngestNodeMetrics()`: Lưu trữ CPU, RAM, active connections, RPS định kỳ.<br>- `RouteTelemetryBackend()`: Chuyển đổi linh hoạt giữa SQLite Rollup và Prometheus API. | **Bảng `node_metrics_history` kết hợp Prometheus Server**.<br>Invariants: Không làm nghẽn luồng xử lý chính khi hệ thống telemetry bên ngoài quá tải. |
| **Security & Auth** | `UserRecord`<br>`AuthProviderItem`<br>`LoginCommand`<br>`TOTPValidation` | - `Authenticate()`: Kiểm tra mật khẩu mã hóa Argon2id.<br>- `VerifyTwoFactor()`: Xác thực mã 6 chữ số TOTP RFC 6238.<br>- `ConfigureProvider()`: Bật/tắt OIDC SSO, LDAP, SAML. | **Bảng `users`, `auth_providers`, `system_settings`**.<br>Invariants: Tài khoản admin không được phép xóa; mật khẩu lưu trữ kèm muối (salt) ngẫu nhiên. |
| **Notifications & Alerts** | `NotificationChannel`<br>`NotificationRule`<br>`AlertMessage`<br>`DispatchQueue` | - `EnqueueAlert()`: Đẩy thông báo sự cố vào hàng đợi bất đồng bộ.<br>- `TestChannel()`: Kiểm tra độ sống của Webhook, Telegram, Slack, Discord, Email.<br>- `FormatPayload()`: Định dạng payload theo cú pháp riêng của từng kênh. | **Bảng `notification_channels`, `notification_rules`**.<br>Invariants: Hàng đợi cảnh báo giới hạn kích thước (bounded buffer) tránh tràn bộ nhớ khi mạng nghẽn. |
| **Backup & Disaster Recovery** | `BackupSettings`<br>`BackupHistoryRecord`<br>`BackupArchive` | - `CreateBackup()`: Khóa snapshot SQLite an toàn và nén archive.<br>- `UploadToS3()`: Đẩy tệp sao lưu sang S3/MinIO bucket.<br>- `RestoreBackup()`: Khôi phục toàn diện database từ snapshot đã lưu. | **Bảng `backup_settings`, `backup_history`**.<br>Invariants: Tự động dọn dẹp các bản backup cũ vượt quá thời hạn retention quy định. |

---

## 4. Control Plane: Ma Trận Background Providers & Workers

| Provider Worker | Quản Lý Trạng Thái (State Object) | Chu Kỳ / Sự Kiện Kích Hoạt | Behavior & Trách Nhiệm Vận Hành |
| :--- | :--- | :--- | :--- |
| **SpecScheduler** | `SpecReconciliationState`<br>`TriggerChannel` | - Chu kỳ định kỳ (10 giây).<br>- Hoặc kích hoạt ngay tức thì khi có mutation từ API. | Quét DB, tổng hợp toàn bộ Spec, băm SHA-256; nếu digest khác biệt thì tạo release mới và notify tới toàn bộ kênh gRPC streams. |
| **CatalogProvider** | `DynamicExtensionRegistry`<br>`JSONSchemaValidator` | Khởi chạy hệ thống lúc bootstrap. | Tải danh mục 115+ plugins, đối chiếu schema JSON cấu hình mặc định, đồng bộ vào bảng lưu trữ extensions. |
| **AnalyticsProvider** | `TelemetryStrategyContext`<br>`PrometheusClient` | Mỗi khi nhận yêu cầu truy vấn metrics. | Điều phối nguồn dữ liệu: truy vấn trực tiếp từ bảng rollup lịch sử hoặc gửi PromQL ngược dòng sang máy chủ Prometheus. |
| **BackupScheduler** | `CronScheduleContext`<br>`StorageTarget` | Theo lịch biểu Cron (mặc định: `0 2 * * *`). | Chụp snapshot database dạng Online Backup không khóa bảng đọc, nén và đẩy lên kho lưu trữ cục bộ hoặc cloud S3. |
| **NotificationWorker** | `AlertDispatcherQueue`<br>`RetryBackoffPolicy` | Bất đồng bộ liên tục qua Channel buffer (256 slots). | Rút thông điệp cảnh báo từ hàng đợi, phân phối theo các kênh kích hoạt tương ứng, xử lý retry với exponential backoff. |

---

## 5. Rust Dataplane Agent: Ma Trận Phân Vùng Kiến Trúc

| Phân Vùng | Core Objects & Structs | Behaviors & State Transitions | Invariants & Nguyên Tắc Bảo Vệ |
| :--- | :--- | :--- | :--- |
| **Bootstrap & Config** | `AgentRuntimeContext`<br>`AgentCliFlags` | - `bootstrap()`: Đọc tham số `--controller-url`, `--node-id`, `--auth-token`.<br>- `ensure_environment()`: Tạo các thư mục cấu hình và tệp upstreams rỗng ban đầu.<br>- `spawn_workers()`: Khởi động song song Spec Sync, Heartbeat và Telemetry tasks. | Ngăn chặn khởi động nếu thiếu token xác thực hoặc không phân giải được địa chỉ Controller. |
| **gRPC Spec Sync** | `GrpcStreamClient`<br>`SpecReleaseWatcher`<br>`SpecStreamChunk` | - `connect_stream()`: Thiết lập kênh kết nối gRPC hai chiều với Controller.<br>- `receive_spec()`: Nhận dữ liệu stream spec YAML.<br>- `verify_digest()`: Đối chiếu SHA-256 digest của spec nhận được với release hiện hành. | Giữ kết nối persistent; tự động kết nối lại (reconnect loop) khi mạng ngắt quãng. |
| **Reconciler & Jitter** | `ReconcileEngine`<br>`JitterTimer` | - `evaluate_diff()`: So sánh cấu hình cũ và mới.<br>- `apply_jitter()`: **Chờ ngẫu nhiên từ 0 đến 2500ms** trước khi áp dụng cấu hình xuống NGINX.<br>- `report_status()`: Phản hồi trạng thái nạp spec về Controller qua gRPC. | **Chống Thundering Herd**: Triệt tiêu hiện tượng toàn bộ cluster reload NGINX đồng thời làm sụt áp origin. |
| **Materializer** | `NginxManager`<br>`MaterializePlan`<br>`UpstreamConf`<br>`RoutingConf` | - `materialize()`: Chuyển hóa AST của Spec thành cấu hình NGINX tĩnh.<br>- `validate()`: Thực thi lệnh `nginx -t` kiểm tra cú pháp.<br>- `hot_reload()`: Thực thi `nginx -s reload` nạp cấu hình không rớt TCP sessions.<br>- `rollback()`: Phục hồi cấu hình cũ nếu `nginx -t` trả về lỗi. | **Zero-Downtime Guarantee**: Nếu file cấu hình mới sinh lỗi cú pháp, NGINX giữ nguyên tiến trình cũ, không reload. |
| **Heartbeat Worker** | `HeartbeatTask`<br>`NodeTelemetryReport` | - `collect_host_metrics()`: Thu thập mức sử dụng CPU, RAM và active connections.<br>- `send_heartbeat()`: Gửi nhịp tim kèm release ID đang nạp tới Controller mỗi 10s.<br>- `handle_command()`: Tiếp nhận và thực thi các chỉ thị cưỡng chế (reload, drain). | Đảm bảo Controller luôn nắm bắt chính xác trạng thái thực thi của từng edge node. |
| **Extension Dispatcher**| `ExtensionDispatcher`<br>`DynamicRunnerMap`<br>`ExtensionSpecValue` | - `apply_spec()`: Duyệt qua danh sách dynamic extensions trong Spec.<br>- `start_runner()`: Khởi chạy worker task cho các extension được bật (Bot challenge, distributed rate limiter).<br>- `stop_runner()`: Hủy bỏ worker task khi extension bị vô hiệu hóa trong Spec. | Cho phép bật/tắt logic extension động trong bộ nhớ Agent mà không cần khởi động lại tiến trình daemon. |
| **Telemetry Exporters** | `MetricsCollector`<br>`PrometheusPullServer`<br>`OtlpPushClient` | - `scrape_stub_status()`: Đọc số liệu từ NGINX internal stub status.<br>- `serve_prometheus()`: Cung cấp HTTP endpoint `:9145/metrics` chuẩn Prometheus format.<br>- `push_otlp()`: Đẩy traces/metrics sang OpenTelemetry collector theo chu kỳ. | Không tạo overhead vượt quá 1% CPU của node; phục vụ số liệu không khóa luồng chính. |

---

## 6. WAF Engine & NGINX FFI: Ma Trận Thực Thi Gói Tin

| Thành Phần | Data Buffers & Memory Models | Behaviors & Thuật Toán Xử Lý | Ranh Giới Bộ Nhớ & Thực Thi |
| :--- | :--- | :--- | :--- |
| **WAF Engine Core** | `CompiledRuleset`<br>`AhoCorasickAutomaton`<br>`HyperscanDatabase`<br>`RuleMatchResult` | - `build_automaton()`: Xây dựng máy trạng thái hữu hạn Aho-Corasick cho hàng nghìn chuỗi mẫu.<br>- `match_payload()`: Quét đồng thời các thành phần HTTP (URI, Headers, Query, Body).<br>- `evaluate_score()`: Tổng hợp điểm số bất thường (anomaly scoring) để đưa ra hành vi (Allow, Log, Block). | Thực thi hoàn toàn trong RAM; tốc độ tính toán vector hóa đạt hàng trăm nghìn requests/giây trên 1 core. |
| **Rule Compiler** | `RulesetManifest`<br>`BinarySnapshotImage` | - `parse_manifest()`: Đọc quy tắc WAF dạng JSON/YAML từ Controller.<br>- `compile_binary()`: Biên dịch toàn bộ quy tắc thành snapshot nhị phân bất biến tối ưu cache L1/L2 của CPU. | Chạy ngoại tuyến (offline tool) tại Controller; Data Plane chỉ nạp snapshot đã biên dịch, không tốn tài nguyên compile. |
| **CIDR Radix Engine** | `RadixTree`<br>`IpLookupTable`<br>`GeoAsnCatalog` | - `insert_subnet()`: Nạp dải IP CIDR và ASN vào cây Radix Tree.<br>- `lookup_ip()`: Kiểm tra IP nguồn client trong thời gian $O(1)$.<br>- `evaluate_geo()`: Đối chiếu mã quốc gia IP của request. | Tối ưu hóa bộ nhớ; kiểm tra địa chỉ IPv4/IPv6 với độ trễ nano-giây. |
| **Rust FFI Export Layer** | `CApiRequestContext`<br>`CApiMatchVerdict`<br>`HotSwapHandle` | - `aurora_match_request()`: C ABI nhận con trỏ request từ NGINX và trả về kết quả phán quyết.<br>- `aurora_hot_swap_policy()`: Thay thế con trỏ snapshot chính sách trong shared memory mà không cần restart worker.<br>- `aurora_free_result()`: Giải phóng bộ nhớ veridct sau khi NGINX xử lý xong. | Panic-safe wrapper: Mọi lỗi unhandled bên Rust được bắt tại biên giới FFI, không làm crash tiến trình worker NGINX. |
| **NGINX C Module Hook** | `ngx_http_aurora_waf_ctx_t`<br>`ngx_http_aurora_loc_conf_t`<br>`ngx_shm_zone_t` | - `ngx_http_aurora_waf_handler()`: Hook vào pha `NGX_HTTP_ACCESS_PHASE` của NGINX HTTP pipeline.<br>- `extract_request_meta()`: Đọc URI, method, headers, client IP từ `ngx_http_request_t`.<br>- `enforce_decision()`: Chặn gói tin (`NGX_HTTP_FORBIDDEN`), chuyển tiếp (`NGX_DECLINED`) hoặc phản hồi tùy biến. | Tích hợp trực tiếp vào Event Loop của NGINX; không chặn (non-blocking) các worker threads khác. |

---

## 7. Frontend Console: Ma Trận Màn Hình & Trạng Thái UI

| Màn Hình / Không Gian Làm Việc | UI State Objects & Models | User Behaviors & Khả Năng Tương Tác | Backend API Contracts Tương Ứng |
| :--- | :--- | :--- | :--- |
| **Dashboard Tổng Quan** | `ClusterHealthOverview`<br>`RealtimeTrafficSeries`<br>`RecentViolationEvent` | - Xem tổng quan throughput (RPS), tỷ lệ chặn WAF, số node Online.<br>- Lọc biểu đồ lưu lượng theo khung thời gian (1h, 24h, 7d). | `GET /api/v1/analytics/timeline`<br>`GET /api/v1/nodes` |
| **Extensions Workspace** | `ExtensionCatalog`<br>`ExtensionDraftConfig`<br>`RuleTableItems`<br>`DrawerState` | - Click trực tiếp vào thẻ hoặc dòng bảng để **mở Bottom Drawer cao 78vh**.<br>- Chuyển đổi nhanh trạng thái Bật/Tắt extension từ Header Drawer.<br>- Xem bảng dữ liệu quy tắc chuyên biệt theo từng extension.<br>- **Thêm quy tắc qua Modal 2 Mode**: Form UI trực quan $\leftrightarrow$ Trình soạn thảo JSON Raw với đồng bộ tự động 2 chiều. | `GET /api/v1/extensions`<br>`PUT /api/v1/extensions/:id/status`<br>`PUT /api/v1/extensions/:id/config` |
| **Quy Tắc WAF** | `RuleRecordList`<br>`RuleFilterCriteria`<br>`RuleDraftDefinition` | - Phân loại theo nhóm (SQLi, XSS, Path Traversal, Bot, Auth).<br>- Tùy chỉnh score, priority và action (Allow, Log, Block).<br>- Xem lịch sử revision đã phát hành. | `GET /api/v1/rules`<br>`POST /api/v1/rules`<br>`PUT /api/v1/rules/:id` |
| **Tên Miền & Chứng Chỉ** | `DomainGridList`<br>`CertAutoRenewState`<br>`UpstreamBindingSelection` | - Khai báo Host domain, kích hoạt Let's Encrypt / Custom SSL.<br>- Cấu hình HSTS, OCSP stapling, Min TLS 1.3.<br>- Liên kết domain với Upstream tương ứng. | `GET /api/v1/domains`<br>`POST /api/v1/domains`<br>`PUT /api/v1/domains/:id` |
| **Cụm Upstreams** | `UpstreamTopology`<br>`BackendServerItem`<br>`HealthProbeSetting` | - Khai báo danh sách backend IP:Port và trọng số tải (weight).<br>- Chọn thuật toán Round Robin, Least Connections hoặc IP Hash.<br>- Cài đặt Active Synthetic Health Check (`/healthz`). | `GET /api/v1/upstreams`<br>`POST /api/v1/upstreams`<br>`PUT /api/v1/upstreams/:id` |
| **Quản Trị Edge Nodes** | `NodeStatusList`<br>`NodeDriftState`<br>`ReloadQueueProgress` | - Giám sát nhịp tim, phiên bản và tình trạng đồng bộ spec (`In Sync` / `Drift`).<br>- Phát lệnh Rolling Reload NGINX có kiểm soát.<br>- Đưa node vào chế độ Draining phục vụ bảo trì. | `GET /api/v1/nodes`<br>`POST /api/v1/nodes/:id/reload`<br>`POST /api/v1/nodes/:id/drain` |
| **Kiểm Soát IP / CIDR** | `AccessListGrid`<br>`CidrAddDraft`<br>`GeoBlockSelection` | - Quản lý Whitelist / Blacklist theo IP, dải Subnet CIDR hoặc Quốc gia.<br>- Xem bảng tổng hợp vi phạm và số lần bị chặn thời gian thực. | `GET /api/v1/access/catalog`<br>`POST /api/v1/access/changes` |
| **Analytics Explorer** | `MetricQueryBuilder`<br>`LatencyDistribution`<br>`ThroughputBreakdown` | - Phân tích p50, p90, p99 latency theo endpoint và mã phản hồi HTTP.<br>- Lọc số liệu đa chiều theo node_id hoặc quy tắc kích hoạt. | `POST /api/v1/analytics/query` |
| **Cài Đặt & Phục Hồi (DR)** | `SecurityCredential`<br>`TelemetryModeToggle`<br>`BackupScheduleForm` | - Đổi mật khẩu admin, kích hoạt 2FA Authenticator TOTP.<br>- Chuyển đổi linh hoạt chế độ Telemetry (`standalone` $\leftrightarrow$ `prometheus`).<br>- Tạo snapshot backup tức thời và tải archive về máy hoặc đẩy lên S3. | `GET /api/v1/settings/*`<br>`GET /api/v1/backups`<br>`POST /api/v1/backups` |

---

## 8. Nguyên Tắc Bất Biến Của Kiến Trúc (Architecture Invariants)

1. **Workflow Isolation**: Mọi mutation và query phải thuộc về đúng 1 workflow sở hữu. Không tái sử dụng projection/entity của workflow khác làm đầu vào.
2. **CTE-First Persistence**: Mọi tác vụ truy vấn và cập nhật dữ liệu đa trạng thái trong Repository phải ưu tiên Common Table Expressions (CTE) trong 1 câu SQL duy nhất để đảm bảo tính nguyên tử (atomic) và truy vết được.
3. **Immutable Ledgers**: Các bảng release (`cluster_spec_releases`, `ruleset_releases`, `policy_cluster_releases`) được bảo vệ bằng trigger không cho phép update/delete sau khi ghi.
4. **Non-Blocking Data Plane**: Mọi thao tác kiểm tra an ninh WAF và phân tán spec trên Data Plane đều diễn ra non-blocking, không bao giờ làm nghẽn Event Loop NGINX hoặc gây sụt giảm băng thông.
