package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
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

// ruleRepository chịu trách nhiệm truy vấn, lưu trữ và cập nhật dữ liệu cho các luật WAF.
//
// Hệ thống sử dụng mô hình tách biệt kết nối cơ sở dữ liệu:
// - writer: Kết nối chuyên thực hiện các thao tác ghi, sửa, xóa (CREATE, UPDATE, PUBLISH).
// - reader: Kết nối chuyên phục vụ các thao tác đọc và tra cứu (LIST, DETAIL, STATS, HISTORY).
// Việc tách biệt này giúp tối ưu hiệu năng đọc và tránh nghẽn luồng khi có nhiều truy vấn đồng thời.
type ruleRepository struct {
	writer *sql.DB // Kết nối cơ sở dữ liệu cho thao tác ghi dữ liệu
	reader *sql.DB // Kết nối cơ sở dữ liệu cho thao tác đọc dữ liệu
}

// NewRuleRepository khởi tạo đối tượng repository với hai kết nối đọc và ghi riêng biệt,
// trả về interface repo.RuleRepository để các tầng trên phụ thuộc vào abstraction thay vì struct cụ thể.
func NewRuleRepository(writer, reader *sql.DB) repo.RuleRepository {
	return &ruleRepository{writer: writer, reader: reader}
}

// ─── 1. List Rules (Tra cứu danh sách luật & Phân trang) ──────────────────────

// List thực hiện tìm kiếm, lọc theo tiêu chí và phân trang danh sách luật bảo vệ WAF.
//
// Câu truy vấn sử dụng kỹ thuật CTE (Common Table Expression) để thực hiện cả 3 nhiệm vụ trong một lần truy vấn:
// 1. Lọc các bản ghi theo tiêu chí người dùng yêu cầu (tên, nhóm, hành vi, mức độ, trạng thái).
// 2. Phân trang theo con trỏ ID (Cursor-based pagination).
// 3. Đếm tổng số bản ghi thỏa mãn điều kiện để hiển thị tổng số lượng.
func (r *ruleRepository) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	out := entity.ListRulesResult{Items: []entity.ListRulesItem{}}

	// Câu truy vấn CTE gồm 3 bảng tạm:
	// - filtered: Lọc các dòng từ bảng "rules", kết hợp bảng "rule_definitions" để xác định phiên bản schema (v1 hoặc v2)
	//   và trạng thái sẵn sàng vận hành (runtime_ready).
	// - page: Lấy các dòng thỏa mãn có ID lớn hơn mốc 'After', giới hạn số lượng bằng 'Limit + 1' để kiểm tra trang sau.
	// - totals: Đếm tổng số lượng bản ghi hợp lệ sau khi lọc.
	const query = `
		WITH filtered AS (
			SELECT 
				r.*,
				CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END AS schema_version,
				coalesce(d.runtime_ready, 1) AS runtime_ready
			FROM rules r
			LEFT JOIN rule_definitions d 
				ON d.rule_id = r.id AND d.version = r.version
			WHERE NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=r.id) AND (? = '' OR instr(lower(name), lower(?)) > 0)
			  AND (? = '' OR rule_group = ?)
			  AND (? = '' OR action = ?)
			  AND (? = '' OR severity = ?)
			  AND (? = '' OR enabled = CASE ? WHEN 'true' THEN 1 ELSE 0 END)
		),
		page AS (
			SELECT * 
			FROM filtered 
			WHERE id > ? 
			ORDER BY id 
			LIMIT ?
		),
		totals AS (
			SELECT count(*) AS total 
			FROM filtered
		)
		SELECT 
			totals.total,
			coalesce(id, 0),
			coalesce(version, 0),
			coalesce(name, ''),
			coalesce(description, ''),
			coalesce(rule_group, ''),
			coalesce(action, ''),
			coalesce(severity, ''),
			coalesce(score, 0),
			coalesce(priority, 0),
			coalesce(path, ''),
			coalesce(enabled, 0),
			coalesce(updated_at, ''),
			coalesce(schema_version, 0),
			coalesce(runtime_ready, 0)
		FROM totals 
		LEFT JOIN page ON 1 = 1 
		ORDER BY id;
	`

	// Bước 1: Gửi câu truy vấn tới kết nối đọc (reader)
	rows, err := r.reader.QueryContext(
		ctx,
		query,
		q.Search, q.Search,
		q.Group, q.Group,
		q.Action, q.Action,
		q.Severity, q.Severity,
		q.Enabled, q.Enabled,
		q.After,
		q.Limit+1,
	)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	// Bước 2: Quét từng dòng dữ liệu và nạp vào danh sách kết quả
	for rows.Next() {
		var x entity.ListRulesItem
		if err = rows.Scan(
			&out.Total,
			&x.ID,
			&x.Version,
			&x.Name,
			&x.Description,
			&x.Group,
			&x.Action,
			&x.Severity,
			&x.Score,
			&x.Priority,
			&x.Path,
			&x.Enabled,
			&x.UpdatedAt,
			&x.SchemaVersion,
			&x.RuntimeReady,
		); err != nil {
			return out, err
		}
		// Bỏ qua dòng rỗng nếu kết quả không có dữ liệu (ID = 0 do LEFT JOIN bảng rỗng)
		if x.ID != 0 {
			out.Items = append(out.Items, x)
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}

	// Bước 3: Xử lý phân trang con trỏ (NextAfter)
	// Truy vấn lấy 'Limit + 1' dòng: nếu số dòng trả về lớn hơn Limit, nghĩa là vẫn còn dữ liệu ở trang tiếp theo.
	// Ta cắt bỏ dòng thứ 'Limit + 1' và lấy ID của dòng cuối cùng làm mốc đánh dấu 'NextAfter'.
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextAfter = strconv.FormatInt(out.Items[len(out.Items)-1].ID, 10)
	}
	return out, nil
}

