# Cấu Trúc Xây Dựng Codebase (Codebase Assembly & Architecture)

Tài liệu này mô tả chi tiết **cách thức tổ chức, khởi dựng và vận hành cấu trúc** của từng hệ thống con trong codebase Aurora WAF & API Gateway dưới dạng ma trận **Object (Thực thể / Khung dữ liệu) $\leftrightarrow$ Behavior (Hành vi / Xử lý)**, không phụ thuộc vào chi tiết nghiệp vụ cục bộ.

---

## 1. Controller Subsystem: Ma Trận Khởi Dựng & Luồng Xử Lý

Mô tả cách bộ điều khiển trung tâm được ráp nối từ lúc khởi động cho tới khi tiếp nhận và chuyển giao dữ liệu:

| Pha / Tầng Khởi Dựng | Object (Cấu Trúc / Khung Dữ Liệu) | Behavior (Hành Vi Xây Dựng & Xử Lý) | Vai Trò & Ranh Giới Lắp Ráp |
| :--- | :--- | :--- | :--- |
| **Pha 1: Entry** | `ApplicationContext`<br>`SignalTrap` | - Bắt tín hiệu ngắt OS (`SIGINT`, `SIGTERM`).<br>- Khởi tạo root context điều phối toàn bộ vòng đời shutdown. | Cửa ngõ duy nhất; kiểm soát bật/tắt toàn bộ tiến trình điều khiển. |
| **Pha 2: Init** | `EnvironmentConfig`<br>`ReadWritePool`<br>`SchemaMigrator` | - Phân giải biến môi trường và thiết lập giá trị mặc định.<br>- Tách biệt kết nối DB: 1 writer độc quyền + N readers song song.<br>- Chạy migration theo thứ tự: Bảng $\to$ Chỉ mục $\to$ Triggers $\to$ Hạt giống. | Thiết lập hạ tầng lưu trữ bền vững trước khi tiếp nhận request. |
| **Pha 3: Composition** | `ServiceRegistry`<br>`RouteTable`<br>`StreamServer` | - Đóng gói các lớp đối tượng theo nguyên tắc Dependency Injection.<br>- Đăng ký chuỗi Middleware: Auth Token, CORS, Headers, SPA Fallback.<br>- Mở socket gRPC lắng nghe kết nối từ các node Data Plane. | Ráp nối phụ thuộc; không chứa logic xử lý trực tiếp. |
| **Pha 4: Process Path - Handler** | `TransportRequest`<br>`TransportResponse`<br>`ValidationSchema` | - Giải mã dữ liệu đầu vào từ giao thức HTTP/gRPC.<br>- Kiểm tra tính hợp lệ của payload (Validation).<br>- Chuyển đổi payload thành Command phẳng gửi xuống Service. | Chuyển đổi giao thức; không chứa business invariants. |
| **Pha 4: Process Path - Service** | `WorkflowCommand`<br>`ExecutionResult`<br>`ErrorTaxonomy` | - Kiểm tra quy tắc nghiệp vụ và các điều kiện tiên quyết.<br>- Đảm bảo tính nhất quán của trạng thái trước và sau khi thực thi.<br>- Xử lý băm dữ liệu, digest SHA-256 hoặc gọi compiler khi cần. | Trọng tâm nghiệp vụ; điều phối luồng thực thi khép kín cho từng workflow. |
| **Pha 4: Process Path - Repo** | `SQLQueryStatement`<br>`ProjectionEntity`<br>`TransactionHandle` | - Biểu diễn các câu truy vấn phức tạp bằng Common Table Expressions (CTE).<br>- Đọc và ghi dữ liệu có tính nguyên tử trong cùng một transaction.<br>- Ánh xạ kết quả truy vấn thành các flat projections độc lập. | Tương tác lưu trữ; mỗi query chỉ phục vụ duy nhất một workflow sở hữu. |
| **Khối Providers** | `BackgroundWorker`<br>`StateReconciler`<br>`EventQueue` | - Chạy các tác vụ nền định kỳ hoặc hướng sự kiện (Event-driven).<br>- Tự động kích hoạt biên dịch snapshot khi có thay đổi trạng thái.<br>- Quản lý hàng đợi xử lý bất đồng bộ không làm nghẽn luồng chính. | Vận hành ngầm; tự động hóa việc đồng bộ và bảo dưỡng hệ thống. |

---

## 2. Dataplane Agent: Ma Trận Khởi Dựng Tiến Trình Biên (Edge Agent)

Mô tả cách thức daemon biên tiếp nhận cấu hình từ xa và hiện thực hóa xuống máy chủ HTTP:

