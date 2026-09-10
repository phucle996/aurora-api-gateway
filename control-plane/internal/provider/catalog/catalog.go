package catalog

import (
	"fmt"
	"sort"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DefaultCategories trả về danh mục đầy đủ các Metrics được hệ thống Aurora WAF hỗ trợ.
func DefaultCategories() []entity.MetricCatalogCategory {
	return []entity.MetricCatalogCategory{
		{
			ID:          "traffic",
			Name:        "Traffic & NGINX",
			Description: "Lưu lượng truy cập, tốc độ request và trạng thái kết nối NGINX",
			Metrics: []entity.MetricDefinition{
				{
					Key:                   "traffic.requests_rate",
					Name:                  "Request Rate (RPS)",
					Unit:                  "req/s",
					Description:           "Tốc độ request HTTP trên giây",
					SupportedAggregations: []string{"sum", "avg", "max"},
					SupportedGroupBy:      []string{"node_id", "status", "host"},
					PromQLTemplate:        "sum by ({{.GroupBy}}) (rate(nginx_http_requests_total{{.Filters}}[{{.Window}}]) or aurora_node_requests_per_second{{.Filters}} or http_requests_per_second{{.Filters}})",
				},
				{
					Key:                   "traffic.connections_active",
					Name:                  "Active Connections",
					Unit:                  "conn",
					Description:           "Số lượng kết nối HTTP đồng thời đang hoạt động",
					SupportedAggregations: []string{"sum", "avg", "max"},
					SupportedGroupBy:      []string{"node_id"},
					PromQLTemplate:        "sum by ({{.GroupBy}}) (http_connections_active{{.Filters}} or aurora_node_active_connections{{.Filters}})",
				},
			},
		},
		{
			ID:                "waf",
			Name:              "WAF & Security",
			Description:       "Các sự kiện chặn tấn công, nhận diện luật và hành động bảo vệ",
			ExtensionRequired: "waf_engine",
			Metrics: []entity.MetricDefinition{
				{
					Key:                   "waf.blocks_rate",
					Name:                  "Blocked Requests Rate",
					Unit:                  "req/s",
					Description:           "Tần suất các request bị WAF chặn theo giây",
					SupportedAggregations: []string{"sum", "avg"},
					SupportedGroupBy:      []string{"node_id", "action"},
					ExtensionRequired:     "waf_engine",
					PromQLTemplate:        `sum by ({{.GroupBy}}) (rate(aurora_waf_action_total{action="block"{{.FiltersKV}}}[{{.Window}}]))`,
				},
				{
					Key:                   "waf.rules_triggered",
					Name:                  "Rule Matches Rate",
					Unit:                  "matches/s",
					Description:           "Tần suất các rule WAF bị kích hoạt",
					SupportedAggregations: []string{"sum", "avg"},
					SupportedGroupBy:      []string{"rule_id", "node_id"},
					ExtensionRequired:     "waf_engine",
					PromQLTemplate:        "sum by ({{.GroupBy}}) (rate(aurora_waf_matched_total{{.Filters}}[{{.Window}}]))",
				},
			},
		},
		{
			ID:                "rate_limit",
			Name:              "Rate Limiting",
			Description:       "Tỷ lệ từ chối và làm chậm request vượt ngưỡng",
			ExtensionRequired: "rate_limit",
			Metrics: []entity.MetricDefinition{
				{
					Key:                   "rate_limit.rejected",
					Name:                  "Rejected Rate",
					Unit:                  "req/s",
					Description:           "Số request bị chặn do vi phạm Rate Limit",
					SupportedAggregations: []string{"sum", "avg"},
					SupportedGroupBy:      []string{"zone", "node_id"},
					ExtensionRequired:     "rate_limit",
					PromQLTemplate:        "sum by ({{.GroupBy}}) (rate(aurora_rate_limit_rejected_total{{.Filters}}[{{.Window}}]))",
				},
				{
					Key:                   "rate_limit.delayed",
					Name:                  "Delayed Rate",
					Unit:                  "req/s",
					Description:           "Số request bị hoãn lại (delay) theo thuật toán leaky bucket",
					SupportedAggregations: []string{"sum", "avg"},
					SupportedGroupBy:      []string{"zone", "node_id"},
					ExtensionRequired:     "rate_limit",
					PromQLTemplate:        "sum by ({{.GroupBy}}) (rate(aurora_rate_limit_delayed_total{{.Filters}}[{{.Window}}]))",
				},
			},
		},
		{
			ID:          "system",
			Name:        "System & Node Health",
			Description: "Tài nguyên phần cứng, tải CPU và dung lượng RAM của các node",
			Metrics: []entity.MetricDefinition{
				{
					Key:                   "system.cpu_percent",
					Name:                  "CPU Utilization",
					Unit:                  "%",
					Description:           "Tỷ lệ sử dụng CPU của node",
					SupportedAggregations: []string{"avg", "max"},
					SupportedGroupBy:      []string{"node_id"},
					PromQLTemplate:        "avg by ({{.GroupBy}}) (aurora_node_cpu_percent{{.Filters}} or (system_cpu_utilization_ratio{{.Filters}} * 100))",
				},
				{
					Key:                   "system.memory_percent",
					Name:                  "Memory Utilization",
					Unit:                  "%",
					Description:           "Tỷ lệ sử dụng bộ nhớ RAM của node",
					SupportedAggregations: []string{"avg", "max"},
					SupportedGroupBy:      []string{"node_id"},
					PromQLTemplate:        "avg by ({{.GroupBy}}) (aurora_node_memory_percent{{.Filters}} or (system_memory_utilization_ratio{{.Filters}} * 100))",
				},
			},
		},
	}
}

// FindMetricDefinition tìm định nghĩa metric theo key.
func FindMetricDefinition(key string) *entity.MetricDefinition {
	for _, cat := range DefaultCategories() {
		for _, m := range cat.Metrics {
			if m.Key == key {
				cpy := m
				return &cpy
			}
		}
	}
	return nil
}

// FilterCategoriesByActiveExtensions lọc danh mục theo danh sách extensions đang bật.
func FilterCategoriesByActiveExtensions(activeExts map[string]bool) []entity.MetricCatalogCategory {
	var result []entity.MetricCatalogCategory
	for _, cat := range DefaultCategories() {
		if cat.ExtensionRequired != "" && !activeExts[cat.ExtensionRequired] {
			continue
		}
		var metrics []entity.MetricDefinition
		for _, m := range cat.Metrics {
			if m.ExtensionRequired != "" && !activeExts[m.ExtensionRequired] {
				continue
			}
			metrics = append(metrics, m)
		}
		if len(metrics) > 0 {
			cat.Metrics = metrics
			result = append(result, cat)
		}
	}
	return result
}

// BuildPromQL biên dịch một AnalyticsQueryItem thành câu lệnh PromQL chuẩn.
func BuildPromQL(item entity.AnalyticsQueryItem, window string) (string, error) {
	def := FindMetricDefinition(item.MetricKey)
	if def == nil {
		return "", fmt.Errorf("không tìm thấy định nghĩa cho metric_key: %s", item.MetricKey)
	}

	if window == "" {
		window = "1m"
	}

	// 1. Chuẩn bị filter selectors
	var filterPairs []string
	for k, v := range item.Filters {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k != "" && v != "" {
			filterPairs = append(filterPairs, fmt.Sprintf(`%s=%q`, k, v))
		}
	}
	sort.Strings(filterPairs)

	filtersStr := ""
	filtersKVStr := ""
	if len(filterPairs) > 0 {
		filtersStr = "{" + strings.Join(filterPairs, ",") + "}"
		filtersKVStr = "," + strings.Join(filterPairs, ",")
	}

	// 2. Chuẩn bị Group By
	groupByStr := strings.Join(item.GroupBy, ",")
	if groupByStr == "" {
		// Mặc định group by node_id nếu có
		if len(item.GroupBy) == 0 {
			groupByStr = "node_id"
		}
	}

	// 3. Render template
	expr := def.PromQLTemplate
	expr = strings.ReplaceAll(expr, "{{.Window}}", window)
	expr = strings.ReplaceAll(expr, "{{.Filters}}", filtersStr)
	expr = strings.ReplaceAll(expr, "{{.FiltersKV}}", filtersKVStr)
	expr = strings.ReplaceAll(expr, "{{.GroupBy}}", groupByStr)

	// Thay đổi aggregation nếu client yêu cầu (vd: avg thay vì sum)
	agg := strings.ToLower(strings.TrimSpace(item.Aggregation))
	if agg != "" && agg != "sum" && (agg == "avg" || agg == "max" || agg == "min") {
		if strings.HasPrefix(expr, "sum by") {
			expr = agg + " by" + expr[6:]
		}
	}

	return expr, nil
}