// ─── 2. Rule Detail (Xem hồ sơ chi tiết của 1 luật) ──────────────────────────

// ruleConditionRecord là cấu trúc nội bộ lưu trữ/giải mã các điều kiện lọc (IP, Header, Method, Regex...) từ JSON trong CSDL.
type ruleConditionRecord struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	HeaderName string `json:"header_name"`
}

// Detail tải toàn bộ thông tin cấu hình chi tiết của một luật bảo vệ cụ thể dựa theo ID.
func (r *ruleRepository) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	var x entity.RuleDetailResult
	var conditions, issues string

	// Câu truy vấn CTE tìm luật theo ID từ bảng "rules" và kết hợp với bảng mở rộng "rule_definitions"
	const query = `
		WITH target AS (
			SELECT * 
			FROM rules 
			WHERE id = ? AND NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=rules.id)
		)
		SELECT 
			t.id,
			t.version,
			t.name,
			t.description,
			t.rule_group,
			t.action,
			t.severity,
			t.score,
			t.priority,
			t.path,
			t.enabled,
			t.updated_at,
			CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END,
			coalesce(d.runtime_ready, 1),
			coalesce(d.runtime_issues, '[]'),
			coalesce(d.logic_mode, 'all'),
			coalesce(d.conditions_json, '[]'),
			coalesce(d.source_ip, ''),
			coalesce(d.host_domain, ''),
			coalesce(d.path_prefix, ''),
			coalesce(d.http_method, ''),
			d.response_code,
			coalesce(d.custom_response, ''),
			coalesce(d.log_event, 0),
			coalesce(d.add_to_reputation, 0),
 (SELECT count(*) FROM policies p WHERE EXISTS(SELECT 1 FROM json_each(p.document,'$.rule_ids') j WHERE CAST(j.value AS INTEGER)=t.id)),
 COALESCE((SELECT updated_at FROM rule_revisions WHERE rule_id=t.id ORDER BY version LIMIT 1),''),
 COALESCE((SELECT actor FROM rule_revisions WHERE rule_id=t.id ORDER BY version LIMIT 1),'')
		FROM target t 
		LEFT JOIN rule_definitions d 
			ON d.rule_id = t.id AND d.version = t.version;
	`

	// Bước 1: Thực hiện truy vấn đọc 1 dòng dữ liệu
	err := r.reader.QueryRowContext(ctx, query, q.ID).Scan(
		&x.ID,
		&x.Version,
		&x.Name,
		&x.Description,
		&x.Group,
		&x.Action,
		&x.Severity,
		&x.Score,
		&x.Priority,
		&x.Path,
		&x.Enabled,
		&x.UpdatedAt,
		&x.SchemaVersion,
		&x.RuntimeReady,
		&issues,
		&x.LogicMode,
		&conditions,
		&x.SourceIP,
		&x.HostDomain,
		&x.PathPrefix,
		&x.HTTPMethod,
		&x.ResponseCode,
		&x.CustomResponse,
		&x.LogEvent,
		&x.AddToReputation, &x.AssignedPolicies, &x.CreatedAt, &x.CreatedBy,
	)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	if err != nil {
		return x, err
	}

	// Bước 2: Giải mã chuỗi JSON điều kiện kiểm tra (Conditions) thành danh sách cấu trúc có kiểu dữ liệu
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

	// Bước 3: Giải mã danh sách cảnh báo hoặc lỗi tính hợp lệ khi vận hành (Runtime Issues nếu có)
	if err = json.Unmarshal([]byte(issues), &x.RuntimeIssues); err != nil {
		return x, err
	}

	// Bước 4: Xử lý tương thích ngược cho luật thế hệ 1 (Schema v1 chỉ có đường dẫn đơn giản)
	if x.SchemaVersion == 1 {
		x.Conditions = []entity.RuleDetailCondition{{Field: "path", Operator: "equals", Value: x.Path}}
		if x.Action == "block" {
			code := 403 // Hành vi chặn mặc định của v1 luôn trả về mã HTTP 403 Forbidden
			x.ResponseCode = &code
		}
	}
	return x, err
}

// ─── 3. Rule Stats (Báo cáo thống kê tổng hợp số lượng luật) ─────────────────

