# Cẩm Nang Vận Hành — Response Compression Extension

Cẩm nang này cung cấp quy trình vận hành tiêu chuẩn (SOP), các bước xác thực thuật toán nén, lệnh kiểm tra CLI, và quy trình xử lý sự cố (Incident Playbooks) cho extension **`builtin/response-compression`**.

---

## 1. Quy Trình Vận Hành Tiêu Chuẩn (Standard Operating Procedures)

### SOP-01: Kiểm Tra Trạng Thái Nén Đa Thuật Toán

Sử dụng lệnh `curl` với các header `Accept-Encoding` khác nhau để kiểm thử tính năng đàm phán thuật toán của Gateway.

#### A. Kiểm tra đàm phán Zstandard (`zstd`)
```bash
curl -s -D - -o /dev/null -H "Accept-Encoding: gzip, deflate, br, zstd" http://<GATEWAY_IP>:<PORT>/api/v1/users
```
**Kỳ vọng trả về:**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Encoding: zstd
Vary: Accept-Encoding
```

#### B. Kiểm tra đàm phán Brotli (`br`)
```bash
curl -s -D - -o /dev/null -H "Accept-Encoding: gzip, deflate, br" http://<GATEWAY_IP>:<PORT>/api/v1/users
```
**Kỳ vọng trả về:**
```http
HTTP/1.1 200 OK
Content-Encoding: br
Vary: Accept-Encoding
```

#### C. Kiểm tra đàm phán Gzip (`gzip`)
```bash
curl -s -D - -o /dev/null -H "Accept-Encoding: gzip" http://<GATEWAY_IP>:<PORT>/api/v1/users
```
**Kỳ vọng trả về:**
```http
HTTP/1.1 200 OK
Content-Encoding: gzip
Vary: Accept-Encoding
```

---

### SOP-02: Cập Nhật Cấu Hình Nóng Không Cần Reload NGINX

Gửi yêu cầu cập nhật cấu hình qua HTTP API của Control Plane. Toàn bộ chính sách được đẩy vào Shared Memory Slot trong **< 50ms mà không khởi động lại hoặc reload NGINX**:

```bash
curl -X PUT http://<CONTROLLER_IP>:8080/api/v1/extensions/instances/<INSTANCE_ID> \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "min_length": 1024,
    "prefer_algorithms": ["zstd", "br", "gzip"],
    "zstd_level": 3,
    "brotli_level": 4,
    "gzip_level": 4,
    "types": ["application/json", "text/plain"],
    "routes_override": [
      {
        "path_prefix": "/api/v1/auth",
        "enabled": false
      }
    ]
  }'
```

---

### SOP-03: Kích Hoạt Nút Ngắt Khẩn Cấp (Emergency Kill Switch)

Nếu Gateway gặp tình trạng bão CPU, có thể tắt tính năng nén tức thì:

```bash
curl -X PUT http://<CONTROLLER_IP>:8080/api/v1/extensions/instances/<INSTANCE_ID> \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

Data Plane sẽ chuyển toàn bộ luồng Egress sang chế độ **Passthrough thuần túy** trong chu kỳ sync kế tiếp (< 50ms) với 0 byte cấp phát.

---

## 2. Quy Trình Xử Lý Sự Cố (Incident Playbooks)

### INC-01: Phản Hồi Trả Về Dạng Thô (Không Được Nén)

#### Triệu Chứng
Client gửi `Accept-Encoding: zstd, br, gzip` nhưng phản hồi nhận về không có tiêu đề `Content-Encoding`.

#### Bảng Kiểm Tra Nhanh

| Thứ Tự | Yếu Tố Kiểm Tra | Nguyên Nhân Thường Gặp | Cách Xử Lý |
| :--- | :--- | :--- | :--- |
| **1** | Kích thước Body | Body phản hồi nhỏ hơn `min_length` (1024 bytes) | Gateway chủ động không nén để tránh hiện tượng phình to payload. Hoàn toàn bình thường. |
| **2** | Status Code | Phản hồi trả về `204 No Content` hoặc `304 Not Modified` | Chuẩn HTTP nghiêm cấm nén các status code này. |
| **3** | Content-Type | MIME type không nằm trong danh sách `types` | Thêm MIME type vào danh sách `types` của extension. |
| **4** | Route Override | Đường dẫn API khớp với luật ghi đè tắt nén | Kiểm tra mảng `routes_override` xem có luật `enabled: false` khớp path không. |
| **5** | Header Client | Header có dạng `zstd;q=0` | Client chỉ định trọng số 0 để từ chối thuật toán đó. |

---

### INC-02: Mức Tiêu Hao CPU Tăng Đột Biến Dưới Tải Lớn

#### Triệu Chứng
CPU worker tăng cao khi Gateway phục vụ lượng lớn request có nén.

#### Giải Pháp Kỹ Thuật
1. **Ưu tiên Zstandard (`zstd`)**: Đảm bảo `"prefer_algorithms": ["zstd", "br", "gzip"]` và `"zstd_level": 1` hoặc `3`. Zstandard có tốc độ nén nhanh gấp 3–4 lần Gzip và Brotli, giúp giải phóng CPU vi xử lý cực nhanh.
2. **Nâng ngưỡng `min_length`**: Đổi `"min_length": 2048` hoặc `4096` để bỏ qua các payload JSON nhỏ.
3. **Kích hoạt Response Cache Extension**: Khi kết hợp với Cache Extension, các response phổ biến sẽ được cache ở trạng thái đã nén sẵn, giảm tải CPU nén về mức gần như 0%.
