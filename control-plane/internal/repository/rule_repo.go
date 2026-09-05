package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

// ruleRepository là trung tâm điều phối dữ liệu (Kho dữ liệu) cho toàn bộ luật bảo vệ WAF.
//
// [Góc nhìn kinh tế / quản trị]:
// Tương tự mô hình ngân hàng tách biệt:
// - writer (Quầy giao dịch tạo mới/chỉnh sửa hợp đồng): chuyên ghi nhận các thay đổi dữ liệu.
// - reader (Quầy tra cứu/đối soát sao kê): chuyên phục vụ hàng nghìn truy vấn đọc cùng lúc mà không làm nghẽn quầy ghi.
type ruleRepository struct {
	writer *sql.DB // Kết nối cơ sở dữ liệu dành riêng cho thao tác ghi (CREATE, UPDATE, PUBLISH)
	reader *sql.DB // Kết nối cơ sở dữ liệu tối ưu cho thao tác tra cứu đọc (LIST, DETAIL, STATS, HISTORY)
}

// NewRuleRepository khởi tạo bộ kết nối dữ liệu với 2 luồng đọc/ghi riêng rẽ.
func NewRuleRepository(writer, reader *sql.DB) *ruleRepository {
	return &ruleRepository{writer: writer, reader: reader}
}

// ─── 1. List Rules (Tra cứu danh sách luật & Phân trang) ──────────────────────

// List thực hiện tìm kiếm, lọc và phân trang danh mục luật bảo vệ WAF.
//
// [Góc nhìn kinh tế]:
// Giống như việc mở danh bạ hợp đồng kinh doanh:
// - Tìm kiếm theo từ khóa tên luật, lọc theo nhóm nghiệp vụ (như SQLi, Bot, XSS...), mức độ nghiêm trọng hay trạng thái Bật/Tắt.
// - Sử dụng cơ chế phân trang (Pagination) để không tải ồ ạt hàng ngàn dòng cùng lúc gây tốn băng thông và chậm hệ thống.
// - CTE (Common Table Expression) gom bước lọc, đếm tổng và phân trang trong đúng một chuyến truy vấn SQL duy nhất.
func (r *ruleRepository) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	out := entity.ListRulesResult{Items: []entity.ListRulesItem{}}

	// Bước 1: Chạy câu truy vấn CTE tích hợp:
	// - Bảng tạm "filtered": Lọc các dòng thỏa mãn tất cả tiêu chí tìm kiếm (tên, nhóm, hành vi, độ nghiêm trọng, bật/tắt).
	// - Bảng tạm "page": Chỉ lấy số dòng đúng bằng giới hạn Limit quy định, bắt đầu từ vị trí con trỏ After.
	// - Bảng tạm "totals": Đếm tổng số lượng bản ghi hợp lệ để hiển thị trên giao diện người dùng.
	rows, err := r.reader.QueryContext(ctx, `WITH filtered AS (
SELECT r.*,CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END schema_version,coalesce(d.runtime_ready,1) runtime_ready
FROM rules r LEFT JOIN rule_definitions d ON d.rule_id=r.id AND d.version=r.version
WHERE (?='' OR instr(lower(name),lower(?))>0)
AND (?='' OR rule_group=?) AND (?='' OR action=?) AND (?='' OR severity=?)
AND (?='' OR enabled=CASE ? WHEN 'true' THEN 1 ELSE 0 END))
 ,page AS (SELECT * FROM filtered WHERE id>? ORDER BY id LIMIT ?),
 totals AS (SELECT count(*) total FROM filtered)
SELECT totals.total,coalesce(id,0),coalesce(version,0),coalesce(name,''),coalesce(description,''),coalesce(rule_group,''),coalesce(action,''),coalesce(severity,''),coalesce(score,0),coalesce(priority,0),coalesce(path,''),coalesce(enabled,0),coalesce(updated_at,''),coalesce(schema_version,0),coalesce(runtime_ready,0)
FROM totals LEFT JOIN page ON 1=1 ORDER BY id`,
		q.Search, q.Search, q.Group, q.Group, q.Action, q.Action, q.Severity, q.Severity, q.Enabled, q.Enabled, q.After, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	// Bước 2: Quét dữ liệu từng dòng trả về từ database và nạp vào danh sách kết quả
	for rows.Next() {
		var x entity.ListRulesItem
		if err = rows.Scan(&out.Total, &x.ID, &x.Version, &x.Name, &x.Description, &x.Group, &x.Action, &x.Severity, &x.Score, &x.Priority, &x.Path, &x.Enabled, &x.UpdatedAt, &x.SchemaVersion, &x.RuntimeReady); err != nil {
			return out, err
		}
		if x.ID != 0 {
			out.Items = append(out.Items, x)
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}

	// Bước 3: Tính toán con trỏ trang kế tiếp (NextAfter)
	// Ta truy vấn Limit + 1 dòng: nếu số dòng thực tế vượt quá Limit, chứng tỏ vẫn còn trang sau.
	// Ta cắt dòng thừa ra và lấy ID của dòng cuối cùng làm mốc đánh dấu cho lượt tải kế tiếp.
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextAfter = strconv.FormatInt(out.Items[len(out.Items)-1].ID, 10)
	}
	return out, nil
}