// Stats tạo dữ liệu thống kê số lượng luật theo trạng thái hiện tại và tính mức tăng/giảm so với đầu tháng.
//
// Phương thức này gom toàn bộ tính toán vào một câu lệnh SQL CTE duy nhất:
// - Đảm bảo dữ liệu thống kê có tính nhất quán cao tại cùng một thời điểm (Snapshot).
// - Không bị sai lệch số liệu nếu có thao tác ghi hoặc sửa luật diễn ra đồng thời.
func (r *ruleRepository) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	var x entity.RuleStatsResult
	if q.AsOf.IsZero() {
		return x, taxonomy.ErrRuleInvalid
	}

	// Bước 1: Xác định các mốc thời gian:
	// - asOf: Thời điểm yêu cầu lập báo cáo.
	// - comparisonBefore: Thời điểm 00:00:00 UTC ngày đầu tiên của tháng hiện tại (dùng làm mốc so sánh).
	asOf := q.AsOf.UTC()
	x.AsOf = asOf.Format(time.RFC3339Nano)
	x.ComparisonBefore = time.Date(asOf.Year(), asOf.Month(), 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	// Bước 2: Câu truy vấn CTE tổng hợp:
	// - coverage: Kiểm tra xem lịch sử dữ liệu di trú (migrations) đã đủ từ trước đầu tháng hay chưa.
	// - winners: Tìm phiên bản mới nhất của từng luật tồn tại trước ngày đầu tháng trong bảng lịch sử 'rule_revisions'.
	// - baseline: Thống kê số lượng luật (tổng, bật, log, block) tại mốc đầu tháng.
	// - totals: Thống kê số lượng luật (tổng, bật, log, block) ở thời điểm hiện tại từ bảng 'rules'.
	// - Phần SELECT cuối cùng tính hiệu số chênh lệch: Delta = totals - baseline.
	const query = `
		WITH
		coverage AS (
			SELECT coalesce(min(julianday(applied_at)) <= julianday(?), 0) AS available 
			FROM schema_migrations 
			WHERE version = 2
		),
		winners AS (
			SELECT rule_id, max(version) AS version 
			FROM rule_revisions 
			WHERE julianday(updated_at) < julianday(?) 
			GROUP BY rule_id
		),
		baseline AS (
			SELECT 
				count(*) AS total,
				coalesce(sum(r.enabled), 0) AS enabled,
				coalesce(sum(r.enabled = 1 AND r.action = 'log'), 0) AS logs,
				coalesce(sum(r.enabled = 1 AND r.action = 'block'), 0) AS blocks
			FROM rule_revisions r 
			JOIN winners w 
				ON w.rule_id = r.rule_id AND w.version = r.version
 WHERE NOT EXISTS(SELECT 1 FROM rule_deletions x WHERE x.rule_id=r.rule_id AND julianday(x.deleted_at)<julianday(?))
		),
		totals AS (
			SELECT 
				count(*) AS total,
				coalesce(sum(enabled), 0) AS enabled,
				coalesce(sum(enabled = 1 AND action = 'log'), 0) AS logs,
				coalesce(sum(enabled = 1 AND action = 'block'), 0) AS blocks 
			FROM rules WHERE NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=rules.id)
		)
		SELECT 
			t.total,
			t.enabled,
			t.logs,
			t.blocks,
			c.available,
			CASE WHEN c.available THEN t.total - b.total END,
			CASE WHEN c.available THEN t.enabled - b.enabled END,
			CASE WHEN c.available THEN t.logs - b.logs END,
			CASE WHEN c.available THEN t.blocks - b.blocks END
		FROM totals t 
		CROSS JOIN baseline b 
		CROSS JOIN coverage c;
	`

	err := r.reader.QueryRowContext(ctx, query, x.ComparisonBefore, x.ComparisonBefore, x.ComparisonBefore).Scan(
		&x.Total,
		&x.Enabled,
		&x.Log,
		&x.Block,
		&x.HistoryAvailable,
		&x.TotalDelta,
		&x.EnabledDelta,
		&x.LogDelta,
		&x.BlockDelta,
	)
	return x, err
}

// ─── 4. Rule History (Lịch sử các phiên bản thay đổi) ─────────────────────────

// History trích xuất danh sách các phiên bản chỉnh sửa của một luật theo thứ tự thời gian.
func (r *ruleRepository) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	out := entity.RuleHistoryResult{Items: []entity.RuleHistoryRecord{}}

	// Câu truy vấn CTE:
	// - selected: Chọn các bản ghi lịch sử thuộc luật có ID chỉ định, kết hợp thông tin chi tiết từ rule_definitions nếu có.
	// - SELECT: Sắp xếp phiên bản giảm dần (từ mới nhất đến cũ nhất) và giới hạn số lượng bằng 'Limit + 1'.
	const query = `
		WITH selected AS (
			SELECT r.version, r.name, r.description, r.rule_group, r.action, r.severity, r.priority, r.path, r.enabled, r.actor, r.updated_at,
			       COALESCE(d.logic_mode, 'all') as logic_mode,
			       COALESCE(d.conditions_json, '[]') as conditions_json,
			       CASE WHEN d.rule_id IS NULL AND r.action='block' THEN 403 ELSE d.response_code END as response_code,
			       COALESCE(d.custom_response, '') as custom_response,r.score,CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END AS schema_version,coalesce(d.source_ip,'') AS source_ip,coalesce(d.host_domain,'') AS host_domain,coalesce(d.path_prefix,'') AS path_prefix,coalesce(d.http_method,'') AS http_method,coalesce(d.log_event,0) AS log_event,coalesce(d.add_to_reputation,0) AS add_to_reputation
			FROM rule_revisions r
			LEFT JOIN rule_definitions d ON d.rule_id = r.rule_id AND d.version = r.version
			WHERE r.rule_id = ? 
			  AND (? = 0 OR r.version < ?)
		)
		SELECT version, name, description, rule_group, action, severity, priority, path, enabled, actor, updated_at, logic_mode, conditions_json, response_code, custom_response,score,schema_version,source_ip,host_domain,path_prefix,http_method,log_event,add_to_reputation
		FROM selected 
		ORDER BY version DESC 
		LIMIT ?;
	`

	// Bước 1: Tra cứu lịch sử từ bảng 'rule_revisions' và 'rule_definitions'
	rows, err := r.reader.QueryContext(ctx, query, q.ID, q.Before, q.Before, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	// Bước 2: Đọc từng bản ghi lịch sử
	for rows.Next() {
		var item entity.RuleHistoryRecord
		if err = rows.Scan(
			&item.Version, &item.Name, &item.Description, &item.Group, &item.Action, &item.Severity,
			&item.Priority, &item.Path, &item.Enabled, &item.Actor, &item.UpdatedAt,
			&item.LogicMode, &item.ConditionsJSON, &item.ResponseCode, &item.CustomResponse, &item.Score, &item.SchemaVersion, &item.SourceIP, &item.HostDomain, &item.PathPrefix, &item.HTTPMethod, &item.LogEvent, &item.AddToReputation,
		); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}

	// Bước 3: Đặt mốc con trỏ 'NextBefore' nếu còn bản ghi cũ hơn vượt quá số lượng Limit
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextBefore = out.Items[q.Limit-1].Version
	}
	return out, nil
}

