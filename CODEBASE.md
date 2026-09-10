# Cấu Trúc Xây Dựng Codebase (Codebase Assembly & Architecture)

Tài liệu này mô tả **cách thức tổ chức các tầng kiến trúc** trong codebase Aurora WAF & API Gateway. Mục tiêu là cung cấp mô hình tư duy (mental model) rõ ràng cho lập trình viên mới: hiểu được code được chia thành các lớp nào, mỗi lớp có nhiệm vụ gì, và chúng ráp nối với nhau ra sao mà không bị rối bởi tên gọi cụ thể của biến hay hàm.

---

## 1. Controller Subsystem: Ma Trận Phân Tầng Xử Lý

Mô tả cách thức luồng thực thi đi qua từng lớp từ khi khởi động đến khi xử lý dữ liệu:

| Lớp / Pha Kiến Trúc | Trách Nhiệm & Hành Vi Xử Lý | Cơ Chế Kết Nối & Ranh Giới Thiết Kế |
| :--- | :--- | :--- |
| **Entry Layer** | - Điểm tiếp nhận khởi động đầu tiên từ hệ điều hành.<br>- Lắng nghe tín hiệu dừng (`SIGINT`, `SIGTERM`).<br>- Khởi tạo context gốc điều phối quy trình tắt hệ thống mượt mà (graceful shutdown). | **Cửa ngõ tiến trình**:<br>Kiểm soát toàn bộ vòng đời ứng dụng; bảo đảm các giao dịch đang ghi được commit an toàn trước khi thoát. |
| **Init Layer** | - Đọc và kiểm chuẩn biến môi trường.<br>- Thiết lập hạ tầng lưu trữ cơ sở dữ liệu phân tách: 1 kết nối ghi độc quyền (tránh xung đột ghi) và nhiều kết nối đọc đồng thời.<br>- Chạy migration cấu trúc dữ liệu tuần tự theo thứ tự nghiêm ngặt. | **Hạ tầng bền vững**:<br>Hoàn thành 100% việc chuẩn bị kết nối và cấu trúc dữ liệu trước khi mở bất kỳ cổng mạng nào. |
| **Composition Layer** | - Ráp nối các tầng đối tượng theo nguyên tắc phụ thuộc một chiều (Dependency Injection).<br>- Thiết lập các bộ lọc bảo vệ mạng (Middleware): xác thực token, kiểm soát nguồn gốc CORS, tiêu đề bảo mật.<br>- Mở socket gRPC lắng nghe kết nối đồng bộ spec từ các node biên. | **Khung liên kết**:<br>Chỉ làm nhiệm vụ kết nối các khối lại với nhau; tuyệt đối không chứa logic nghiệp vụ xử lý dữ liệu. |
| **Handler Layer (Transport)** | - Tiếp nhận yêu cầu mạng từ giao thức HTTP hoặc gRPC.<br>- Bóc tách và kiểm tra tính hợp lệ của dữ liệu đầu vào thô (format, kiểu dữ liệu, giới hạn kích thước).<br>- Chuyển đổi yêu cầu thành mệnh lệnh phẳng chuyển xuống tầng xử lý tiếp theo. | **Biên dịch giao thức**:<br>Cách ly chi tiết của giao thức truyền tải khỏi logic nghiệp vụ bên dưới. |
| **Service Layer (Logic)** | - Kiểm tra các quy tắc và điều kiện tiên quyết của nghiệp vụ.<br>- Đảm bảo tính nhất quán của trạng thái hệ thống trước và sau khi xử lý.<br>- Thực hiện các tác vụ tính toán như băm mã kiểm tra toàn vẹn hoặc kích hoạt biên dịch snapshot. | **Trọng tâm nghiệp vụ**:<br>Mỗi quy trình nghiệp vụ được tổ chức khép kín, không gọi chéo sang quy trình khác để tránh tạo hiệu ứng phụ (side-effects). |
| **Repository Layer (Persistence)** | - Biểu diễn các câu truy vấn phức tạp bằng Common Table Expressions (CTE).<br>- Thực hiện thao tác đọc và ghi nguyên tử (Atomic) trong cùng một phiên giao dịch.<br>- Trả về kết quả dưới dạng các cấu trúc dữ liệu phẳng độc lập. | **Ranh giới lưu trữ**:<br>Mỗi truy vấn gắn chặt với duy nhất một quy trình nghiệp vụ; không dùng chung câu truy vấn giữa các luồng dữ liệu khác nhau. |
| **Provider Layer (Background)** | - Vận hành các tác vụ chạy ngầm định kỳ hoặc hướng sự kiện.<br>- Tự động phát hiện thay đổi trạng thái để biên dịch snapshot cấu hình mới.<br>- Quản lý hàng đợi xử lý tác vụ bất đồng bộ (sao lưu, thông báo cảnh báo). | **Hậu trường tự động**:<br>Hoạt động song song và độc lập, không gây nghẽn luồng xử lý yêu cầu chính. |