// ─── 2. Rule Detail (Xem hồ sơ chi tiết của 1 luật) ──────────────────────────

// ruleConditionRecord là cấu trúc nội bộ dùng để lưu trữ/giải mã các điều kiện lọc (IP, Header, Regex...) trong database.
type ruleConditionRecord struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	HeaderName string `json:"header_name"`
}

// Detail tải toàn bộ hồ sơ chi tiết của một luật bảo vệ cụ thể dựa theo ID.
//
// [Góc nhìn kinh tế]:
// Tương tự việc rút một bộ hồ sơ tín dụng ra khỏi tủ lưu trữ:
// - Đọc từ bảng gốc (rules) kết hợp bảng mở rộng điều kiện chi tiết (rule_definitions).
// - Nếu là luật đời cũ (v1), hệ thống tự động chuẩn hóa sang định dạng hiển thị tương thích.
// - Nếu hồ sơ không tồn tại, báo lỗi "không tìm thấy" (Not Found).
func (r *ruleRepository) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	var x entity.RuleDetailResult
	var conditions, issues string

	// Bước 1: Đọc thông tin luật từ database
	err := r.reader.QueryRowContext(ctx, `WITH target AS(SELECT * FROM rules WHERE id=?)
SELECT t.id,t.version,t.name,t.description,t.rule_group,t.action,t.severity,t.score,t.priority,t.path,t.enabled,t.updated_at,
CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END,coalesce(d.runtime_ready,1),coalesce(d.runtime_issues,'[]'),
coalesce(d.logic_mode,'all'),coalesce(d.conditions_json,'[]'),coalesce(d.source_ip,''),coalesce(d.host_domain,''),coalesce(d.path_prefix,''),coalesce(d.http_method,''),d.response_code,coalesce(d.custom_response,''),coalesce(d.log_event,0),coalesce(d.add_to_reputation,0)
FROM target t LEFT JOIN rule_definitions d ON d.rule_id=t.id AND d.version=t.version`, q.ID).Scan(&x.ID, &x.Version, &x.Name, &x.Description, &x.Group, &x.Action, &x.Severity, &x.Score, &x.Priority, &x.Path, &x.Enabled, &x.UpdatedAt,
		&x.SchemaVersion, &x.RuntimeReady, &issues, &x.LogicMode, &conditions, &x.SourceIP, &x.HostDomain, &x.PathPrefix, &x.HTTPMethod, &x.ResponseCode, &x.CustomResponse, &x.LogEvent, &x.AddToReputation)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	if err != nil {
		return x, err
	}

	// Bước 2: Giải mã chuỗi JSON các điều kiện kiểm tra (Conditions) thành danh sách có cấu trúc
	var condRecords []ruleConditionRecord
	if err = json.Unmarshal([]byte(conditions), &condRecords); err != nil {
		return x, err
	}
	x.Conditions = make([]entity.RuleDetailCondition, len(condRecords))
	for i, cr := range condRecords {
		x.Conditions[i] = entity.RuleDetailCondition{
			Field:      cr.Field,
			Operator:   cr.Operator,
			Value:      cr.Value,
			HeaderName: cr.HeaderName,
		}
	}

	// Bước 3: Giải mã danh sách cảnh báo hoặc lỗi tính hợp lệ (Runtime Issues nếu có)
	if err = json.Unmarshal([]byte(issues), &x.RuntimeIssues); err != nil {
		return x, err
	}

	// Bước 4: Xử lý tương thích ngược cho luật thế hệ 1 (Schema v1 chỉ có đường dẫn đơn giản)
	if x.SchemaVersion == 1 {
		x.Conditions = []entity.RuleDetailCondition{{Field: "path", Operator: "equals", Value: x.Path}}
		if x.Action == "block" {
			code := 403 // Hành vi chặn mặc định của v1 luôn trả về mã lỗi HTTP 403 Forbidden
			x.ResponseCode = &code
		}
	}
	return x, err
}