// ─── 5. Create Rule (Thêm mới luật bảo vệ WAF) ────────────────────────────────

// Create thêm mới một luật bảo vệ WAF vào cơ sở dữ liệu.
//
// Quy trình xử lý gồm các bước:
//  1. Chống gửi lặp (Idempotency): Dùng mã băm SHA-256 để phát hiện và xử lý các yêu cầu gửi trùng.
//  2. Kiểm soát giới hạn: Đảm bảo tổng số luật trong hệ thống không vượt quá 1024 luật.
//  3. Toàn vẹn giao dịch (ACID Transaction): Ghi đồng thời vào bảng chính (rules),
//     bảng lịch sử phiên bản (rule_revisions) và bảng chống lặp (rule_creates).
func (r *ruleRepository) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	var out entity.CreateRuleResult

	// Bước 1: Tính mã băm SHA-256 của nội dung yêu cầu tạo luật
	raw, _ := json.Marshal(c)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])

	// Bước 2: Mở một transaction ghi dữ liệu
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 3: Kiểm tra chống gửi trùng lặp (Idempotency Check)
	// Nếu RequestKey đã tồn tại trong bảng 'rule_creates':
	// - Khớp mã băm hash -> Yêu cầu gửi lại y hệt, trả về kết quả đã tạo trước đó mà không tạo thêm dòng mới.
	// - Khác mã băm hash -> Báo lỗi xung đột (ErrRuleConflict) vì cùng một mã RequestKey nhưng nội dung khác nhau.
	var prior string
	err = tx.QueryRowContext(ctx, "SELECT rule_id, request_hash FROM rule_creates WHERE request_key = ?", c.RequestKey).Scan(&out.ID, &prior)
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

	// Bước 4: Kiểm tra giới hạn số lượng luật (tối đa 1024 luật)
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules WHERE NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=rules.id)").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 5: Chèn bản ghi luật mới vào bảng chính 'rules' với version = 1
	const insertRuleQuery = `
		INSERT INTO rules (
			version, name, description, rule_group, action, severity, score, priority, path, enabled
		)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		RETURNING id, version;
	`
	err = tx.QueryRowContext(
		ctx,
		insertRuleQuery,
		c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled,
	).Scan(&out.ID, &out.Version)
	if err != nil {
		return out, err
	}

	// Bước 6: Lưu bản sao phiên bản đầu tiên vào bảng lịch sử 'rule_revisions'
	const insertRevisionQuery = `
		INSERT INTO rule_revisions 
		SELECT id, version, name, description, rule_group, action, severity, score, priority, path, enabled, updated_at, 'management-token' 
		FROM rules 
		WHERE id = ?;
	`
	if _, err = tx.ExecContext(ctx, insertRevisionQuery, out.ID); err != nil {
		return out, err
	}

	// Bước 7: Lưu biên lai vào bảng 'rule_creates' để phục vụ đối soát Idempotency cho các lần gọi sau
	if _, err = tx.ExecContext(ctx, "INSERT INTO rule_creates (request_key, request_hash, rule_id) VALUES (?, ?, ?)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}

	// Bước 8: Xác nhận transaction thành công (Commit)
	return out, tx.Commit()
}

// ─── 6. Update Rule (Cập nhật chỉnh sửa luật hiện có) ─────────────────────────

// Update cập nhật nội dung cấu hình của một luật bảo vệ WAF.
//
// Cơ chế bảo vệ:
//  1. Khóa lạc quan (Optimistic Concurrency Control): Chỉ cho phép cập nhật nếu phiên bản hiện tại
//     trong cơ sở dữ liệu khớp đúng với 'ExpectedVersion'. Nếu người khác đã cập nhật trước đó,
//     hệ thống sẽ phát hiện xung đột và từ chối ghi đè (ErrRuleConflict).
//  2. Bảo vệ luật thế hệ 2: Không cho phép dùng hàm cập nhật v1 để ghi đè lên các luật có cấu hình chi tiết v2.
func (r *ruleRepository) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	var out entity.UpdateRuleResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 1: Kiểm tra xem luật có thuộc thế hệ 2 (có bản ghi trong 'rule_definitions') không.
	// Nếu có, từ chối cập nhật qua giao diện v1 để tránh làm mất các điều kiện nâng cao.
	var definitions int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rule_definitions WHERE rule_id = ?", c.ID).Scan(&definitions); err != nil {
		return out, err
	}
	if definitions > 0 {
		return out, taxonomy.ErrRuleConflict
	}

	// Bước 2: Cập nhật dữ liệu với cơ chế khóa phiên bản lạc quan qua CTE
	// - CTE target: Tìm dòng luật có ID và Version trùng khớp với tham số gửi lên.
	// - UPDATE: Tăng version lên 1 đơn vị, cập nhật các trường thông tin và thời điểm 'updated_at'.
	const updateQuery = `
		WITH target AS (
			SELECT id 
			FROM rules 
			WHERE id = ? AND version = ?
		)
		UPDATE rules 
		SET version = version + 1,
		    name = ?,
		    description = ?,
		    rule_group = ?,
		    action = ?,
		    severity = ?,
		    score = ?,
		    priority = ?,
		    path = ?,
		    enabled = ?,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE id IN (SELECT id FROM target) 
		RETURNING id, version;
	`
	err = tx.QueryRowContext(
		ctx,
		updateQuery,
		c.ID, c.ExpectedVersion, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled,
	).Scan(&out.ID, &out.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleConflict // Xung đột phiên bản: bản ghi đã bị sửa hoặc không tồn tại
	}
	if err != nil {
		return out, err
	}

	// Bước 3: Ghi nhận một bản ghi phiên bản mới vào bảng lịch sử 'rule_revisions'
	const insertRevisionQuery = `
		INSERT INTO rule_revisions 
		SELECT id, version, name, description, rule_group, action, severity, score, priority, path, enabled, updated_at, 'management-token' 
		FROM rules 
		WHERE id = ?;
	`
	if _, err = tx.ExecContext(ctx, insertRevisionQuery, out.ID); err != nil {
		return out, err
	}

	// Bước 4: Hoàn tất transaction thành công (Commit)
	return out, tx.Commit()
}

