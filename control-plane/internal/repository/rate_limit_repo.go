package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

// RateLimitRepository triển khai repo.RateLimitRepository theo chuẩn CTE-first.
type RateLimitRepository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewRateLimitRepository khởi tạo repository với writer và reader database pools.
func NewRateLimitRepository(writer, reader *sql.DB) repo.RateLimitRepository {
	return &RateLimitRepository{
		writer: writer,
		reader: reader,
	}
}

// Create chèn một Rate Limit Rule mới vào cơ sở dữ liệu và trả về flat projection.
func (r *RateLimitRepository) Create(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	enabledDimsJSON, err := json.Marshal(cmd.EnabledDimensions)
	if err != nil {
		enabledDimsJSON = []byte(`["ip"]`)
	}

	dimOrderJSON, err := json.Marshal(cmd.DimensionOrder)
	if err != nil {
		dimOrderJSON = []byte(`["ip"]`)
	}

	ipConfigMap := map[string]string{
		"source":      cmd.IpConfig.Source,
		"subnet_mask": cmd.IpConfig.SubnetMask,
	}
	ipConfigJSON, err := json.Marshal(ipConfigMap)
	if err != nil {
		ipConfigJSON = []byte(`{}`)
	}

	headerConfigMap := map[string]any{
		"header_name":    cmd.HeaderConfig.HeaderName,
		"operator":       cmd.HeaderConfig.Operator,
		"header_value":   cmd.HeaderConfig.HeaderValue,
		"case_sensitive": cmd.HeaderConfig.CaseSensitive,
	}
	headerConfigJSON, err := json.Marshal(headerConfigMap)
	if err != nil {
		headerConfigJSON = []byte(`{}`)
	}

	pathConfigMap := map[string]string{
		"path":       cmd.PathConfig.Path,
		"match_type": cmd.PathConfig.MatchType,
	}
	pathConfigJSON, err := json.Marshal(pathConfigMap)
	if err != nil {
		pathConfigJSON = []byte(`{}`)
	}

	customResponseInt := 0
	if cmd.CustomResponse {
		customResponseInt = 1
	}
	logEventsInt := 0
	if cmd.LogEvents {
		logEventsInt = 1
	}
	addReputationInt := 0
	if cmd.AddReputation {
		addReputationInt = 1
	}
	enableAlertInt := 0
	if cmd.EnableAlert {
		enableAlertInt = 1
	}

	status := cmd.Status
	if status == "" {
		status = "Active"
	}
	createdBy := cmd.CreatedBy
	if createdBy == "" {
		createdBy = "admin"
	}

	const insertQuery = `
	INSERT INTO rate_limit_rules (
		name, description, enabled_dimensions, dimension_order,
		ip_config, header_config, path_config, rate_limit, rate_unit,
		burst, action_exceeded, custom_response, response_code, response_body,
		log_events, add_reputation, enable_alert, status, created_by
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	res, err := r.writer.ExecContext(
		ctx,
		insertQuery,
		cmd.Name,
		cmd.Description,
		string(enabledDimsJSON),
		string(dimOrderJSON),
		string(ipConfigJSON),
		string(headerConfigJSON),
		string(pathConfigJSON),
		cmd.RateLimit,
		cmd.RateUnit,
		cmd.Burst,
		cmd.ActionExceeded,
		customResponseInt,
		cmd.ResponseCode,
		cmd.ResponseBody,
		logEventsInt,
		addReputationInt,
		enableAlertInt,
		status,
		createdBy,
	)
	if err != nil {
		return nil, fmt.Errorf("insert rate limit rule: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get last insert id: %w", err)
	}

	return r.GetByID(ctx, id)
}

// Update cập nhật một Rate Limit Rule và trả về flat projection mới nhất.
func (r *RateLimitRepository) Update(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	enabledDimsJSON, err := json.Marshal(cmd.EnabledDimensions)
	if err != nil {
		enabledDimsJSON = []byte(`["ip"]`)
	}

	dimOrderJSON, err := json.Marshal(cmd.DimensionOrder)
	if err != nil {
		dimOrderJSON = []byte(`["ip"]`)
	}

	ipConfigMap := map[string]string{
		"source":      cmd.IpConfig.Source,
		"subnet_mask": cmd.IpConfig.SubnetMask,
	}
	ipConfigJSON, err := json.Marshal(ipConfigMap)
	if err != nil {
		ipConfigJSON = []byte(`{}`)
	}

	headerConfigMap := map[string]any{
		"header_name":    cmd.HeaderConfig.HeaderName,
		"operator":       cmd.HeaderConfig.Operator,
		"header_value":   cmd.HeaderConfig.HeaderValue,
		"case_sensitive": cmd.HeaderConfig.CaseSensitive,
	}
	headerConfigJSON, err := json.Marshal(headerConfigMap)
	if err != nil {
		headerConfigJSON = []byte(`{}`)
	}

	pathConfigMap := map[string]string{
		"path":       cmd.PathConfig.Path,
		"match_type": cmd.PathConfig.MatchType,
	}
	pathConfigJSON, err := json.Marshal(pathConfigMap)
	if err != nil {
		pathConfigJSON = []byte(`{}`)
	}

	customResponseInt := 0
	if cmd.CustomResponse {
		customResponseInt = 1
	}
	logEventsInt := 0
	if cmd.LogEvents {
		logEventsInt = 1
	}
	addReputationInt := 0
	if cmd.AddReputation {
		addReputationInt = 1
	}
	enableAlertInt := 0
	if cmd.EnableAlert {
		enableAlertInt = 1
	}

	status := cmd.Status
	if status == "" {
		status = "Active"
	}

	const updateQuery = `
	UPDATE rate_limit_rules SET
		name = ?,
		description = ?,
		enabled_dimensions = ?,
		dimension_order = ?,
		ip_config = ?,
		header_config = ?,
		path_config = ?,
		rate_limit = ?,
		rate_unit = ?,
		burst = ?,
		action_exceeded = ?,
		custom_response = ?,
		response_code = ?,
		response_body = ?,
		log_events = ?,
		add_reputation = ?,
		enable_alert = ?,
		status = ?,
		updated_at = CURRENT_TIMESTAMP
	WHERE id = ?
	`

	res, err := r.writer.ExecContext(
		ctx,
		updateQuery,
		cmd.Name,
		cmd.Description,
		string(enabledDimsJSON),
		string(dimOrderJSON),
		string(ipConfigJSON),
		string(headerConfigJSON),
		string(pathConfigJSON),
		cmd.RateLimit,
		cmd.RateUnit,
		cmd.Burst,
		cmd.ActionExceeded,
		customResponseInt,
		cmd.ResponseCode,
		cmd.ResponseBody,
		logEventsInt,
		addReputationInt,
		enableAlertInt,
		status,
		cmd.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("update rate limit rule: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("get rows affected: %w", err)
	}
	if affected == 0 {
		return nil, sql.ErrNoRows
	}

	return r.GetByID(ctx, cmd.ID)
}

// GetByID lấy chi tiết một Rate Limit Rule theo ID sử dụng CTE-first pattern.
func (r *RateLimitRepository) GetByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error) {
	const query = `
	WITH target_rule AS (
		SELECT
			id, name, description, enabled_dimensions, dimension_order,
			ip_config, header_config, path_config, rate_limit, rate_unit,
			burst, action_exceeded, custom_response, response_code, response_body,
			log_events, add_reputation, enable_alert, status, created_by,
			created_at, updated_at
		FROM rate_limit_rules
		WHERE id = ?
	)
	SELECT
		id, name, description, enabled_dimensions, dimension_order,
		ip_config, header_config, path_config, rate_limit, rate_unit,
		burst, action_exceeded, custom_response, response_code, response_body,
		log_events, add_reputation, enable_alert, status, created_by,
		created_at, updated_at
	FROM target_rule;
	`

	var (
		item                                        entity.RateLimitRuleItem
		enabledDimsStr, dimOrderStr                 string
		ipConfigStr, headerConfigStr, pathConfigStr string
		customResponseInt, logEventsInt             int
		addReputationInt, enableAlertInt            int
	)

	err := r.reader.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&enabledDimsStr,
		&dimOrderStr,
		&ipConfigStr,
		&headerConfigStr,
		&pathConfigStr,
		&item.RateLimit,
		&item.RateUnit,
		&item.Burst,
		&item.ActionExceeded,
		&customResponseInt,
		&item.ResponseCode,
		&item.ResponseBody,
		&logEventsInt,
		&addReputationInt,
		&enableAlertInt,
		&item.Status,
		&item.CreatedBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("rate limit rule not found with id %d", id)
		}
		return nil, fmt.Errorf("query rate limit rule by id: %w", err)
	}

	item.CustomResponse = customResponseInt == 1
	item.LogEvents = logEventsInt == 1
	item.AddReputation = addReputationInt == 1
	item.EnableAlert = enableAlertInt == 1

	if enabledDimsStr != "" {
		_ = json.Unmarshal([]byte(enabledDimsStr), &item.EnabledDimensions)
	}
	if item.EnabledDimensions == nil {
		item.EnabledDimensions = []string{}
	}

	if dimOrderStr != "" {
		_ = json.Unmarshal([]byte(dimOrderStr), &item.DimensionOrder)
	}
	if item.DimensionOrder == nil {
		item.DimensionOrder = []string{}
	}

	if ipConfigStr != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(ipConfigStr), &m); err == nil {
			item.IpConfig = entity.RateLimitIpConfig{
				Source:     m["source"],
				SubnetMask: m["subnet_mask"],
			}
		}
	}

	if headerConfigStr != "" {
		var m struct {
			HeaderName    string `json:"header_name"`
			Operator      string `json:"operator"`
			HeaderValue   string `json:"header_value"`
			CaseSensitive bool   `json:"case_sensitive"`
		}
		if err := json.Unmarshal([]byte(headerConfigStr), &m); err == nil {
			item.HeaderConfig = entity.RateLimitHeaderConfig{
				HeaderName:    m.HeaderName,
				Operator:      m.Operator,
				HeaderValue:   m.HeaderValue,
				CaseSensitive: m.CaseSensitive,
			}
		}
	}

	if pathConfigStr != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(pathConfigStr), &m); err == nil {
			item.PathConfig = entity.RateLimitPathConfig{
				Path:      m["path"],
				MatchType: m["match_type"],
			}
		}
	}

	return &item, nil
}

// List truy vấn danh sách Rate Limit Rules theo CTE-first pattern.
func (r *RateLimitRepository) List(ctx context.Context, q entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = 20
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}

	searchPattern := ""
	if q.Search != "" {
		searchPattern = "%" + q.Search + "%"
	}

	statusFilter := q.Status
	if statusFilter == "ALL" {
		statusFilter = ""
	}

	const query = `
	WITH filtered_rules AS (
		SELECT
			id, name, description, enabled_dimensions, dimension_order,
			ip_config, header_config, path_config, rate_limit, rate_unit,
			burst, action_exceeded, custom_response, response_code, response_body,
			log_events, add_reputation, enable_alert, status, created_by,
			created_at, updated_at
		FROM rate_limit_rules
		WHERE (? = '' OR name LIKE ? OR description LIKE ?)
		  AND (? = '' OR status = ?)
	),
	total_metric AS (
		SELECT COUNT(*) AS total_filtered FROM filtered_rules
	),
	paginated_rules AS (
		SELECT * FROM filtered_rules
		ORDER BY id DESC
		LIMIT ? OFFSET ?
	)
	SELECT
		p.id, p.name, p.description, p.enabled_dimensions, p.dimension_order,
		p.ip_config, p.header_config, p.path_config, p.rate_limit, p.rate_unit,
		p.burst, p.action_exceeded, p.custom_response, p.response_code, p.response_body,
		p.log_events, p.add_reputation, p.enable_alert, p.status, p.created_by,
		p.created_at, p.updated_at,
		t.total_filtered
	FROM paginated_rules p
	CROSS JOIN total_metric t;
	`

	rows, err := r.reader.QueryContext(
		ctx,
		query,
		searchPattern, searchPattern, searchPattern,
		statusFilter, statusFilter,
		limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("query rate limit rules: %w", err)
	}
	defer rows.Close()

	res := &entity.ListRateLimitRulesResult{
		Items:         []entity.RateLimitRuleItem{},
		TotalFiltered: 0,
	}

	for rows.Next() {
		var (
			item                                        entity.RateLimitRuleItem
			enabledDimsStr, dimOrderStr                 string
			ipConfigStr, headerConfigStr, pathConfigStr string
			customResponseInt, logEventsInt             int
			addReputationInt, enableAlertInt            int
			totalFiltered                               int
		)

		err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Description,
			&enabledDimsStr,
			&dimOrderStr,
			&ipConfigStr,
			&headerConfigStr,
			&pathConfigStr,
			&item.RateLimit,
			&item.RateUnit,
			&item.Burst,
			&item.ActionExceeded,
			&customResponseInt,
			&item.ResponseCode,
			&item.ResponseBody,
			&logEventsInt,
			&addReputationInt,
			&enableAlertInt,
			&item.Status,
			&item.CreatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
			&totalFiltered,
		)
		if err != nil {
			return nil, fmt.Errorf("scan rate limit rule row: %w", err)
		}

		item.CustomResponse = customResponseInt == 1
		item.LogEvents = logEventsInt == 1
		item.AddReputation = addReputationInt == 1
		item.EnableAlert = enableAlertInt == 1

		if enabledDimsStr != "" {
			_ = json.Unmarshal([]byte(enabledDimsStr), &item.EnabledDimensions)
		}
		if item.EnabledDimensions == nil {
			item.EnabledDimensions = []string{}
		}

		if dimOrderStr != "" {
			_ = json.Unmarshal([]byte(dimOrderStr), &item.DimensionOrder)
		}
		if item.DimensionOrder == nil {
			item.DimensionOrder = []string{}
		}

		if ipConfigStr != "" {
			var m map[string]string
			if err := json.Unmarshal([]byte(ipConfigStr), &m); err == nil {
				item.IpConfig = entity.RateLimitIpConfig{
					Source:     m["source"],
					SubnetMask: m["subnet_mask"],
				}
			}
		}

		if headerConfigStr != "" {
			var m struct {
				HeaderName    string `json:"header_name"`
				Operator      string `json:"operator"`
				HeaderValue   string `json:"header_value"`
				CaseSensitive bool   `json:"case_sensitive"`
			}
			if err := json.Unmarshal([]byte(headerConfigStr), &m); err == nil {
				item.HeaderConfig = entity.RateLimitHeaderConfig{
					HeaderName:    m.HeaderName,
					Operator:      m.Operator,
					HeaderValue:   m.HeaderValue,
					CaseSensitive: m.CaseSensitive,
				}
			}
		}

		if pathConfigStr != "" {
			var m map[string]string
			if err := json.Unmarshal([]byte(pathConfigStr), &m); err == nil {
				item.PathConfig = entity.RateLimitPathConfig{
					Path:      m["path"],
					MatchType: m["match_type"],
				}
			}
		}

		res.TotalFiltered = totalFiltered
		res.Items = append(res.Items, item)
	}

	return res, rows.Err()
}

// Delete xóa một Rate Limit Rule theo ID.
func (r *RateLimitRepository) Delete(ctx context.Context, id int64) error {
	const query = `DELETE FROM rate_limit_rules WHERE id = ?`
	res, err := r.writer.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete rate limit rule: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("rate limit rule not found with id %d", id)
	}
	return nil
}

// GetStats truy vấn tổng hợp số liệu thực tế của Rate Limiting (24h gần nhất và đối chiếu 24h trước).
func (r *RateLimitRepository) GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error) {
	const statsQuery = `
	WITH current_period AS (
		SELECT 
			COALESCE(SUM(total_hits), 0) AS hits,
			COALESCE(SUM(blocked_count), 0) AS blocked,
			COALESCE(SUM(throttled_count), 0) AS throttled,
			CASE 
				WHEN SUM(total_hits) > 0 THEN ROUND(SUM(avg_latency_ms * total_hits) / SUM(total_hits), 2)
				ELSE 0.0 
			END AS avg_lat
		FROM rate_limit_hourly_metrics
		WHERE hour_bucket >= datetime('now', '-24 hours')
	),
	previous_period AS (
		SELECT 
			COALESCE(SUM(total_hits), 0) AS hits,
			COALESCE(SUM(blocked_count), 0) AS blocked,
			COALESCE(SUM(throttled_count), 0) AS throttled,
			CASE 
				WHEN SUM(total_hits) > 0 THEN ROUND(SUM(avg_latency_ms * total_hits) / SUM(total_hits), 2)
				ELSE 0.0 
			END AS avg_lat
		FROM rate_limit_hourly_metrics
		WHERE hour_bucket >= datetime('now', '-48 hours') 
		  AND hour_bucket < datetime('now', '-24 hours')
	)
	SELECT 
		c.hits, c.blocked, c.throttled, c.avg_lat,
		p.hits, p.blocked, p.throttled, p.avg_lat
	FROM current_period c
	CROSS JOIN previous_period p;
	`

	var curHits, curBlocked, curThrottled int64
	var curLatency float64
	var prevHits, prevBlocked, prevThrottled int64
	var prevLatency float64

	err := r.reader.QueryRowContext(ctx, statsQuery).Scan(
		&curHits, &curBlocked, &curThrottled, &curLatency,
		&prevHits, &prevBlocked, &prevThrottled, &prevLatency,
	)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("query rate limit stats: %w", err)
	}

	calcPctChange := func(curr, prev int64) float64 {
		if prev == 0 {
			if curr > 0 {
				return 100.0
			}
			return 0.0
		}
		return float64(curr-prev) / float64(prev) * 100.0
	}

	calcLatencyPctChange := func(curr, prev float64) float64 {
		if prev == 0 {
			if curr > 0 {
				return 100.0
			}
			return 0.0
		}
		return (curr - prev) / prev * 100.0
	}

	summary := &entity.RateLimitStatsSummary{
		TotalHits:          curHits,
		TotalBlocked:       curBlocked,
		TotalThrottled:     curThrottled,
		AvgLatencyMs:       curLatency,
		HitsChangePct:      calcPctChange(curHits, prevHits),
		BlockedChangePct:   calcPctChange(curBlocked, prevBlocked),
		ThrottledChangePct: calcPctChange(curThrottled, prevThrottled),
		LatencyChangePct:   calcLatencyPctChange(curLatency, prevLatency),
	}

	return summary, nil
}

// GetMetrics truy vấn biểu đồ thời gian và top endpoints theo khung giờ được chọn.
func (r *RateLimitRepository) GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error) {
	hoursParam := "-24"
	switch timeRange {
	case "6h":
		hoursParam = "-6"
	case "12h":
		hoursParam = "-12"
	case "24h":
		hoursParam = "-24"
	default:
		hoursParam = "-24"
	}

	const velocityQuery = `
	WITH hourly_series AS (
		SELECT 
			hour_bucket,
			total_hits,
			blocked_count,
			throttled_count
		FROM rate_limit_hourly_metrics
		WHERE hour_bucket >= datetime('now', ? || ' hours')
		ORDER BY hour_bucket ASC
	)
	SELECT hour_bucket, total_hits, blocked_count, throttled_count
	FROM hourly_series;
	`

	rows, err := r.reader.QueryContext(ctx, velocityQuery, hoursParam)
	if err != nil {
		return nil, fmt.Errorf("query velocity metrics: %w", err)
	}
	defer rows.Close()

	series := make([]entity.RateLimitHourlyMetricItem, 0)
	for rows.Next() {
		var item entity.RateLimitHourlyMetricItem
		if err := rows.Scan(&item.Timestamp, &item.TotalHits, &item.BlockedCount, &item.ThrottledCount); err != nil {
			return nil, fmt.Errorf("scan velocity item: %w", err)
		}
		series = append(series, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate velocity rows: %w", err)
	}

	orderClause := "ORDER BY total_blocked DESC"
	switch sortBy {
	case "requests":
		orderClause = "ORDER BY total_requests DESC"
	case "ratio":
		orderClause = "ORDER BY block_ratio DESC"
	case "blocked":
		orderClause = "ORDER BY total_blocked DESC"
	}

	topEndpointsQuery := fmt.Sprintf(`
	WITH endpoint_summary AS (
		SELECT 
			endpoint,
			method,
			COALESCE(MAX(rule_name), 'Rate Limit') AS rule_name,
			SUM(request_count) AS total_requests,
			SUM(blocked_count) AS total_blocked,
			CASE 
				WHEN SUM(request_count) > 0 THEN ROUND(CAST(SUM(blocked_count) AS REAL) * 100.0 / SUM(request_count), 2)
				ELSE 0.0 
			END AS block_ratio
		FROM rate_limit_endpoint_metrics
		WHERE hour_bucket >= datetime('now', ? || ' hours')
		GROUP BY endpoint, method
	)
	SELECT endpoint, method, rule_name, total_requests, total_blocked, block_ratio
	FROM endpoint_summary
	%s
	LIMIT 10;
	`, orderClause)

	epRows, err := r.reader.QueryContext(ctx, topEndpointsQuery, hoursParam)
	if err != nil {
		return nil, fmt.Errorf("query top endpoints: %w", err)
	}
	defer epRows.Close()

	endpoints := make([]entity.RateLimitTopEndpointItem, 0)
	for epRows.Next() {
		var item entity.RateLimitTopEndpointItem
		if err := epRows.Scan(&item.Endpoint, &item.Method, &item.RuleName, &item.Requests, &item.Blocked, &item.BlockRatio); err != nil {
			return nil, fmt.Errorf("scan endpoint item: %w", err)
		}
		endpoints = append(endpoints, item)
	}
	if err := epRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate endpoint rows: %w", err)
	}

	return &entity.RateLimitMetricsResult{
		VelocitySeries: series,
		TopEndpoints:   endpoints,
	}, nil
}

// BatchUpsertMetrics thực thi lưu các mẫu metrics theo giờ và endpoint bằng transaction và CTE/UPSERT.
func (r *RateLimitRepository) BatchUpsertMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error {
	if len(hourly) == 0 && len(endpoints) == 0 {
		return nil
	}

	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin metrics batch tx: %w", err)
	}
	defer tx.Rollback()

	if len(hourly) > 0 {
		const hourlyUpsertQuery = `
		INSERT INTO rate_limit_hourly_metrics (hour_bucket, total_hits, blocked_count, throttled_count, avg_latency_ms)
		VALUES (?, ?, ?, ?, 0.0)
		ON CONFLICT(hour_bucket) DO UPDATE SET
			total_hits = total_hits + excluded.total_hits,
			blocked_count = blocked_count + excluded.blocked_count,
			throttled_count = throttled_count + excluded.throttled_count;
		`
		stmt, err := tx.PrepareContext(ctx, hourlyUpsertQuery)
		if err != nil {
			return fmt.Errorf("prepare hourly upsert: %w", err)
		}
		defer stmt.Close()

		for _, sample := range hourly {
			if _, err := stmt.ExecContext(ctx, sample.HourBucket, sample.TotalHits, sample.BlockedCount, sample.ThrottledCount); err != nil {
				return fmt.Errorf("exec hourly upsert: %w", err)
			}
		}
	}

	if len(endpoints) > 0 {
		const endpointUpsertQuery = `
		INSERT INTO rate_limit_endpoint_metrics (hour_bucket, endpoint, method, rule_name, request_count, blocked_count)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(hour_bucket, endpoint, method) DO UPDATE SET
			rule_name = CASE WHEN excluded.rule_name != '' THEN excluded.rule_name ELSE rate_limit_endpoint_metrics.rule_name END,
			request_count = request_count + excluded.request_count,
			blocked_count = blocked_count + excluded.blocked_count;
		`
		stmt, err := tx.PrepareContext(ctx, endpointUpsertQuery)
		if err != nil {
			return fmt.Errorf("prepare endpoint upsert: %w", err)
		}
		defer stmt.Close()

		for _, sample := range endpoints {
			if _, err := stmt.ExecContext(ctx, sample.HourBucket, sample.Endpoint, sample.Method, sample.RuleName, sample.RequestCount, sample.BlockedCount); err != nil {
				return fmt.Errorf("exec endpoint upsert: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit metrics batch tx: %w", err)
	}
	return nil
}
