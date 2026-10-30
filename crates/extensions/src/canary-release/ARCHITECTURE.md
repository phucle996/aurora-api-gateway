# Aurora API Gateway — Canary Release Architecture

Tài liệu này phân tích chi tiết thiết kế kiến trúc vi mô, mô hình luồng dữ liệu, tổ chức bộ nhớ L1 Cacheline và các bất biến an ninh của extension **`builtin/canary-release`**.

---

## 1. Sơ Đồ Kiến Trúc Luồng Dữ Liệu (Sequence Diagram)

Extension hoạt động hoàn toàn trong **HTTP Access Phase** của NGINX, sử dụng FFI không khóa (lockless) để kết nối giữa máy trạng thái NGINX C và lõi Rust Dataplane:

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client HTTP/1.1 / H2
    participant Nginx as NGINX Worker (C Core)
    participant FFI as Aurora FFI Bridge
    participant Engine as CanaryReleaseEngine (Rust)
    participant Upstream as Target Upstream (Baseline / Canary)

    Client->>Nginx: Request HTTP (e.g. GET /api/v1/users, X-Canary: beta)
    Nginx->>FFI: ngx_http_gateway_handler(r)
    FFI->>FFI: Trích xuất zero-copy AuroraAccessInput (IP, Host, Path, Method)
    FFI->>Engine: evaluate_ctx(ctx, header_lookup)
    
    activate Engine
    Note over Engine: 1. Host & Path check (Cacheline 0 - 64B)
    alt Khớp điều kiện L7 (Layer 1)
        Engine->>Nginx: Header lookup "x-canary" (con trỏ pool)
        Engine->>Engine: ByteMatcher::OneOf("true" | "beta")
        Note over Engine: Condition MATCHED -> Canary Slot
    else Phân chia tỷ lệ (Layer 2)
        Engine->>Engine: FNV-1a SWAR 64-bit Hash (Client IP / Cookie)
        Note over Engine: Bucket < weight_percentage -> Canary Slot
    end
    Engine-->>FFI: CanaryDecision (is_canary, target_upstream, headers_arc)
    deactivate Engine

    FFI->>Nginx: ngx_http_gateway_execute_allow(outcome)
    Note over Nginx: Gán $gateway_upstream = "app_green"<br/>Bơm injected headers (zero-copy)
    Nginx->>Upstream: proxy_pass http://$gateway_upstream;
    Upstream-->>Nginx: Response 200 OK
    Nginx-->>Client: Response 200 OK