// ─── 3. Rule Stats (Báo cáo tổng hợp & Thống kê tăng trưởng) ──────────────────

// Stats tạo báo cáo thống kê các chỉ số an ninh hệ thống tính đến thời điểm hiện tại.
//
// [Góc nhìn kinh tế / tài chính]:
// Giống như bảng báo cáo kết quả hoạt động kinh doanh (P&L snapshot):
// - Đếm tổng số luật đang có trong danh mục, số luật đang Bật (Active), số luật ở chế độ Ghi log, số luật đang Chặn.
// - So sánh với "Mốc cơ sở" (Baseline) tại ngày đầu tiên của tháng để tính chênh lệch tăng/giảm (Delta: +5 luật mới, -2 luật tắt...).
// - Sử dụng duy nhất 1 câu truy vấn SQLite snapshot để bảo đảm tính nhất quán số liệu (không bị lệch số khi có ai đó sửa luật giữa chừng).
func (r *ruleRepository) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	var x entity.RuleStatsResult
	if q.AsOf.IsZero() {
		return x, taxonomy.ErrRuleInvalid
	}

	// Bước 1: Xác định mốc thời gian đối soát:
	// - asOf: Thời điểm hiện tại cần lập báo cáo.
	// - comparisonBefore: Ngày đầu tiên của tháng hiện hành lúc 00:00:00 UTC (dùng làm mốc so sánh).
	asOf := q.AsOf.UTC()
	x.AsOf = asOf.Format(time.RFC3339Nano)
	x.ComparisonBefore = time.Date(asOf.Year(), asOf.Month(), 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	// Bước 2: Chạy một truy vấn CTE duy nhất tính toán toàn bộ bức tranh tài nguyên:
	// - "coverage": Kiểm tra xem hệ thống đã có đủ lịch sử dữ liệu từ trước đầu tháng hay chưa.
	// - "winners": Tìm phiên bản mới nhất của từng luật tồn tại trước ngày đầu tháng.
	// - "baseline": Thống kê tổng số lượng luật, số lượng bật/tắt ở mốc đầu tháng.
	// - "totals": Thống kê tổng số lượng luật ở thời điểm hiện tại.
	// - Đoạn cuối tính hiệu số Delta = totals - baseline (tăng/giảm ròng).
	err := r.reader.QueryRowContext(ctx, `WITH
 coverage AS (SELECT coalesce(min(julianday(applied_at)) <= julianday(?),0) available FROM schema_migrations WHERE version=2),
 winners AS (SELECT rule_id,max(version) version FROM rule_revisions WHERE julianday(updated_at)<julianday(?) GROUP BY rule_id),
 baseline AS (SELECT count(*) total,coalesce(sum(r.enabled),0) enabled,
 coalesce(sum(r.enabled=1 AND r.action='log'),0) logs,coalesce(sum(r.enabled=1 AND r.action='block'),0) blocks
 FROM rule_revisions r JOIN winners w ON w.rule_id=r.rule_id AND w.version=r.version),
 totals AS (SELECT count(*) total,coalesce(sum(enabled),0) enabled,
 coalesce(sum(enabled=1 AND action='log'),0) logs,coalesce(sum(enabled=1 AND action='block'),0) blocks FROM rules)
 SELECT t.total,t.enabled,t.logs,t.blocks,c.available,
 CASE WHEN c.available THEN t.total-b.total END,CASE WHEN c.available THEN t.enabled-b.enabled END,
 CASE WHEN c.available THEN t.logs-b.logs END,CASE WHEN c.available THEN t.blocks-b.blocks END
 FROM totals t CROSS JOIN baseline b CROSS JOIN coverage c`, x.ComparisonBefore, x.ComparisonBefore).Scan(&x.Total, &x.Enabled, &x.Log, &x.Block, &x.HistoryAvailable, &x.TotalDelta, &x.EnabledDelta, &x.LogDelta, &x.BlockDelta)
	return x, err
}