// Rollback khôi phục cấu hình của một rule về phiên bản cũ (TargetVersion) và tăng version lên 1 (snapshot mới).
func (r *ruleRepository) Rollback(ctx context.Context, c entity.RollbackRuleCommand) (entity.RollbackRuleResult, error) {
	var out entity.RollbackRuleResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// 1. Kiểm tra rule tồn tại
	var currentVersion int64
	err = tx.QueryRowContext(ctx, "SELECT version FROM rules WHERE id = ? AND NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=rules.id)", c.ID).Scan(&currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleNotFound
	}
	if err != nil {
		return out, err
	}

	if currentVersion != c.ExpectedVersion {
		return out, taxonomy.ErrRuleConflict
	}

	// 2. Lấy cấu hình mục tiêu từ rule_revisions
	var revName, revDesc, revGroup, revAction, revSev, revPath string
	var revScore, revPrio, revEnabled int
	const getTargetRev = `
		SELECT name, description, rule_group, action, severity, score, priority, path, enabled
		FROM rule_revisions
		WHERE rule_id = ? AND version = ?;
	`
	err = tx.QueryRowContext(ctx, getTargetRev, c.ID, c.TargetVersion).Scan(
		&revName, &revDesc, &revGroup, &revAction, &revSev, &revScore, &revPrio, &revPath, &revEnabled,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleNotFound
	}
	if err != nil {
		return out, err
	}

	// 3. Cập nhật rules với version = currentVersion + 1
	const updateRule = `
		UPDATE rules
		SET version = version + 1,
		    name = ?,
		    description = ?,
		    rule_group = ?,
		    action = ?,
		    severity = ?,
		    score = ?,
		    priority = ?,
		    path = ?,
		    enabled = ?,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE id = ?
		RETURNING id, version, name, action, enabled;
	`
	var enabledInt int
	actor := c.Actor
	if actor == "" {
		actor = "management-token"
	}
	err = tx.QueryRowContext(ctx, updateRule,
		revName, revDesc, revGroup, revAction, revSev, revScore, revPrio, revPath, revEnabled, c.ID,
	).Scan(&out.ID, &out.Version, &out.Name, &out.Action, &enabledInt)
	if err != nil {
		return out, err
	}
	out.Enabled = enabledInt == 1

	// 4. Lưu bản sao revision mới vào rule_revisions
	const insertNewRev = `
		INSERT INTO rule_revisions 
		SELECT id, version, name, description, rule_group, action, severity, score, priority, path, enabled, updated_at, ?
		FROM rules
		WHERE id = ?;
	`
	if _, err = tx.ExecContext(ctx, insertNewRev, actor, out.ID); err != nil {
		return out, err
	}

	// 5. Nếu target revision có định nghĩa trong rule_definitions, sao chép sang version mới
	const copyDef = `
		INSERT INTO rule_definitions (
			rule_id, version, logic_mode, conditions_json, source_ip, host_domain, path_prefix,
			http_method, response_code, custom_response, log_event, add_to_reputation, runtime_ready, runtime_issues
		)
		SELECT rule_id, ?, logic_mode, conditions_json, source_ip, host_domain, path_prefix,
		       http_method, response_code, custom_response, log_event, add_to_reputation, runtime_ready, runtime_issues
		FROM rule_definitions
		WHERE rule_id = ? AND version = ?;
	`
	if _, err = tx.ExecContext(ctx, copyDef, out.Version, c.ID, c.TargetVersion); err != nil {
		return out, err
	}

	return out, tx.Commit()
}

// ─── 7. Publish Rules (Đóng gói & Phát hành đợt luật mới) ─────────────────────

// publishRuleRecord là khuôn mẫu bản ghi được đóng gói riêng phục vụ biên dịch và phát hành tới các node WAF.
type publishRuleRecord struct {
	ID       int64  `json:"id"`
	Path     string `json:"path"`
	Action   string `json:"action"`
	Score    int    `json:"score"`
	Priority int    `json:"priority"`
}