| Phân Vùng Kiến Trúc | Object (Khung Dữ Liệu & Trạng Thái) | Behavior (Hành Vi Xây Dựng & Xử Lý) | Quy Tắc Vận Hành & Bảo Vệ |
| :--- | :--- | :--- | :--- |
| **Bootstrap & Lifecycle** | `RuntimeBootstrap`<br>`AgentParameters` | - Đọc tham số dòng lệnh và biến môi trường của node.<br>- Khởi tạo môi trường thư mục tạm và tệp cấu hình mặc định.<br>- Khởi tạo luồng runtime bất đồng bộ quản lý các worker. | Kiểm tra tính sẵn sàng của môi trường trước khi kết nối mạng. |
| **gRPC Consumer** | `StreamChannel`<br>`InboundChunk`<br>`DigestVerifier` | - Mở luồng nhận dữ liệu liên tục (streaming) với Controller.<br>- Tiếp nhận snapshot cấu hình phân tán dạng nhị phân/YAML.<br>- Kiểm tra tính toàn vẹn thông qua băm SHA-256. | Duy trì kết nối sống; tự động kết nối lại khi mất liên lạc. |
| **Reconciler & Jitter** | `DifferentialEngine`<br>`RandomJitterPolicy` | - So sánh sự khác biệt giữa cấu hình hiện hành và cấu hình mới.<br>- **Áp dụng Jitter (độ trễ ngẫu nhiên)** trước khi thực thi cập nhật.<br>- Báo cáo trạng thái hoàn tất trở lại Controller. | **Chống Thundering Herd**: Tránh việc toàn bộ cluster reload đồng loạt. |
| **Materializer** | `ConfigSynthesizer`<br>`FileManifest`<br>`ProcessSupervisor` | - Biên dịch cây cấu hình logic thành các tệp cấu hình tĩnh.<br>- Kiểm tra tính đúng đắn của cú pháp cấu hình (`syntax check`).<br>- Ra lệnh nạp lại cấu hình mượt mà (`graceful reload`).<br>- Tự động khôi phục cấu hình trước đó nếu kiểm tra thất bại. | **Zero-Downtime**: Giữ nguyên tiến trình cũ nếu cấu hình mới có lỗi. |
| **Extension Dispatcher** | `RunnerRegistry`<br>`DynamicTaskHandle` | - Bóc tách các tham số mở rộng được khai báo trong cấu hình.<br>- Khởi động hoặc dừng các background runner tương ứng theo thời gian thực.<br>- Cập nhật tham số hoạt động của module trong bộ nhớ RAM. | Quản lý vòng đời plugin động mà không cần khởi động lại daemon. |
| **Telemetry Pipeline** | `MetricsAggregator`<br>`PullEndpoint`<br>`PushClient` | - Thu thập số liệu hoạt động nội tại của máy chủ HTTP.<br>- Định dạng và công khai số liệu qua endpoint chuẩn scrape.<br>- Đẩy chỉ số và vết giám sát sang hệ thống thu thập tập trung. | Đo lường hiệu năng với overhead tiêu thụ tài nguyên tối thiểu. |

---

## 3. Engine & FFI: Ma Trận Xử Lý Gói Tin Thời Gian Thực

Mô tả cách thức động cơ an ninh lõi và lớp giao tiếp FFI can thiệp vào luồng xử lý HTTP:

| Tầng Xử Lý | Object (Bộ Đệm & Cấu Trúc Bộ Nhớ) | Behavior (Thuật Toán & Hành Vi Xử Lý) | Ranh Giới Bộ Nhớ & Luồng |
| :--- | :--- | :--- | :--- |
| **Offline Compiler** | `RulesetSource`<br>`BinarySnapshotImage` | - Nhận khai báo quy tắc dạng cấu trúc văn bản.<br>- Biên dịch thành biểu diễn nhị phân bất biến đã tối ưu hóa bộ nhớ.<br>- Đóng gói cây dữ liệu tra cứu tĩnh. | Chạy tại Controller; Data Plane chỉ nạp snapshot đã đóng gói sẵn. |
| **Vectorized Engine** | `AutomatonMachine`<br>`InspectionContext`<br>`VerdictDecision` | - So khớp đa mẫu đồng thời bằng thuật toán Aho-Corasick & Hyperscan.<br>- Quét sâu các thành phần: URI, Headers, Body, Query Params.<br>- Tính toán điểm số bất thường và đưa ra quyết định xử lý. | Thực thi trong RAM với tốc độ hàng trăm nghìn request/giây trên 1 core. |
| **Memory Radix Table** | `SubnetRadixTree`<br>`FastLookupIndex` | - Lưu trữ các dải địa chỉ mạng phân tầng.<br>- Tra cứu địa chỉ nguồn trong thời gian hằng số $O(1)$. | Cấu trúc dữ liệu tối ưu cache CPU cho bài toán lọc IP/CIDR tốc độ cao. |
| **C ABI Safety Layer** | `CCompatibleEnvelope`<br>`PanicBoundary` | - Định nghĩa giao diện hàm C tương thích (`extern "C"`).<br>- Chuyển đổi con trỏ dữ liệu giữa bộ nhớ C và Rust an toàn.<br>- Bắt toàn bộ ngoại lệ runtime (Panic Catcher) không làm sập tiến trình gọi. | Đảm bảo an toàn bộ nhớ tuyệt đối tại ranh giới đa ngôn ngữ. |
| **Module Phase Hooks** | `HTTPPhaseHook`<br>`SharedMemoryContext` | - Can thiệp vào pha kiểm tra truy cập (Access Phase) của HTTP pipeline.<br>- Trích xuất thông tin ngữ cảnh của request đang đến.<br>- Áp dụng phán quyết: Cho qua, chặn đứng mã lỗi, hoặc trả phản hồi tùy biến. | Chạy trực tiếp trong Event Loop chính của máy chủ web; non-blocking. |