// ─── 4. Rule History (Nhật ký kiểm toán / Audit Log thay đổi) ─────────────────

// History trích xuất sổ cái lịch sử thay đổi của một luật WAF cụ thể.
//
// [Góc nhìn kinh tế / kiểm toán]:
// Tương đương "Sổ cái kiểm toán" (Audit Trail):
// - Mỗi lần ai đó sửa tên, đổi hành vi từ 'log' sang 'block', hoặc bật/tắt luật, hệ thống đều lưu lại một trang nhật ký riêng biệt.
// - Truy vấn sắp xếp từ phiên bản mới nhất lùi về quá khứ để người quản trị biết rõ: Ai đã làm gì, vào thời điểm nào, phiên bản nào.
func (r *ruleRepository) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	out := entity.RuleHistoryResult{Items: []entity.RuleHistoryRecord{}}

	// Bước 1: Tra cứu lịch sử từ bảng sổ cái rule_revisions, hỗ trợ lọc lùi dần theo con trỏ "Before"
	rows, err := r.reader.QueryContext(ctx, `WITH selected AS(SELECT version,name,action,enabled,actor,updated_at FROM rule_revisions WHERE rule_id=? AND (?=0 OR version<?))
 SELECT version,name,action,enabled,actor,updated_at FROM selected ORDER BY version DESC LIMIT ?`, q.ID, q.Before, q.Before, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	// Bước 2: Đọc từng bản ghi lịch sử
	for rows.Next() {
		var item entity.RuleHistoryRecord
		if err = rows.Scan(&item.Version, &item.Name, &item.Action, &item.Enabled, &item.Actor, &item.UpdatedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}

	// Bước 3: Đặt mốc con trỏ cho trang kế tiếp nếu lịch sử còn nhiều hơn số lượng Limit yêu cầu
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextBefore = out.Items[q.Limit-1].Version
	}
	return out, nil
}

// ─── 5. Create Rule (Thêm mới luật bảo vệ WAF) ────────────────────────────────

