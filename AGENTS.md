# Aurora Agent Rules

@/home/phucle/.codex/RTK.md

## Workflow-first development

- Đặt workflow end-to-end lên trước file, package, service hoặc abstraction.
- Trước khi implement, xác định rõ workflow owner, authority source, durable boundary, retry/settlement rule, failure mode và security invariant.
- Mỗi change chỉ nên tác động workflow được yêu cầu. Không kéo theo cleanup hoặc refactor của workflow khác.
- Ưu tiên implementation nằm trong module/workflow owner để giữ dependency direction và blast radius nhỏ.
- Test theo behavior và boundary của workflow: success, failure, retry/replay, stale event, authorization và recovery khi có liên quan.

## Workflow isolation over helpers

- Không tạo helper function theo mặc định.
- Giữ logic tại workflow owner và call site khi điều đó làm ownership, state transition và failure path rõ hơn.
- Chỉ tạo helper khi thật sự bắt buộc cho correctness hoặc security, hoặc khi không thể giữ invariant nhất quán tại call sites mà không tạo rủi ro thực tế.
- Helper bắt buộc phải có scope nhỏ nhất có thể: ưu tiên private function trong cùng workflow/module, sau đó mới tới package-local. Không đưa vào shared/global utility nếu chưa có nhiều workflow với cùng một contract được chứng minh.
- Không tạo generic abstraction, utility layer hoặc reusable helper để dự đoán nhu cầu tương lai.
- Không refactor code hiện có thành helper chỉ vì trùng cú pháp trong khi semantics, authority hoặc failure behavior thuộc các workflow khác nhau.
- Nếu buộc phải thêm helper, change description phải giải thích vì sao inline/workflow-local implementation không đủ và helper đó bảo toàn isolation như thế nào.

## Flat workflow and flat entity

- Mỗi workflow phải có command, projection/result, service port và repository port riêng; không dùng result entity của workflow khác làm input hoặc authority của workflow hiện tại.
- Entity của API workflow phải là flat projection theo đúng workflow owner. Không lồng `Schedule -> Version -> Bracket`, không embed hoặc compose entity của workflow khác để tiết kiệm mapping.
- Repeated line/bracket records chỉ được phép là type con mang tên theo chính workflow đó. Không dùng một type input chung xuyên publish, detail, cache, estimate hoặc settlement.
- Chỉ kernel primitive được phép compose các kernel value object/snapshot khi composition đó là invariant nội tại của kernel. API/module workflow không được dựa vào ngoại lệ này.
- Không gọi workflow read/detail từ workflow mutation/publish. Mutation phải đọc authority bằng projection/port riêng của chính mutation workflow.
- Ưu tiên mapping tường minh và duplication nhỏ theo workflow hơn abstraction hoặc entity graph làm ownership khó đọc.

## CTE-first repository

- Repository ưu tiên CTE để biểu diễn target, authority, latest version, winner, count và mutation projection trong một câu SQL dễ trace.
- Dùng transaction với nhiều statement khi durable transition thực sự có nhiều mutation boundary; không tách query chỉ để tái sử dụng repository method của workflow khác.
- CTE không được biến thành abstraction dùng chung. Mỗi query vẫn thuộc đúng một repository port/workflow và trả về flat projection của workflow đó.

## Workflow contexts, never God Contexts

- Không dùng `#[allow(clippy::too_many_arguments)]` để unblock build hoặc che nợ thiết kế. Ngoại lệ phải được user phê duyệt tường minh trước khi commit.
- Khi workflow cần nhiều capability, tạo context riêng ngay trong module owner. Context chỉ được chứa capability mà workflow đó thật sự sử dụng.
- Dữ liệu nghiệp vụ, signed input và transport input phải đi qua command/request type có tên theo workflow; không trộn chúng vào capability context.
- Cấm `AppContext`, `ServiceContext`, dependency bag hoặc context dùng chung cho các workflow không cùng authority/failure boundary.
- Không di chuyển dependency vào context chỉ để giảm số argument. Mỗi field phải phản ánh capability, input hoặc invariant cụ thể của workflow owner.

## Required working order

2. Trace workflow end-to-end trong code/config/contract hiện tại.
3. Chốt ownership, Source of Truth, invariants và failure semantics.
4. Implement thay đổi với scope workflow nhỏ nhất.
5. Verify bằng test/check đúng boundary.

Các `AGENTS.md` sâu hơn trong cây thư mục bổ sung rule riêng cho subtree và phải được đọc trước khi làm việc trong subtree đó.