```

---

## 2. Thiết Kế Vi Kiến Trúc & Bố Cục Bộ Nhớ (Microarchitecture)

### 2.1 Căn Lề 64-Byte L1 Data Cacheline (Cacheline 0 Packing)

Trong các hệ thống API Gateway tải cao (40,000+ RPS), việc truy cập bộ nhớ RAM chính là nguyên nhân hàng đầu gây stall CPU pipeline (ước tính 100-200 chu kỳ CPU cho mỗi L1/L2 Cache Miss).

Cấu trúc [`CompiledCanaryRule`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/canary-release/policy.rs#L415-L435) được tái cấu trúc thành 4 cacheline độc lập, với toàn bộ thông tin sàng lọc nóng nằm gọn trong **Cacheline 0 (64 bytes)**:

```
+-----------------------------------------------------------------------------------------+
| CACHELINE 0 (64 Bytes) - Hot Filter Fields                                              |
| [0..24]   origin_bytes: Vec<u8> (pointer, cap, len)                                    |
| [24..48]  path_prefix_bytes: Vec<u8> (pointer, cap, len)                               |
| [48]      is_wildcard_origin: bool                                                      |
| [49]      is_root_path: bool                                                            |
| [50]      path_prefix_ends_with_slash: bool                                             |
| [51]      split_by: SplitBy (enum 1 byte)                                               |
| [52..56]  weight_percentage: u32 (4 bytes)                                              |
| [56]      has_conditions: bool                                                          |
| [57..64]  _pad: [u8; 7] (đảm bảo căn lề tuyệt đối 64 bytes)                             |
+-----------------------------------------------------------------------------------------+
| CACHELINE 1 (64 Bytes) - Slot Sheet (Aligned 64B)                                       |
| [0..32]   slots[0]: CanarySlotMeta (Baseline Upstream & Headers Arc)                   |
| [32..64]  slots[1]: CanarySlotMeta (Canary Upstream & Headers Arc)                     |
+-----------------------------------------------------------------------------------------+
| CACHELINE 2 & 3 (128 Bytes) - Cold Fields & Condition Matchers                          |
| id: String, header_name, cookie_name, match_conditions: Vec<CompiledMatchCondition>    |
+-----------------------------------------------------------------------------------------+
```

> [!IMPORTANT]
> **Hiệu quả phần cứng**: Khi một request không khớp tiền tố `path_prefix` hoặc `origin`, CPU chỉ nạp duy nhất **Cacheline 0**. Cachelines 1, 2, và 3 hoàn toàn không bao giờ được chạm vào, tiết kiệm **75% băng thông L1-Dcache** cho các tác vụ khác.

---

### 2.2 Kiến Trúc Zero-Regex ByteMatcher

Thay vì biên dịch Regular Expressions sang máy trạng thái hữu hạn DFA/NFA (tiêu tốn từ 2,000 đến 10,000 bytes bộ nhớ và nhiều trăm nano-giây), `ByteMatcher` giải nén regex về các phép so khớp byte trực tiếp:

```
                            Input Regex String
                                    │
                                    ▼
                     ByteMatcher::compile_from_regex()
                                    │
       ┌──────────────┬─────────────┼──────────────┬──────────────┐
       ▼              ▼             ▼              ▼              ▼
  ^(a|b|c)$        ^/v2/.*        .*qa.*        *.*.vip        Exact String
       │              │             │              │              │
       ▼              ▼             ▼              ▼              ▼
   ByteMatcher    ByteMatcher   ByteMatcher    ByteMatcher    ByteMatcher
    ::OneOf        ::Prefix      ::Contains      ::Glob        ::ExactSwar
   (Length $O(1)$) (starts_with) (memchr SIMD)  ($O(N)$ Loop)   (1 Cycle SWAR)
```

1. **ExactSwar ($\le 8$ Bytes)**:
   - Nạp chuỗi vào thanh ghi 64-bit `u64`. So sánh giữa input và mục tiêu thông qua 1 chỉ thị máy duy nhất `cmp` trong **1 chu kỳ CPU**.
2. **OneOf ($N$ Mục tiêu)**:
   - Trước khi so sánh byte `input == target`, thuật toán kiểm tra `input.len() == target.len()`. Loại bỏ $95\%$ các so sánh thừa chỉ bằng một phép so sánh số nguyên.
3. **Contains (SIMD Substring Match)**:
   - Sử dụng thư viện `memchr` tận dụng các tập lệnh vector AVX2 (`_mm256_cmpeq_epi8`) quét cùng lúc 32 bytes trên mỗi chu kỳ để tìm kiếm vị trí chuỗi con.
4. **Glob (Wildcard Tuyến Tính Không Backtracking)**:
   - Giải thuật so khớp wildcard lặp tuyến tính $O(N \times M)$ với $M \le 2$ wildcards, triệt tiêu hoàn toàn hiện tượng suy thoái hàm mũ $O(2^N)$ của Regex Catastrophic Backtracking.

---

### 2.3 Phân Luồng Không Rẽ Nhánh (Branchless Slot Resolution)

Trong thiết kế cũ, việc trả về upstream cần qua cấu trúc rẽ nhánh `if is_canary { ... } else { ... }`. Điều này tạo ra rủi ro **Branch Misprediction** khi luồng traffic 50/50 thay đổi ngẫu nhiên.

Trong thiết kế mới, [`CanarySlotSheet`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/canary-release/policy.rs#L395-L405) tổ chức 2 slot:
- `slots[0]`: Baseline Upstream Metadata.
- `slots[1]`: Canary Upstream Metadata.

Quyết định được thi hành bằng số học thuần túy:

```rust
// Chuyển cờ boolean thành chỉ mục 0 hoặc 1 mà không phát sinh lệnh nhảy CPU (cmov / setc)
let meta = &rule.slot_sheet.slots[is_canary as usize];
return CanaryDecision::matched(rule.id.as_str(), is_canary, meta);
```

---

### 2.4 Khởi Tạo & Đồng Bộ Shared Memory (Zero-Downtime Hot Swap)

Chính sách Canary được lưu trữ tại `/dev/shm/aurora_gateway_policy.bin` (Slot index 7):

```mermaid
flowchart LR
    CP["Aurora Controller<br/>(Go Control-Plane)"] -->|gRPC Spec Sync| CW["Control Worker<br/>(Rust Daemon)"]
    CW -->|mmap MAP_SHARED| SHM[("/dev/shm/aurora_gateway_policy.bin<br/>Slot 7 (Canary)")]
    SHM -.->|Out-of-band Timer 50ms| N1["NGINX Worker 1<br/>(Rust Lifecycle)"]
    SHM -.->|Out-of-band Timer 50ms| N2["NGINX Worker 2<br/>(Rust Lifecycle)"]
    SHM -.->|Out-of-band Timer 50ms| N3["NGINX Worker 3<br/>(Rust Lifecycle)"]
    SHM -.->|Out-of-band Timer 50ms| N4["NGINX Worker 4<br/>(Rust Lifecycle)"]