// Create ghi nhận một luật bảo vệ mới vào cơ sở dữ liệu.
//
// [Góc nhìn kinh tế / quản trị rủi ro]:
// 1. Chống bấm đúp / Chống trùng giao dịch (Idempotency):
//    Giống như máy quẹt thẻ POS: nếu người dùng ấn nút "Tạo" 2 lần do mạng chập chờn, mã băm (SHA-256) sẽ phát hiện ra
//    giao dịch này đã được ghi nhận trước đó và trả về kết quả cũ ngay lập tức, không tạo ra 2 luật trùng nhau.
// 2. Kiểm soát trần chi phí / Quy mô tài nguyên (Quota Cap):
//    Hệ thống khống chế tối đa không quá 1024 luật đang hoạt động để máy chủ WAF không bị quá tải bộ nhớ khi lọc gói tin.
// 3. Toàn vẹn giao dịch (Database Transaction - ACID):
//    Thêm vào bảng chính (rules) đồng thời ghi sổ cái kiểm toán (rule_revisions) và biên lai chống trùng (rule_creates).
//    Nếu có bất kỳ bước nào lỗi, hệ thống sẽ tự động hoàn tác (Rollback), bảo đảm dữ liệu không bị rác.
func (r *ruleRepository) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	var out entity.CreateRuleResult

	// Bước 1: Tính toán dấu vân tay kỹ thuật số (Mã băm SHA-256) của nội dung yêu cầu tạo luật
	raw, _ := json.Marshal(c)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])

	// Bước 2: Mở một phiên giao dịch an toàn (Transaction)
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 3: Kiểm tra tính bất biến / Chống tạo lặp (Idempotency Check):
	// Nếu mã RequestKey đã từng gửi trước đó:
	// - Khớp mã băm hash -> Khách hàng chỉ đang gửi lại yêu cầu cũ, trả về kết quả thành công mà không trừ thêm tài nguyên.
	// - Khác mã băm hash -> Báo lỗi xung đột (Conflict) vì dùng cùng 1 mã chìa khóa nhưng nội dung lại khác nhau.
	var prior string
	err = tx.QueryRowContext(ctx, "SELECT rule_id,request_hash FROM rule_creates WHERE request_key=?", c.RequestKey).Scan(&out.ID, &prior)
	if err == nil {
		if prior != hash {
			return out, taxonomy.ErrRuleConflict
		}
		out.Version = 1
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	// Bước 4: Kiểm soát hạn mức tối đa (Risk & Capacity Limit: tối đa 1024 rules)
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 5: Chèn bản ghi luật mới vào bảng chính `rules`
	err = tx.QueryRowContext(ctx, `INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled)
VALUES(1,?,?,?,?,?,?,?,?,?) RETURNING id,version`, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled).Scan(&out.ID, &out.Version)
	if err != nil {
		return out, err
	}

	// Bước 6: Tự động ghi vào sổ cái kiểm toán `rule_revisions` (Audit Trail)
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}

	// Bước 7: Lưu biên lai giao dịch vào bảng `rule_creates` để đối soát chống lặp cho các yêu cầu sau
	if _, err = tx.ExecContext(ctx, "INSERT INTO rule_creates VALUES(?,?,?)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}

	// Bước 8: Chốt giao dịch (Commit) ghi nhận vĩnh viễn vào ổ đĩa
	return out, tx.Commit()
}

// ─── 6. Update Rule (Cập nhật chỉnh sửa luật hiện có) ─────────────────────────

// Update cập nhật nội dung của một luật bảo vệ WAF.
//
// [Góc nhìn kinh tế / quản trị xung đột]:
// 1. Khóa lạc quan (Optimistic Concurrency Control):
//    Giống như khi 2 nhân viên cùng mở 1 tài liệu hợp đồng phiên bản số 3:
//    - Người thứ nhất lưu thành công -> Phiên bản nhảy lên số 4.
//    - Người thứ hai sau đó bấm lưu với phiên bản dự kiến là 3 -> Bị từ chối ngay lập tức (Conflict),
//      ngăn chặn nguy cơ người này vô tình ghi đè làm mất công sức chỉnh sửa của người kia.
// 2. Bảo vệ cấu trúc nâng cao:
//    Không cho phép dùng giao diện cập nhật v1 đơn giản để ghi đè lên các luật đa điều kiện v2 phức tạp.
func (r *ruleRepository) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	var out entity.UpdateRuleResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 1: Ngăn chặn thao tác nhầm lẫn - Không được dùng update cổ điển v1 để xóa cấu trúc nâng cao v2
	var definitions int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rule_definitions WHERE rule_id=?", c.ID).Scan(&definitions); err != nil {
		return out, err
	}
	if definitions > 0 {
		return out, taxonomy.ErrRuleConflict
	}

	// Bước 2: Cập nhật dữ liệu với cơ chế khóa phiên bản lạc quan (version = ExpectedVersion):
	// Nếu phiên bản trong DB không khớp với phiên bản khách hàng đang cầm, câu lệnh sẽ không tác động dòng nào.
	err = tx.QueryRowContext(ctx, `WITH target AS (SELECT id FROM rules WHERE id=? AND version=?)
UPDATE rules SET version=version+1,name=?,description=?,rule_group=?,action=?,severity=?,score=?,priority=?,path=?,enabled=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN(SELECT id FROM target) RETURNING id,version`, c.ID, c.ExpectedVersion, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled).Scan(&out.ID, &out.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleConflict // Báo lỗi xung đột phiên bản
	}
	if err != nil {
		return out, err
	}

	// Bước 3: Ghi nhận một trang mới vào sổ cái kiểm toán `rule_revisions`
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}

	// Bước 4: Chốt giao dịch thành công
	return out, tx.Commit()
}