// Reserve khởi tạo quy trình đóng gói và chuẩn bị phát hành một bộ luật mới.
//
// Các bước thực hiện:
// 1. Kiểm tra tính trùng lặp theo RequestKey (Idempotency).
// 2. Kiểm tra điều kiện vận hành: Không phát hành nếu có luật đang bật nhưng chưa sẵn sàng (runtime_ready = 0).
// 3. Tạo bản ghi phát hành ở trạng thái 'pending'.
// 4. Đóng băng danh sách luật đang bật và phiên bản tương ứng vào bảng 'release_rules'.
// 5. Đóng gói danh sách luật thành chuỗi JSON Payload (giới hạn tối đa 64KB).
func (r *ruleRepository) Reserve(ctx context.Context, c entity.PublishRulesCommand) (entity.PublishRulesSource, error) {
	var out entity.PublishRulesSource
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 1: Kiểm tra xem đợt phát hành với RequestKey này đã từng được tạo chưa
	err = tx.QueryRowContext(ctx, "SELECT id, payload, state, digest FROM ruleset_releases WHERE request_key = ?", c.RequestKey).Scan(&out.ID, &out.Payload, &out.State, &out.Digest)
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	// Bước 2: Kiểm tra tính an toàn:
	// Không cho phép phát hành nếu tồn tại bất kỳ luật nào đang bật nhưng chưa sẵn sàng hoạt động (runtime_ready = 0)
	const checkUnsupportedQuery = `
		WITH selected AS (
			SELECT id, version 
			FROM rules 
			WHERE enabled = 1
		)
		SELECT count(*) 
		FROM selected s 
		JOIN rule_definitions d 
			ON d.rule_id = s.id AND d.version = s.version 
		WHERE d.runtime_ready = 0;
	`
	var unsupported int
	if err = tx.QueryRowContext(ctx, checkUnsupportedQuery).Scan(&unsupported); err != nil {
		return out, err
	}
	if unsupported > 0 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 3: Tạo bản ghi phát hành mới với trạng thái ban đầu là 'pending'
	if err = tx.QueryRowContext(ctx, "INSERT INTO ruleset_releases (request_key, state) VALUES (?, 'pending') RETURNING id", c.RequestKey).Scan(&out.ID); err != nil {
		return out, err
	}

	// Bước 4: Cố định danh sách các luật đang bật tại thời điểm này gắn vào đợt phát hành
	const insertReleaseRulesQuery = `
		INSERT INTO release_rules (release_id, rule_id, version) 
		SELECT ?, id, version 
		FROM rules 
		WHERE enabled = 1;
	`
	if _, err = tx.ExecContext(ctx, insertReleaseRulesQuery, out.ID); err != nil {
		return out, err
	}

	// Bước 5: Đọc chi tiết nội dung các luật đã chọn, sắp xếp theo thứ tự ưu tiên (Priority)
	const selectReleaseRulesQuery = `
		WITH selected AS (
			SELECT rule_id, version 
			FROM release_rules 
			WHERE release_id = ?
		)
		SELECT 
			v.rule_id,
			v.path,
			v.action,
			v.score,
			v.priority 
		FROM selected s 
		JOIN rule_revisions v 
			ON v.rule_id = s.rule_id AND v.version = s.version 
		ORDER BY v.priority, v.rule_id;
	`
	rows, err := tx.QueryContext(ctx, selectReleaseRulesQuery, out.ID)
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

	// Bước 6: Đóng gói toàn bộ danh sách luật thành chuỗi JSON Payload
	out.Payload, err = json.Marshal(struct {
		SchemaVersion int                 `json:"schema_version"`
		Generation    int64               `json:"generation"`
		Rules         []publishRuleRecord `json:"rules"`
	}{2, out.ID, rules})
	if err != nil {
		return out, err
	}

	// Kiểm tra kích thước gói dữ liệu không vượt quá 64KB (65536 bytes)
	if len(out.Payload) > 65536 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 7: Cập nhật chuỗi Payload vào bản ghi phát hành
	if _, err = tx.ExecContext(ctx, "UPDATE ruleset_releases SET payload = ? WHERE id = ?", out.Payload, out.ID); err != nil {
		return out, err
	}
	out.State = "pending"
	return out, tx.Commit()
}

// Complete hoàn tất quy trình phát hành: cập nhật mã băm kiểm tra toàn vẹn (digest) và chuyển trạng thái sang 'ready'.
func (r *ruleRepository) Complete(ctx context.Context, id int64, digest string) error {
	_, err := r.writer.ExecContext(ctx, "UPDATE ruleset_releases SET digest = ?, state = 'ready' WHERE id = ? AND state = 'pending'", digest, id)
	return err
}

// ─── 8. Release Detail (Kiểm tra trạng thái đợt phát hành) ───────────────────

// Release tra cứu thông tin chi tiết và tiến độ kích hoạt trên các node của một đợt phát hành.
func (r *ruleRepository) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	var x entity.ReleaseDetailResult

	// Câu truy vấn CTE lấy thông tin đợt phát hành và thông tin kích hoạt node nếu có
	const query = `
		WITH target AS (
			SELECT * 
			FROM ruleset_releases 
			WHERE id = ?
		)
		SELECT 
			t.id,
			t.state,
			t.digest,
			t.created_at,
			n.phase 
		FROM target t 
		LEFT JOIN node_activation n 
			ON n.release_id = t.id;
	`

	err := r.reader.QueryRowContext(ctx, query, q.ID).Scan(&x.ID, &x.State, &x.Digest, &x.CreatedAt, &x.ActivationPhase)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	return x, err
}

// ─── 9. Create Rule Definition (Tạo luật nâng cao đa điều kiện v2) ─────────────