---

## 2. Dataplane Agent Subsystem: Ma Trận Tầng Node Biên

Mô tả cách thức tiến trình daemon tại node biên tiếp nhận cấu hình phân tán và hiện thực hóa xuống máy chủ web:

| Lớp Kiến Trúc | Trách Nhiệm & Hành Vi Xử Lý | Cơ Chế Kết Nối & Ranh Giới Thiết Kế |
| :--- | :--- | :--- |
| **Bootstrap Layer** | - Đọc tham số định danh node và thông tin xác thực từ môi trường.<br>- Chuẩn bị sẵn sàng các thư mục cấu hình và tệp rỗng ban đầu.<br>- Khởi động môi trường thực thi bất đồng bộ quản lý các tác vụ con. | **Khởi tạo biên**:<br>Ngăn chặn hoạt động nếu chưa có định danh node hoặc thiếu token xác thực hợp lệ. |
| **gRPC Consumer Layer** | - Mở luồng nhận dữ liệu liên tục hai chiều với máy chủ điều khiển.<br>- Tiếp nhận các gói dữ liệu snapshot cấu hình toàn cụm.<br>- Đối chiếu mã băm kiểm tra để nhận biết ngay lập tức khi có bản phát hành mới. | **Luồng dữ liệu trực tiếp**:<br>Duy trì kết nối sống liên tục; tự động tái kết nối khi mạng bị gián đoạn. |
| **Reconciler & Jitter Layer**| - So sánh snapshot mới nhận với snapshot đang chạy trên máy.<br>- **Kích hoạt độ trễ ngẫu nhiên (Jitter Delay)** trước khi áp dụng cấu hình.<br>- Báo cáo kết quả và phiên bản đang nạp về máy chủ điều khiển. | **Bảo vệ hệ thống (Anti-Thundering Herd)**:<br>Triệt tiêu nguy cơ toàn bộ cluster đồng loạt tải lại cấu hình cùng một giây gây nghẽn origin. |
| **Materializer Layer** | - Dịch chuyển mô hình cấu hình logic thành các tệp cấu hình máy chủ web tĩnh.<br>- Kiểm tra cú pháp của tệp cấu hình mới sinh trước khi nạp.<br>- Ra lệnh nạp lại cấu hình mượt mà không làm ngắt các kết nối mạng hiện hữu.<br>- Tự động hủy bỏ và giữ nguyên cấu hình cũ nếu kiểm tra cú pháp có lỗi. | **Không gián đoạn (Zero-Downtime)**:<br>Tuyệt đối không để cấu hình sai làm sập tiến trình máy chủ web. |
| **Extension Dispatcher Layer**| - Phân tích danh sách các tính năng mở rộng được bật trong cấu hình.<br>- Khởi động hoặc dừng các luồng xử lý tương ứng trong bộ nhớ RAM.<br>- Cập nhật tham số hoạt động của các module theo thời gian thực. | **Quản lý động**:<br>Cho phép bật/tắt logic tính năng linh hoạt mà không cần khởi động lại tiến trình daemon. |
| **Telemetry Layer** | - Thu thập các chỉ số vận hành nội tại của máy chủ web.<br>- Định dạng và cung cấp cổng xuất số liệu phục vụ thu thập tự động.<br>- Định kỳ gửi nhịp tim kèm chỉ số tài nguyên (CPU, RAM, kết nối) về Controller. | **Giám sát nhẹ**:<br>Thực hiện đo đạc độc lập với luồng xử lý lưu lượng, tiêu thụ dưới 1% tài nguyên CPU. |