// ─── 7. Publish Rules (Đóng gói & Phát hành đợt luật mới) ─────────────────────

// publishRuleRecord là khuôn mẫu bản ghi được đóng gói riêng cho bộ phát hành WAF.
type publishRuleRecord struct {
	ID       int64  `json:"id"`
	Path     string `json:"path"`
	Action   string `json:"action"`
	Score    int    `json:"score"`
	Priority int    `json:"priority"`
}

// Reserve khởi tạo quy trình "Đóng gói phát hành" (Tương đương lập lệnh xuất kho hàng loạt).
//
// [Góc nhìn kinh tế / quản lý chuỗi cung ứng]:
// - Giống như việc đóng gói một lô hàng lớn xuất xưởng:
//   1. Kiểm tra mã lệnh xuất kho (Idempotency): Nếu lệnh này đã đóng gói rồi thì trả về kết quả ngay.
//   2. Kiểm định chất lượng: Đảm bảo toàn bộ các luật đang bật đều đã đạt chuẩn vận hành (Runtime Ready).
//   3. Chụp ảnh tức thời (Snapshot): Cố định danh sách các luật đang Bật tại thời điểm này đưa vào lô xuất kho.
//   4. Đóng gói nén thành Payload (gói dữ liệu chuẩn) có kích thước dưới 64KB để chuyển cho máy biên dịch.
//   5. Trạng thái tạm thời là 'pending' (chờ đóng dấu niêm phong cuối cùng).
func (r *ruleRepository) Reserve(ctx context.Context, c entity.PublishRulesCommand) (entity.PublishRulesSource, error) {
	var out entity.PublishRulesSource
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 1: Kiểm tra xem lô phát hành này đã từng được tạo chưa
	err = tx.QueryRowContext(ctx, "SELECT id,payload,state,digest FROM ruleset_releases WHERE request_key=?", c.RequestKey).Scan(&out.ID, &out.Payload, &out.State, &out.Digest)
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	// Bước 2: Kiểm tra tính an toàn vận hành:
	// Tuyệt đối không cho phép phát hành nếu có bất kỳ luật nào chưa sẵn sàng (runtime_ready = 0)
	var unsupported int
	if err = tx.QueryRowContext(ctx, `WITH selected AS(SELECT id,version FROM rules WHERE enabled=1)
	SELECT count(*) FROM selected s JOIN rule_definitions d ON d.rule_id=s.id AND d.version=s.version WHERE d.runtime_ready=0`).Scan(&unsupported); err != nil {
		return out, err
	}
	if unsupported > 0 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 3: Tạo bản ghi phát hành mới với trạng thái đang chờ xử lý ('pending')
	if err = tx.QueryRowContext(ctx, "INSERT INTO ruleset_releases(request_key,state) VALUES(?,'pending') RETURNING id", c.RequestKey).Scan(&out.ID); err != nil {
		return out, err
	}

	// Bước 4: Chụp lại danh sách các luật đang Bật tại thời điểm này gắn vào lô phát hành
	if _, err = tx.ExecContext(ctx, `INSERT INTO release_rules(release_id,rule_id,version) SELECT ?,id,version FROM rules WHERE enabled=1`, out.ID); err != nil {
		return out, err
	}

	// Bước 5: Lấy chi tiết nội dung các luật đã chọn, sắp xếp theo thứ tự ưu tiên (Priority)
	rows, err := tx.QueryContext(ctx, `WITH selected AS(SELECT rule_id,version FROM release_rules WHERE release_id=?)
SELECT v.rule_id,v.path,v.action,v.score,v.priority FROM selected s JOIN rule_revisions v ON v.rule_id=s.rule_id AND v.version=s.version ORDER BY v.priority,v.rule_id`, out.ID)
	if err != nil {
		return out, err
	}
	rules := []publishRuleRecord{}
	for rows.Next() {
		var x publishRuleRecord
		if err = rows.Scan(&x.ID, &x.Path, &x.Action, &x.Score, &x.Priority); err != nil {
			rows.Close()
			return out, err
		}
		rules = append(rules, x)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}

	// Bước 6: Đóng gói toàn bộ danh sách luật thành chuỗi nhị phân JSON (Payload)
	out.Payload, err = json.Marshal(struct {
		SchemaVersion int                 `json:"schema_version"`
		Generation    int64               `json:"generation"`
		Rules         []publishRuleRecord `json:"rules"`
	}{2, out.ID, rules})
	if err != nil {
		return out, err
	}

	// Kiểm tra trần dung lượng gói hàng (tối đa 64KB)
	if len(out.Payload) > 65536 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 7: Cập nhật gói dữ liệu vào cơ sở dữ liệu
	if _, err = tx.ExecContext(ctx, "UPDATE ruleset_releases SET payload=? WHERE id=?", out.Payload, out.ID); err != nil {
		return out, err
	}
	out.State = "pending"
	return out, tx.Commit()
}

