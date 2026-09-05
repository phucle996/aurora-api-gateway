# Optional React console

React 19.2.8 + TypeScript 7.0.2 + Vite 8.2.2; Node 26.8.1 và npm 12.0.2.
Xem [toolchain](../docs/TOOLCHAIN.md), chạy `make ui-install` rồi `make ui`.
Dev proxy chuyển `/api` đến controller loopback, không cần CORS mở rộng.
Trang hiện tại chỉ hiển thị trạng thái scaffold; không có số liệu attack giả.

Build hiện xuất vào `control-plane/internal/console/dist` để Go embed. Khi chạy
binary controller không cần directory assets. Vite vẫn là dev/HMR server; tắt
controller/UI không ảnh hưởng NGINX runtime. Authentication chưa triển khai.
