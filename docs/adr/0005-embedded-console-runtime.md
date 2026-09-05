# ADR 0005: Embedded console và bootstrap NGINX runtime

Status: Accepted and implemented. Date: 2026-09-05.

React build nhúng vào Go bằng `go:embed`; Vite tiếp tục dùng cho HMR. Go binary có
UI/API cùng origin, không cần assets bên ngoài khi deploy. Controller vẫn optional
đối với NGINX data plane. Build Go yêu cầu frontend build trước; Make/CI encode dependency.

Để chứng minh lifecycle trước full rule language, bootstrap dùng JSON exact-path
policy nhỏ thay cho compiled IR chưa có. JSON chỉ parse lúc load config. Đây không
phải quyết định bỏ compiler/IR ở ADR 0002. Rust staticlib liên kết vào C module;
ABI v2 dùng opaque handle và borrowed buffers, panic được chặn ở boundary.

Xem [runtime contract](../RUNTIME.md) cho ownership, failure semantics và giới hạn.
Các function adapter/constructor là hook bắt buộc hoặc owner của lifecycle/HTTP
transport, không thêm shared utility layer. Migration/config/readiness workflows
khác được giữ nguyên; controller status trả `enforcement_ready: null` vì chưa có
node observer làm authority cho giá trị này.