// Complete hoàn tất quy trình phát hành: dán nhãn tem niêm phong (Digest SHA-256) và chuyển sang trạng thái 'ready'.
// [Góc nhìn kinh tế]: Giống như dán tem niêm phong kiểm định chất lượng lên thùng hàng trước khi chuyển đi.
func (r *ruleRepository) Complete(ctx context.Context, id int64, digest string) error {
	_, err := r.writer.ExecContext(ctx, "UPDATE ruleset_releases SET digest=?,state='ready' WHERE id=? AND state='pending'", digest, id)
	return err
}

// ─── 8. Release Detail (Kiểm tra trạng thái lô phát hành) ─────────────────────

// Release tra cứu thông tin chi tiết và tiến độ phân phối của một lô phát hành đến các máy chủ biên WAF.
func (r *ruleRepository) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	var x entity.ReleaseDetailResult
	err := r.reader.QueryRowContext(ctx, `WITH target AS(SELECT * FROM ruleset_releases WHERE id=?)
SELECT t.id,t.state,t.digest,t.created_at,n.phase FROM target t LEFT JOIN node_activation n ON n.release_id=t.id`, q.ID).Scan(&x.ID, &x.State, &x.Digest, &x.CreatedAt, &x.ActivationPhase)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	return x, err
}

// ─── 9. Create Rule Definition (Tạo luật nâng cao đa điều kiện v2) ─────────────