---

## 3. Engine & FFI Subsystem: Ma Trận Xử Lý Gói Tin Thời Gian Thực

Mô tả cách thức động cơ an ninh lõi và lớp chuyển tiếp FFI can thiệp vào từng gói tin HTTP:

| Lớp Kiến Trúc | Trách Nhiệm & Hành Vi Xử Lý | Cơ Chế Kết Nối & Ranh Giới Thiết Kế |
| :--- | :--- | :--- |
| **Compiler Layer** | - Chuyển hóa các quy tắc kiểm tra dạng văn bản thành định dạng nhị phân tối ưu.<br>- Đóng gói cây dữ liệu tra cứu tĩnh thành một khối bộ nhớ liên tục bất biến. | **Biên dịch ngoại tuyến**:<br>Chỉ thực hiện tại tầng điều khiển; tầng xử lý gói tin chỉ nạp khối nhị phân đã biên dịch sẵn. |
| **Vectorized Engine Layer** | - Quét đa mẫu song song bằng các thuật toán so khớp chuỗi tốc độ cao.<br>- Kiểm tra đồng thời toàn bộ các thành phần của gói tin: đường dẫn, tiêu đề, tham số truy vấn, nội dung thân.<br>- Tính toán điểm số bất thường để đưa ra phán quyết (cho qua, cảnh báo, chặn). | **Hiệu năng micro-giây**:<br>Thực thi thuần túy trong bộ nhớ RAM, tối ưu bộ nhớ đệm CPU để đạt tốc độ hàng trăm nghìn gói tin/giây trên một lõi. |
| **Radix Lookup Layer** | - Lưu trữ danh sách kiểm soát địa chỉ mạng phân tầng dưới dạng cây Radix.<br>- Tra cứu địa chỉ nguồn của gói tin trong thời gian hằng số O(1). | **Lọc mạng siêu tốc**:<br>Xác định tức thời quyền truy cập của địa chỉ mạng mà không phụ thuộc vào số lượng quy tắc đã nạp. |
| **FFI Safety Wrapper Layer**| - Cung cấp giao diện hàm tương thích nhị phân đa ngôn ngữ.<br>- Chuyển đổi vùng đệm dữ liệu giữa các môi trường bộ nhớ an toàn.<br>- Bắt toàn bộ lỗi runtime ngoại lệ, ngăn chặn lan truyền lỗi làm sập máy chủ web. | **Ranh giới an toàn bộ nhớ**:<br>Bảo đảm tuyệt đối không xảy ra rò rỉ bộ nhớ hoặc lỗi truy cập con trỏ bất hợp pháp. |
| **Module Phase Hook Layer** | - Móc nối trực tiếp vào pha kiểm soát truy cập của chuỗi xử lý gói tin web.<br>- Đọc ngữ cảnh của yêu cầu đang đến và gửi sang động cơ an ninh đánh giá.<br>- Thực thi quyết định: Cho qua tiếp tục chuỗi xử lý, hoặc trả phản hồi từ chối ngay lập tức. | **Xử lý không chặn (Non-blocking)**:<br>Tích hợp thẳng vào vòng lặp sự kiện chính của máy chủ web; không làm nghẽn các yêu cầu khác. |

---

## 4. Console UI Subsystem: Ma Trận Cấu Trúc Giao Diện

Mô tả cách ứng dụng giao diện được tổ chức thành các lớp vỏ bọc và không gian tương tác người dùng:

| Lớp Giao Diện | Trách Nhiệm & Hành Vi Xử Lý | Cơ Chế Kết Nối & Ranh Giới Thiết Kế |
| :--- | :--- | :--- |
| **App Shell Layer** | - Duy trì trạng thái phiên làm việc và bảo mật token người dùng.<br>- Cung cấp bộ quản lý giao diện thị giác toàn cục (chế độ sáng/tối).<br>- Bắt lỗi giao diện ở mức cao nhất, ngăn ngừa hiện tượng màn hình trắng khi có sự cố. | **Vỏ bọc nền tảng**:<br>Đảm bảo ứng dụng chạy ổn định và giữ vững ngữ cảnh đăng nhập xuyên suốt. |
| **Layout & Navigation Layer**| - Cung cấp cấu trúc khung hiển thị chuẩn: thanh bên điều hướng, thanh trạng thái cụm.<br>- Điều phối chuyển trang tức thời thông qua cơ chế định tuyến Single Page Application. | **Khung điều hướng**:<br>Tải trang mượt mà không làm tải lại toàn bộ trang web trên trình duyệt. |
| **Workspace Drawer Layer** | - Cung cấp không gian làm việc chuyên sâu dạng ngăn kéo trượt từ dưới lên chiếm 3/4 màn hình.<br>- Hiển thị bảng số liệu chi tiết tự động tinh chỉnh đặc thù theo từng loại tính năng.<br>- Cung cấp chế độ soạn thảo kép: Giao diện nhập trực quan và Trình soạn thảo thô, với khả năng đồng bộ dữ liệu tự động hai chiều. | **Không gian tương tác chuyên sâu**:<br>Tập trung toàn bộ thao tác cấu hình phức tạp vào một workspace rộng rãi, trực quan. |
| **API Transport Layer** | - Đóng gói các hàm gửi và nhận dữ liệu chuẩn hóa với máy chủ điều khiển.<br>- Chuyển hóa dữ liệu phản hồi từ backend thành các trạng thái cục bộ của giao diện.<br>- Xử lý thống nhất các thông báo lỗi và phản hồi trạng thái cho người dùng. | **Cách ly dữ liệu mạng**:<br>Giúp các thành phần giao diện chỉ tập trung vào hiển thị, không phụ thuộc vào chi tiết đường truyền. |

---

## 5. Ma Trận Quy Tắc Bất Biến Của Kiến Trúc (Architecture Invariants)

Những nguyên tắc thiết kế bắt buộc lập trình viên phải tuân thủ khi viết code mới:

| Nguyên Tắc Thiết Kế | Trọng Tâm Bắt Buộc | Lợi Ích Cốt Lõi | Rủi Ro Ngăn Ngừa |
| :--- | :--- | :--- | :--- |
| **Workflow Isolation** | Mỗi luồng công việc sở hữu trọn vẹn chuỗi xử lý từ tiếp nhận $\to$ nghiệp vụ $\to$ lưu trữ riêng biệt. | Tách biệt hoàn toàn phạm vi ảnh hưởng khi sửa code. | Ngăn ngừa lỗi dây chuyền làm hỏng các tính năng khác. |
| **CTE-First Persistence** | Thao tác dữ liệu nhiều bước phải gom vào Common Table Expressions trong 1 câu truy vấn duy nhất. | Bảo đảm tính trọn vẹn và nguyên tử ở tầng cơ sở dữ liệu. | Triệt tiêu xung đột dữ liệu ngầm và tranh chấp khóa tài nguyên. |
| **Immutable Ledger** | Mọi bản ghi phát hành cấu hình chỉ được thêm mới, nghiêm cấm sửa đổi lịch sử đã ghi. | Đảm bảo khả năng truy vết kiểm toán và phục hồi tức thì. | Mất dấu vết thay đổi hoặc sai lệch trạng thái cụm máy chủ. |
| **Jittered Sync** | Mọi node biên đều phải có khoảng thời gian chờ ngẫu nhiên trước khi nạp lại cấu hình. | Giữ vững độ ổn định cho hệ thống máy chủ gốc. | Tránh hiện tượng toàn bộ hệ thống bị sập do tải lại đồng loạt. |
| **Non-blocking Data Plane** | Tuyệt đối không thực hiện đọc ghi đĩa cứng hay tính toán nặng trong luồng xử lý gói tin. | Giữ độ trễ kiểm tra an ninh ở mức micro-giây. | Tránh làm nghẽn vòng lặp sự kiện và sụt giảm băng thông mạng. |
