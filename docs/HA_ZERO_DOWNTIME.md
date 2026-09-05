# High-Availability (HA) & Zero-Downtime Architecture for Aurora WAF Cluster

Tài liệu này mô tả kiến trúc kết hợp 2 tầng giúp loại bỏ triệt để lỗi gián đoạn kết nối khi chịu tải cao trong cụm NGINX High Availability (HA) Cluster.

---

## 1. Bản chất vấn đề khi Reload ở Tải Cao

Khi một cụm NGINX WAF đang chịu tải hàng chục ngàn request/giây (20k - 50k RPS), việc thực hiện `nginx -s reload` (`SIGHUP`) truyền thống thường gây ra một số lỗi `Connection reset by peer (os error 104)`.

**Nguyên nhân:**
- Khi Master NGINX nhận `SIGHUP`, các Worker cũ bị đưa vào trạng thái Graceful Shutdown (`SIGQUIT`).
- Worker cũ dừng nhận kết nối mới, nhưng đồng thời **ngắt ngang các kết nối TCP Keepalive đang nhàn rỗi (idle keepalive)**.
- Khi client (hoặc reverse proxy/LB) đồng thời đẩy một HTTP request mới trên socket vừa bị Worker cũ đóng, Linux Kernel bắt buộc phải phản hồi lại gói `TCP RST`, dẫn đến lỗi `ECONNRESET`.

---

## 2. Kiến trúc giải pháp 2 tầng (Dual-Layer Resilience)

Để giải quyết triệt để vấn đề này trên toàn cụm NGINX HA Cluster, Aurora WAF kết hợp đồng thời cả 2 phương pháp:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   TẦNG 1: QUẢN TRỊ WAF THƯỜNG NHẬT                      │
│                                                                          │
│  Cập nhật Rules / Policies / IP Blocklist / Virtual Patching             │
│  ───────────────────────────────────────────────────────────             │
│  ► Cơ chế: In-Memory Dynamic Snapshot (Shared Memory / COW)              │
│  ► Tác động: Hoàn toàn KHÔNG restart tiến trình Worker (0 SIGHUP)        │
│  ► Kết quả: 0 downtime, 0 TCP reset, chịu tải 100.000 RPS liên tục       │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────┐
│                   TẦNG 2: BẢO TRÌ HẠ TẦNG NGINX CLUSTER                  │
│                                                                          │
│  Nâng cấp NGINX Binary / Gia hạn SSL Cert / Thay đổi nginx.conf core     │
│  ───────────────────────────────────────────────────────────             │
│  ► Cơ chế: Connection Draining + Rolling Upgrade (USR2 + WINCH + QUIT)   │
│  ► Cấu hình NGINX:                                                       │
│    - worker_shutdown_timeout 30s;                                        │
│    - lingering_close on; (tránh phát sinh TCP RST khi đóng socket)       │
│    - listen ... reuseport; (chuyển giao socket nghe mượt mà ở Kernel)    │
│    - keepalive_requests 10000;                                           │
│  ► Kịch bản: scripts/aurora-ha-reload.sh                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Chi tiết triển khai Tầng 1: Dynamic In-Memory WAF Rules

Module `ngx_http_aurora_waf_module` và Rust Core FFI được thiết kế theo nguyên lý bất biến (immutable state) và Shared Slab Zone:
- Dữ liệu ruleset biên dịch được nạp vào vùng nhớ chia sẻ (Shared Memory).
- Khi Control Plane phát hành phiên bản ruleset mới:
  - Vùng nhớ mới được cấp phát và chuẩn bị sẵn.
  - Con trỏ ruleset tích cực được hoán đổi nguyên tử (Atomic Pointer Swap).
  - Các worker đang xử lý request dở tiếp tục đọc an toàn snapshot cũ, các request tiếp theo lập tức áp dụng snapshot mới.
  - **Không có bất kỳ tín hiệu reload (`SIGHUP`) nào được gửi tới tiến trình NGINX.**

---

## 4. Chi tiết triển khai Tầng 2: Cấu hình NGINX Connection Draining

Khi có nhu cầu thay đổi cấu hình hạ tầng mạng hoặc chứng chỉ SSL, cấu hình `nginx.conf` trên tất cả các node NGINX trong cụm phải có các directive bảo vệ:

```nginx
worker_processes auto;
worker_shutdown_timeout 30s; # Cho phép worker cũ grace period 30 giây để xử lý nốt

events {
    worker_connections 4096;
}

http {
    # Bật lingering close: NGINX chỉ đóng chiều ghi (SHUT_WR) và đọc nốt 
    # dữ liệu thừa từ client thay vì đóng thô bạo gây TCP RST
    lingering_close on;
    lingering_time 30s;
    lingering_timeout 5s;

    # Duy trì keepalive tối ưu
    keepalive_timeout 65s;
    keepalive_requests 10000;

    server {
        # Kích hoạt SO_REUSEPORT để Kernel Linux chia sẻ socket nghe độc lập
        listen 0.0.0.0:443 ssl reuseport;
        ...
    }
}
```

### Script điều phối Zero-Downtime Rolling Reload:

Aurora WAF cung cấp script tự động hóa quy trình chuyển giao kết nối tại [scripts/aurora-ha-reload.sh](file:///home/phucle/Desktop/aurora-waf/scripts/aurora-ha-reload.sh):

```bash
# Thực hiện rolling reload an toàn:
./scripts/aurora-ha-reload.sh /path/to/nginx.pid
```

**Quy trình từng bước:**
1. **Kiểm tra cú pháp**: `nginx -t` đảm bảo cấu hình không có lỗi cú pháp.
2. **Khởi tạo Master mới**: Gửi `SIGUSR2` đến Master cũ $\to$ Master mới được sinh ra cùng các Worker mới với cấu hình mới.
3. **Chuyển giao kết nối (Drain)**: Gửi `SIGWINCH` đến Master cũ $\to$ Các Worker cũ ngừng nhận kết nối mới, toàn bộ kết nối mới tự động chuyển sang Worker mới.
4. **Xử lý nốt kết nối tồn đọng**: Đợi thời gian grace period (mặc định 10-30s) để các kết nối cũ hoàn tất tự nhiên.
5. **Dọn dẹp Master cũ**: Gửi `SIGQUIT` đến Master cũ để kết thúc tiến trình cũ một cách êm đẹp.

---

## 5. Cấu hình Upstream / Load Balancer Resilience

Trong kiến trúc HA Cluster đặt sau Load Balancer (AWS ALB, Cloudflare, HAProxy, F5):
Cấu hình Load Balancer luôn bật chính sách **Idempotent Retries**:

```nginx
proxy_next_upstream error timeout invalid_header http_502 http_503;
proxy_next_upstream_tries 3;
```

Khi kết hợp cả 3 lớp bảo vệ (In-Memory WAF Reload + NGINX Connection Draining + Upstream Retry Policy), hệ thống cụm HA WAF đảm bảo đạt SLA uptime 99.999% trong mọi điều kiện vận hành và bảo trì.