// CreateDefinition xử lý tạo luật bảo vệ WAF thế hệ 2 (hỗ trợ nhiều điều kiện soi chiếu IP, Header, Cookie, Method...).
//
// [Góc nhìn kinh tế / quản trị]:
// Tương đương việc ký kết một hợp đồng thương mại đa điều khoản phức tạp:
// - Soi xét đầy đủ tính bất biến Idempotency (chống tạo 2 lần).
// - Khống chế trần 1024 luật của toàn hệ thống.
// - Lưu trữ đồng thời bảng tổng quan (rules), bảng kiểm toán (rule_revisions), bảng chi tiết điều kiện (rule_definitions)
//   và biên lai đối soát (definition_creates) trong một giao dịch nguyên tử trọn vẹn (Atomic Transaction).
func (r *ruleRepository) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand, issues []string, path string) (entity.CreateRuleDefinitionResult, error) {
	out := entity.CreateRuleDefinitionResult{Version: 1, State: "saved", RuntimeReady: len(issues) == 0, RuntimeIssues: issues}

	// Bước 1: Tính mã băm định danh của yêu cầu tạo hợp đồng luật
	raw, err := json.Marshal(c)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])

	// Bước 2: Bắt đầu giao dịch an toàn (Transaction)
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 3: Kiểm tra chống gửi lặp lại (Idempotency):
	// Nếu cùng RequestKey: kiểm tra xem nội dung băm hash có trùng khớp với lần gửi trước hay không
	var previousHash, previousIssues string
	err = tx.QueryRowContext(ctx, `WITH prior AS(SELECT * FROM definition_creates WHERE request_key=?)
 SELECT p.rule_id,p.version,p.request_hash,d.runtime_ready,d.runtime_issues FROM prior p JOIN rule_definitions d ON d.rule_id=p.rule_id AND d.version=p.version`, c.RequestKey).Scan(&out.ID, &out.Version, &previousHash, &out.RuntimeReady, &previousIssues)
	if err == nil {
		if hash != previousHash {
			return out, taxonomy.ErrRuleConflict // Xung đột nội dung trên cùng 1 chìa khóa yêu cầu
		}
		if err = json.Unmarshal([]byte(previousIssues), &out.RuntimeIssues); err != nil {
			return out, err
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	// Bước 4: Kiểm soát hạn mức tối đa hệ thống (Quota Check: không vượt quá 1024 luật)
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 5: Chèn thông tin chung vào bảng luật chính `rules`
	if err = tx.QueryRowContext(ctx, `INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled)
 VALUES(1,?,?,?,?,?,?,?,?,?) RETURNING id`, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, path, c.Enabled).Scan(&out.ID); err != nil {
		return out, err
	}

	// Bước 6: Ghi nhận vào sổ cái lịch sử `rule_revisions`
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}

	// Bước 7: Chuẩn hóa danh sách điều kiện chi tiết sang dạng JSON để lưu vào SQLite
	condRecords := make([]ruleConditionRecord, len(c.Conditions))
	for i, cond := range c.Conditions {
		condRecords[i] = ruleConditionRecord{
			Field:      cond.Field,
			Operator:   cond.Operator,
			Value:      cond.Value,
			HeaderName: cond.HeaderName,
		}
	}
	conditions, err := json.Marshal(condRecords)
	if err != nil {
		return out, err
	}
	reasons, err := json.Marshal(issues)
	if err != nil {
		return out, err
	}

	// Bước 8: Lưu trữ các điều khoản chi tiết (IP nguồn, Header, Domain, Method...) vào bảng `rule_definitions`
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_definitions(rule_id,version,logic_mode,conditions_json,source_ip,host_domain,path_prefix,http_method,response_code,custom_response,log_event,add_to_reputation,runtime_ready,runtime_issues)
 VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?)`, out.ID, c.LogicMode, string(conditions), c.SourceIP, c.HostDomain, c.PathPrefix, c.HTTPMethod, c.ResponseCode, c.CustomResponse, c.LogEvent, c.AddToReputation, out.RuntimeReady, string(reasons)); err != nil {
		return out, err
	}

	// Bước 9: Lưu vết biên lai khởi tạo vào bảng `definition_creates` để phục vụ đối soát Idempotency
	if _, err = tx.ExecContext(ctx, "INSERT INTO definition_creates(request_key,request_hash,rule_id,version) VALUES(?,?,?,1)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}

	// Bước 10: Hoàn tất chốt sổ giao dịch thành công
	return out, tx.Commit()
}