---

## 4. Console UI: Ma Trận Lắp Ráp Giao Diện Quản Trị

Mô tả cách ứng dụng giao diện được tổ chức thành các lớp vỏ bọc và không gian tương tác:

| Lớp Giao Diện | Object (Mô Hình Trạng Thái UI) | Behavior (Hành Vi Tương Tác & Lắp Ráp) | Chuẩn Thiết Kế & Trải Nghiệm |
| :--- | :--- | :--- | :--- |
| **Vỏ Ứng Dụng (App Shell)**| `ThemeProvider`<br>`AuthTokenStore`<br>`GlobalErrorBoundary` | - Quản lý token phiên làm việc và xác thực người dùng.<br>- Cung cấp theme tối/sáng và trạng thái kết nối máy chủ.<br>- Bắt lỗi giao diện tổng thể tránh sập màn hình. | Nền tảng ứng dụng; duy trì phiên làm việc nhất quán. |
| **Khung Điều Hướng (Layout)**| `NavigationTree`<br>`RouteOutlet`<br>`HeaderBar` | - Điều hướng trang thông qua hệ thống Router SPA.<br>- Hiển thị trạng thái hoạt động nhanh của cụm máy chủ.<br>- Phân phối layout theo dạng bảng dữ liệu hoặc không gian làm việc. | Khung hiển thị chính; tải trang tức thời không reload trình duyệt. |
| **Không Gian Workspace** | `DrawerContainer`<br>`DualModeForm`<br>`ReactiveDataGrid` | - Hiển thị không gian làm việc mở rộng dạng **Bottom Drawer chiếm 3/4 chiều cao (78vh)**.<br>- Bảng dữ liệu đặc thù tự động tinh chỉnh theo từng loại module.<br>- **Soạn thảo quy tắc 2 Mode**: Giao diện nhập trực quan (UI Mode) $\leftrightarrow$ Trình soạn thảo thô (JSON Mode) với cơ chế đồng bộ 2 chiều. | Trải nghiệm thao tác chuyên sâu; loại bỏ các form popup đơn điệu. |
| **Tầng Giao Tiếp API** | `TypedHTTPClient`<br>`ResponseEnvelope`<br>`CachePolicy` | - Đóng gói các hàm gọi API tương ứng với từng màn hình.<br>- Chuyển đổi dữ liệu backend trả về thành các state cục bộ.<br>- Xử lý thông báo lỗi phản hồi và hiển thị toast/alert. | Giao tiếp thuần hướng dữ liệu; phân định rõ ràng giữa UI và Controller. |

---

## 5. Ma Trận Quy Tắc Bất Biến (Architecture Invariants Matrix)

| Nguyên Tắc Thiết Kế | Trọng Tâm Bắt Buộc | Lợi Ích Cốt Lõi | Rủi Ro Ngăn Ngừa |
| :--- | :--- | :--- | :--- |
| **Workflow Isolation** | Mỗi workflow sở hữu toàn bộ luồng từ Command $\to$ Service $\to$ Repo riêng biệt. | Tách biệt hoàn toàn blast radius khi sửa đổi code. | Không bị hiệu ứng phụ (side-effects) làm vỡ các workflow khác. |
| **CTE-First SQL** | Truy vấn nghiệp vụ đa bước phải thực hiện qua Common Table Expressions trong 1 câu SQL. | Đảm bảo tính nguyên tử (Atomicity) ở tầng DB. | Triệt tiêu xung đột dữ liệu ngầm và tranh chấp khóa transaction. |
| **Immutable Ledger** | Mọi bản phát hành cấu hình đều chỉ thêm mới (append-only), không chỉnh sửa lịch sử. | Khả năng truy vết, kiểm toán và rollback tức thì. | Mất dấu vết thay đổi hoặc không xác định được trạng thái cluster. |
| **Jittered Sync** | Các node biên phải delay ngẫu nhiên một khoảng ngắn trước khi reload NGINX. | Giữ ổn định cho hệ thống upstream origin. | Sập hệ thống đồng loạt do hiện tượng Thundering Herd. |
| **Non-blocking Plane** | Tuyệt đối không thực hiện tác vụ I/O đĩa cứng hay tính toán nặng trong request loop. | Đảm bảo độ trễ WAF ở mức micro-giây. | Giảm băng thông hoặc gây nghẽn Event Loop của máy chủ HTTP. |