```

- **Lockless Generation Polling**: Mỗi worker process của NGINX chạy timer out-of-band (50ms) kiểm tra `total_generation`.
- Khi cấu hình thay đổi: Control-Worker cập nhật CRC32, `data_len`, ghi dữ liệu mới và tăng `generation`.
- NGINX workers phát hiện generation mới, nạp lại snapshot vào `ACTIVE_SPACE` theo mô hình RCU (Read-Copy-Update) mà **không ngắt bất kỳ kết nối TCP nào**.

---

## 3. Các Bất Biến An Ninh & Phòng Thủ (Security Invariants)

1. **Chống Tấn Công CRLF Injection (CWE-113 / CWE-93)**:
   - Các header được gắn thêm vào upstream (`canary_upstream_headers` và `baseline_upstream_headers`) được kiểm tra nghiêm ngặt:
     - Giá trị không được chứa ký tự `\r` (`0x0D`), `\n` (`0x0A`), hoặc byte NULL (`0x00`).
     - Tên header bắt buộc phải tuân thủ chuẩn RFC 7230: chỉ gồm ký tự chữ cái, số, dấu gạch nối `-` và gạch dưới `_`.
2. **Ngăn Ngừa Khai Thác Tên Upstream (SSRF / Target Injection)**:
   - `baseline_upstream` và `canary_upstream` chỉ cho phép tập ký tự an toàn `[a-zA-Z0-9_.-]` với độ dài tối đa 64 ký tự.
   - Bắt buộc `baseline_upstream != canary_upstream` để loại bỏ các cấu hình lỗi logic vòng lặp.
3. **Chống Tấn Công ReDoS (CWE-1333)**:
   - Regex engine được loại bỏ $100\%$ khỏi hot-path. Các biểu thức gửi từ Control Plane được phân tích cú pháp tĩnh ở giai đoạn khởi tạo; nếu chứa cú pháp lồng nhau nguy hiểm, engine lập tức từ chối `Error::InvalidPolicy` ngay tại Control Plane.
4. **Giới Hạn Bộ Nhớ & Độ Dài (Resource Exhaustion Defense)**:
   - Độ dài URL / Path tối đa: 4,096 bytes.
   - Độ dài Origin / Host tối đa: 253 bytes (RFC 1035).
   - Độ dài Client IP tối đa: 64 bytes.
   - Số lượng header tối đa trên mỗi slot: 16 headers.