// CreateDefinition xử lý tạo luật bảo vệ WAF thế hệ 2 (hỗ trợ nhiều điều kiện lọc chi tiết như IP, Header, Method...).
//
// Quy trình xử lý:
// 1. Kiểm tra chống gửi lặp lại (Idempotency) dựa trên RequestKey và mã băm SHA-256.
// 2. Kiểm soát giới hạn tổng số lượng luật (tối đa 1024).
// 3. Mở transaction ghi đồng thời vào:
//   - 'rules': Bảng thông tin chung của luật.
//   - 'rule_revisions': Bảng lưu lịch sử phiên bản.
//   - 'rule_definitions': Bảng lưu các điều kiện lọc chi tiết dạng JSON.
//   - 'definition_creates': Bảng lưu biên lai đối soát Idempotency.
func (r *ruleRepository) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand, issues []string, path string) (entity.CreateRuleDefinitionResult, error) {
	out := entity.CreateRuleDefinitionResult{Version: 1, State: "saved", RuntimeReady: len(issues) == 0, RuntimeIssues: issues}

	// Bước 1: Tính mã băm SHA-256 của yêu cầu tạo luật
	raw, err := json.Marshal(c)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])

	// Bước 2: Bắt đầu transaction ghi dữ liệu
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 3: Kiểm tra chống gửi trùng lặp (Idempotency Check)
	// - CTE prior: Tìm bản ghi trong 'definition_creates' theo RequestKey.
	// - SELECT: Kết hợp với bảng 'rule_definitions' để lấy lại trạng thái và các cảnh báo trước đó nếu có.
	const checkPriorQuery = `
		WITH prior AS (
			SELECT * 
			FROM definition_creates 
			WHERE request_key = ?
		)
		SELECT 
			p.rule_id,
			p.version,
			p.request_hash,
			d.runtime_ready,
			d.runtime_issues 
		FROM prior p 
		JOIN rule_definitions d 
			ON d.rule_id = p.rule_id AND d.version = p.version;
	`
	var previousHash, previousIssues string
	err = tx.QueryRowContext(ctx, checkPriorQuery, c.RequestKey).Scan(&out.ID, &out.Version, &previousHash, &out.RuntimeReady, &previousIssues)
	if err == nil {
		if hash != previousHash {
			return out, taxonomy.ErrRuleConflict // Xung đột: cùng RequestKey nhưng nội dung băm khác nhau
		}
		if err = json.Unmarshal([]byte(previousIssues), &out.RuntimeIssues); err != nil {
			return out, err
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	// Bước 4: Kiểm tra giới hạn số lượng luật hệ thống (tối đa 1024 luật)
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules WHERE NOT EXISTS(SELECT 1 FROM rule_deletions WHERE rule_id=rules.id)").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}

	// Bước 5: Chèn thông tin chung của luật vào bảng chính 'rules' với version = 1
	const insertRuleQuery = `
		INSERT INTO rules (
			version, name, description, rule_group, action, severity, score, priority, path, enabled
		)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
		RETURNING id;
	`
	if err = tx.QueryRowContext(
		ctx,
		insertRuleQuery,
		c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, path, c.Enabled,
	).Scan(&out.ID); err != nil {
		return out, err
	}

	// Bước 6: Ghi nhận bản ghi lịch sử phiên bản đầu tiên vào bảng 'rule_revisions'
	const insertRevisionQuery = `
		INSERT INTO rule_revisions 
		SELECT id, version, name, description, rule_group, action, severity, score, priority, path, enabled, updated_at, ?
		FROM rules 
		WHERE id = ?;
	`
	if _, err = tx.ExecContext(ctx, insertRevisionQuery, c.Actor, out.ID); err != nil {
		return out, err
	}

	// Bước 7: Chuẩn hóa danh sách điều kiện chi tiết sang dạng JSON để lưu trữ
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

	// Bước 8: Lưu thông tin cấu hình chi tiết (IP nguồn, Header, Domain, Method, Response...) vào bảng 'rule_definitions'
	const insertDefinitionQuery = `
		INSERT INTO rule_definitions (
			rule_id, version, logic_mode, conditions_json, source_ip, host_domain, path_prefix, 
			http_method, response_code, custom_response, log_event, add_to_reputation, runtime_ready, runtime_issues
		)
		VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	if _, err = tx.ExecContext(
		ctx,
		insertDefinitionQuery,
		out.ID, c.LogicMode, string(conditions), c.SourceIP, c.HostDomain, c.PathPrefix,
		c.HTTPMethod, c.ResponseCode, c.CustomResponse, c.LogEvent, c.AddToReputation, out.RuntimeReady, string(reasons),
	); err != nil {
		return out, err
	}

	// Bước 9: Lưu biên lai vào bảng 'definition_creates' để phục vụ đối soát chống gửi lặp (Idempotency)
	if _, err = tx.ExecContext(ctx, "INSERT INTO definition_creates (request_key, request_hash, rule_id, version) VALUES (?, ?, ?, 1)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}

	// Bước 10: Xác nhận transaction thành công (Commit)
	return out, tx.Commit()
}

func (r *ruleRepository) UpdateDefinition(ctx context.Context, c entity.UpdateRuleDefinitionCommand, issues []string, path string) (entity.UpdateRuleDefinitionResult, error) {
	out := entity.UpdateRuleDefinitionResult{Version: 1, State: "saved", RuntimeReady: len(issues) == 0, RuntimeIssues: issues}

	// Bước 1: Tính mã băm SHA-256 của yêu cầu tạo luật
	raw, err := json.Marshal(c)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])

	// Bước 2: Bắt đầu transaction ghi dữ liệu
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	// Bước 3: Kiểm tra chống gửi trùng lặp (Idempotency Check)
	// - CTE prior: Tìm bản ghi trong 'definition_updates' theo RequestKey.
	// - SELECT: Kết hợp với bảng 'rule_definitions' để lấy lại trạng thái và các cảnh báo trước đó nếu có.
	const checkPriorQuery = `
		WITH prior AS (
			SELECT * 
			FROM definition_updates 
			WHERE request_key = ?
		)
		SELECT 
			p.rule_id,
			p.version,
			p.request_hash,
			d.runtime_ready,
			d.runtime_issues 
		FROM prior p 
		JOIN rule_definitions d 
			ON d.rule_id = p.rule_id AND d.version = p.version;
	`
	var previousHash, previousIssues string
	err = tx.QueryRowContext(ctx, checkPriorQuery, c.RequestKey).Scan(&out.ID, &out.Version, &previousHash, &out.RuntimeReady, &previousIssues)
	if err == nil {
		if hash != previousHash {
			return out, taxonomy.ErrRuleConflict // Xung đột: cùng RequestKey nhưng nội dung băm khác nhau
		}
		if err = json.Unmarshal([]byte(previousIssues), &out.RuntimeIssues); err != nil {
			return out, err
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}

	err = tx.QueryRowContext(ctx, `
		WITH target AS (
			SELECT id
			FROM rules
			WHERE id = ?
			  AND version = ?
			  AND NOT EXISTS (
				SELECT 1 FROM rule_deletions WHERE rule_id = rules.id
			  )
		)
		UPDATE rules
		SET version = version + 1,
		    name = ?,
		    description = ?,
		    rule_group = ?,
		    action = ?,
		    severity = ?,
		    score = ?,
		    priority = ?,
		    path = ?,
		    enabled = ?,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE id IN (SELECT id FROM target)
		RETURNING id, version`,
		c.ID, c.ExpectedVersion, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, path, c.Enabled).Scan(&out.ID, &out.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleConflict
	}
	if err != nil {
		return out, err
	}

	// Bước 6: Ghi nhận bản ghi lịch sử phiên bản đầu tiên vào bảng 'rule_revisions'
	const insertRevisionQuery = `
		INSERT INTO rule_revisions 
		SELECT id, version, name, description, rule_group, action, severity, score, priority, path, enabled, updated_at, ?
		FROM rules 
		WHERE id = ?;
	`
	if _, err = tx.ExecContext(ctx, insertRevisionQuery, c.Actor, out.ID); err != nil {
		return out, err
	}

	// Bước 7: Chuẩn hóa danh sách điều kiện chi tiết sang dạng JSON để lưu trữ
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

	// Bước 8: Lưu thông tin cấu hình chi tiết (IP nguồn, Header, Domain, Method, Response...) vào bảng 'rule_definitions'
	const insertDefinitionQuery = `
		INSERT INTO rule_definitions (
			rule_id, version, logic_mode, conditions_json, source_ip, host_domain, path_prefix, 
			http_method, response_code, custom_response, log_event, add_to_reputation, runtime_ready, runtime_issues
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	if _, err = tx.ExecContext(
		ctx,
		insertDefinitionQuery,
		out.ID, out.Version, c.LogicMode, string(conditions), c.SourceIP, c.HostDomain, c.PathPrefix,
		c.HTTPMethod, c.ResponseCode, c.CustomResponse, c.LogEvent, c.AddToReputation, out.RuntimeReady, string(reasons),
	); err != nil {
		return out, err
	}

	// Bước 9: Lưu biên lai vào bảng 'definition_updates' để phục vụ đối soát chống gửi lặp (Idempotency)
	if _, err = tx.ExecContext(ctx, "INSERT INTO definition_updates (request_key, request_hash, rule_id, version) VALUES (?, ?, ?, ?)", c.RequestKey, hash, out.ID, out.Version); err != nil {
		return out, err
	}

	// Bước 10: Xác nhận transaction thành công (Commit)
	return out, tx.Commit()
}

func (r *ruleRepository) Delete(ctx context.Context, c entity.DeleteRuleCommand) (entity.DeleteRuleResult, error) {
	var out entity.DeleteRuleResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var referenced int
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM policies p,json_each(p.document,'$.rule_ids') j WHERE CAST(j.value AS INTEGER)=?
 `, c.ID).Scan(&referenced)
	if err != nil {
		return out, err
	}
	if referenced > 0 {
		return out, taxonomy.ErrRuleConflict
	}
	err = tx.QueryRowContext(ctx, `
		WITH target AS (
			SELECT id
			FROM rules
			WHERE id = ?
			  AND version = ?
			  AND NOT EXISTS (
				SELECT 1 FROM rule_deletions WHERE rule_id = rules.id
			  )
		)
		UPDATE rules
		SET enabled = 0,
		    version = version + 1,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE id IN (SELECT id FROM target)
		RETURNING id, version`, c.ID, c.ExpectedVersion).Scan(&out.ID, &out.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleConflict
	}
	if err != nil {
		return out, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,? FROM rules WHERE id=?`, c.Actor, c.ID)
	if err != nil {
		return out, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO rule_definitions SELECT rule_id,?,logic_mode,conditions_json,source_ip,host_domain,path_prefix,http_method,response_code,custom_response,log_event,add_to_reputation,runtime_ready,runtime_issues FROM rule_definitions WHERE rule_id=? AND version=?`, out.Version, c.ID, c.ExpectedVersion)
	if err != nil {
		return out, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO rule_deletions(rule_id,version,actor) VALUES(?,?,?)`, c.ID, out.Version, c.Actor)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
