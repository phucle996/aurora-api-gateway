package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"github.com/gin-gonic/gin"
)

// TestRateLimit_UpdateRuleLifecycle kiểm tra độc lập workflow Sửa (Update) Rule Rate Limit.
func TestRateLimit_UpdateRuleLifecycle(t *testing.T) {
	handler, token := rateLimitsFixture(t)

	// 1. Tạo một rule ban đầu
	createPayload := map[string]any{
		"name":        "rule-to-update",
		"description": "Rule ban đầu",
		"enabled_dimensions": []string{"ip"},
		"dimension_order":    []string{"ip"},
		"ip_config": map[string]any{
			"source":      "binary_remote_addr",
			"subnet_mask": "/32",
		},
		"header_config": map[string]any{
			"header_name": "", "operator": "equals", "header_value": "", "case_sensitive": false,
		},
		"path_config": map[string]any{
			"path": "/", "match_type": "prefix",
		},
		"rate_limit":      100,
		"rate_unit":       "1 minute",
		"burst":           50,
		"action_exceeded": "block_429",
		"status":          "Active",
	}
	bodyBytes, _ := json.Marshal(createPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rate-limits", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var createdResp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &createdResp)
	ruleID := int64(createdResp["id"].(float64))

	// 2. Cập nhật (Update / Sửa) rule vừa tạo
	updatePayload := map[string]any{
		"name":        "rule-updated-name",
		"description": "Mô tả đã được sửa",
		"enabled_dimensions": []string{"ip", "header"},
		"dimension_order":    []string{"ip", "header"},
		"ip_config": map[string]any{
			"source":      "binary_remote_addr",
			"subnet_mask": "/24",
		},
		"header_config": map[string]any{
			"header_name":    "X-VIP",
			"operator":       "equals",
			"header_value":   "true",
			"case_sensitive": false,
		},
		"path_config": map[string]any{
			"path": "/api", "match_type": "prefix",
		},
		"rate_limit":      500,
		"rate_unit":       "1 second",
		"burst":           200,
		"action_exceeded": "challenge_js",
		"status":          "Inactive",
	}
	updateBytes, _ := json.Marshal(updatePayload)
	putReq := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), bytes.NewReader(updateBytes))
	putReq.Header.Set("Content-Type", "application/json")
	putReq.Header.Set("Authorization", "Bearer "+token)
	putW := httptest.NewRecorder()
	handler.ServeHTTP(putW, putReq)

	if putW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for update, got %d: %s", putW.Code, putW.Body.String())
	}

	// 3. Đọc lại để xác thực dữ liệu đã lưu chính xác
	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getW := httptest.NewRecorder()
	handler.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for get, got %d", getW.Code)
	}

	var getResp map[string]any
	_ = json.Unmarshal(getW.Body.Bytes(), &getResp)
	if getResp["name"] != "rule-updated-name" {
		t.Fatalf("expected name 'rule-updated-name', got %v", getResp["name"])
	}
	if getResp["rate_limit"].(float64) != 500 {
		t.Fatalf("expected rate_limit 500, got %v", getResp["rate_limit"])
	}
	if getResp["status"] != "Inactive" {
		t.Fatalf("expected status 'Inactive', got %v", getResp["status"])
	}
}

// TestRateLimit_20MillionRequestsStressAndCRUDUnderLoad là bài test áp lực cực hạn:
// 1. Nạp 20,000,000 requests vào RateLimitCollector qua 50 goroutines.
// 2. Collector định kỳ flush batch liên tục vào CSDL SQLite (Writer pool duy nhất).
// 3. Đồng thời chạy liên tục các thao tác Quản trị Rule: Thêm (POST), Sửa (PUT), Xóa (DELETE), Đọc (GET).
// 4. Đo lường: độ trễ, throughput, tỉ lệ thành công của CRUD API (0% lỗi khóa DB), và tính đúng đắn của 20M hits trong DB.
func TestRateLimit_20MillionRequestsStressAndCRUDUnderLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 20M stress test in short mode")
	}

	gin.SetMode(gin.ReleaseMode)
	dbPath := filepath.Join(t.TempDir(), "stress_20m.db")

	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: dbPath})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()

	// Bật chế độ standalone và collector để ghi nhận số liệu thực tế
	_, _ = pools.Writer.Exec("UPDATE system_settings SET value = 'standalone' WHERE key = 'metrics_mode'")

	token := "stress-test-auth-token-key-32-chars"
	router := gin.New()
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{SQLitePath: dbPath})
	app.RegisterRoutes(router, module, token)

	collector := module.RateLimitCollector
	collector.SetEnabled(true)

	// Khởi chạy background flusher chủ động cứ 200ms để tạo áp lực tranh chấp WriterDB liên tục
	stopFlusher := make(chan struct{})
	var flushCount int64
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopFlusher:
				return
			case <-ticker.C:
				collector.Flush(context.Background())
				atomic.AddInt64(&flushCount, 1)
			}
		}
	}()

	const totalRequests = 20_000_000
	const numIngestWorkers = 50
	const reqsPerWorker = totalRequests / numIngestWorkers

	endpoints := []string{
		"/api/v1/auth/login",
		"/api/v1/orders/checkout",
		"/api/v1/search/items",
		"/api/v1/payment/process",
	}

	t.Logf("=== BẮT ĐẦU TEST ÁP LỰC CỰC ĐẠI: 20,000,000 REQUESTS + QUẢN TRỊ RULE DƯỚI TẢI CAO ===")
	startTime := time.Now()

	// Kênh điều khiển dừng cho các goroutines quản trị Rule
	stopAdminWorkers := make(chan struct{})

	var (
		createdRulesCount int64
		updatedRulesCount int64
		deletedRulesCount int64
		readOpsCount      int64
		adminErrorsCount  int64

		ruleIDsMu    sync.Mutex
		updatableIDs []int64
		deletableIDs []int64
	)

	// Goroutine 1: Thêm Rule (Create - HTTP POST) liên tục dưới tải cao
	var adminWg sync.WaitGroup
	adminWg.Add(1)
	go func() {
		defer adminWg.Done()
		idx := 0
		for {
			select {
			case <-stopAdminWorkers:
				return
			default:
			}
			idx++
			body, _ := json.Marshal(map[string]any{
				"name":        fmt.Sprintf("stress-rule-%d", idx),
				"description": "Rule tạo trong lúc hệ thống đang tải 20M requests",
				"enabled_dimensions": []string{"ip"},
				"dimension_order":    []string{"ip"},
				"ip_config": map[string]any{
					"source":      "binary_remote_addr",
					"subnet_mask": "/32",
				},
				"header_config": map[string]any{
					"header_name": "", "operator": "equals", "header_value": "", "case_sensitive": false,
				},
				"path_config": map[string]any{
					"path": fmt.Sprintf("/endpoint-%d", idx), "match_type": "prefix",
				},
				"rate_limit":      100 + (idx % 1000),
				"rate_unit":       "1 minute",
				"burst":           50,
				"action_exceeded": "block_429",
				"status":          "Active",
			})

			req := httptest.NewRequest(http.MethodPost, "/api/v1/rate-limits", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code == http.StatusCreated {
				atomic.AddInt64(&createdRulesCount, 1)
				var resp map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &resp); err == nil {
					if idVal, ok := resp["id"].(float64); ok {
						id := int64(idVal)
						ruleIDsMu.Lock()
						if id%2 == 0 {
							updatableIDs = append(updatableIDs, id)
						} else {
							deletableIDs = append(deletableIDs, id)
						}
						ruleIDsMu.Unlock()
					}
				}
			} else {
				atomic.AddInt64(&adminErrorsCount, 1)
				t.Logf("Create error: %d - %s", w.Code, w.Body.String())
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()

	// Goroutine 2: Sửa Rule (Update - HTTP PUT) liên tục dưới tải cao
	adminWg.Add(1)
	go func() {
		defer adminWg.Done()
		updateIdx := 0
		for {
			select {
			case <-stopAdminWorkers:
				return
			default:
			}
			var targetID int64
			ruleIDsMu.Lock()
			if len(updatableIDs) > 0 {
				targetID = updatableIDs[updateIdx%len(updatableIDs)]
			}
			ruleIDsMu.Unlock()

			if targetID > 0 {
				updateIdx++
				body, _ := json.Marshal(map[string]any{
					"name":        fmt.Sprintf("rule-updated-%d", targetID),
					"description": "Cập nhật dưới áp lực nạp 20M reqs",
					"enabled_dimensions": []string{"ip"},
					"dimension_order":    []string{"ip"},
					"ip_config": map[string]any{
						"source":      "binary_remote_addr",
						"subnet_mask": "/24",
					},
					"header_config": map[string]any{
						"header_name": "", "operator": "equals", "header_value": "", "case_sensitive": false,
					},
					"path_config": map[string]any{
						"path": "/updated", "match_type": "prefix",
					},
					"rate_limit":      999,
					"rate_unit":       "1 second",
					"burst":           300,
					"action_exceeded": "challenge_js",
					"status":          "Active",
				})

				req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/rate-limits/%d", targetID), bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", "Bearer "+token)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, req)

				if w.Code == http.StatusOK {
					atomic.AddInt64(&updatedRulesCount, 1)
				} else {
					atomic.AddInt64(&adminErrorsCount, 1)
					t.Logf("Update error for ID %d: %d - %s", targetID, w.Code, w.Body.String())
				}
			}
			time.Sleep(8 * time.Millisecond)
		}
	}()

	// Goroutine 3: Xóa Rule (Delete - HTTP DELETE) liên tục dưới tải cao
	adminWg.Add(1)
	go func() {
		defer adminWg.Done()
		for {
			select {
			case <-stopAdminWorkers:
				return
			default:
			}
			var deleteID int64
			ruleIDsMu.Lock()
			if len(deletableIDs) > 0 {
				deleteID = deletableIDs[0]
				deletableIDs = deletableIDs[1:]
			}
			ruleIDsMu.Unlock()

			if deleteID > 0 {
				req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/rate-limits/%d", deleteID), nil)
				req.Header.Set("Authorization", "Bearer "+token)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, req)

				if w.Code == http.StatusOK {
					atomic.AddInt64(&deletedRulesCount, 1)
				} else {
					atomic.AddInt64(&adminErrorsCount, 1)
					t.Logf("Delete error for ID %d: %d - %s", deleteID, w.Code, w.Body.String())
				}
			}
			time.Sleep(15 * time.Millisecond)
		}
	}()

	// Goroutine 4: Đọc danh sách & thống kê (List, Stats, Metrics - HTTP GET)
	adminWg.Add(1)
	go func() {
		defer adminWg.Done()
		for {
			select {
			case <-stopAdminWorkers:
				return
			default:
			}

			// GET List
			req1 := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits?limit=20", nil)
			req1.Header.Set("Authorization", "Bearer "+token)
			w1 := httptest.NewRecorder()
			router.ServeHTTP(w1, req1)
			if w1.Code == http.StatusOK {
				atomic.AddInt64(&readOpsCount, 1)
			} else {
				atomic.AddInt64(&adminErrorsCount, 1)
			}

			// GET Stats
			req2 := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits/stats", nil)
			req2.Header.Set("Authorization", "Bearer "+token)
			w2 := httptest.NewRecorder()
			router.ServeHTTP(w2, req2)
			if w2.Code == http.StatusOK {
				atomic.AddInt64(&readOpsCount, 1)
			} else {
				atomic.AddInt64(&adminErrorsCount, 1)
			}

			time.Sleep(10 * time.Millisecond)
		}
	}()

	// BƠM 20 TRIỆU REQUESTS VÀO COLLECTOR QUA 50 WORKERS
	var ingestWg sync.WaitGroup
	for w := 0; w < numIngestWorkers; w++ {
		ingestWg.Add(1)
		go func(workerID int) {
			defer ingestWg.Done()
			ep := endpoints[workerID%len(endpoints)]
			rule := fmt.Sprintf("Rule-Group-%d", workerID%4)
			for i := 0; i < reqsPerWorker; i++ {
				blocked := (i % 10) == 0 // 10% bị block 429
				throttled := (i % 25) == 0
				collector.RecordEvent(ep, "POST", rule, blocked, throttled)
			}
		}(w)
	}

	// Đợi hoàn tất 20,000,000 requests ingestion
	ingestWg.Wait()
	ingestDuration := time.Since(startTime)

	// Dừng các workers CRUD quản trị
	close(stopAdminWorkers)
	adminWg.Wait()

	// Dừng background flusher
	close(stopFlusher)

	// Flush lần cuối để đảm bảo toàn bộ metrics được ghi bền vững vào SQLite
	collector.Stop()

	totalDuration := time.Since(startTime)
	throughput := float64(totalRequests) / ingestDuration.Seconds()

	t.Logf("------------------------------------------------------------------------")
	t.Logf(" KẾT QUẢ TEST TẢI CỰC HẠN & CONCURRENCY")
	t.Logf("------------------------------------------------------------------------")
	t.Logf(" Tổng số request telemetry nạp: %d requests", totalRequests)
	t.Logf(" Thời gian nạp 20M reqs:        %v (Throughput: %.2f reqs/sec)", ingestDuration, throughput)
	t.Logf(" Tổng thời gian test E2E:       %v", totalDuration)
	t.Logf(" Số lần flush xuống SQLite:     %d batches", atomic.LoadInt64(&flushCount))
	t.Logf(" Thao tác Tạo Rule (POST):      %d thành công", atomic.LoadInt64(&createdRulesCount))
	t.Logf(" Thao tác Sửa Rule (PUT):       %d thành công", atomic.LoadInt64(&updatedRulesCount))
	t.Logf(" Thao tác Xóa Rule (DELETE):    %d thành công", atomic.LoadInt64(&deletedRulesCount))
	t.Logf(" Thao tác Đọc Rule/Stats (GET): %d thành công", atomic.LoadInt64(&readOpsCount))
	t.Logf(" Tổng số lỗi API CRUD:          %d lỗi (Tỉ lệ lỗi: %.4f%%)",
		atomic.LoadInt64(&adminErrorsCount),
		float64(atomic.LoadInt64(&adminErrorsCount))/float64(atomic.LoadInt64(&createdRulesCount)+atomic.LoadInt64(&updatedRulesCount)+atomic.LoadInt64(&deletedRulesCount)+atomic.LoadInt64(&readOpsCount)+1)*100,
	)
	t.Logf("------------------------------------------------------------------------")

	if atomic.LoadInt64(&adminErrorsCount) > 0 {
		t.Fatalf("Phát hiện %d lỗi trong thao tác CRUD khi đang tải cao!", atomic.LoadInt64(&adminErrorsCount))
	}

	if atomic.LoadInt64(&createdRulesCount) == 0 || atomic.LoadInt64(&updatedRulesCount) == 0 {
		t.Fatalf("Không thực hiện được đủ các thao tác Thêm/Sửa rule trong thời gian test!")
	}

	var dbCount int
	var maxHB string
	_ = pools.Reader.QueryRow("SELECT COUNT(*), COALESCE(MAX(hour_bucket), '') FROM rate_limit_hourly_metrics").Scan(&dbCount, &maxHB)
	var sqlNow string
	_ = pools.Reader.QueryRow("SELECT datetime('now')").Scan(&sqlNow)
	t.Logf("--> DEBUG DB: rows in rate_limit_hourly_metrics = %d, max hour_bucket = '%s', sqlite datetime('now') = '%s'", dbCount, maxHB, sqlNow)

	// 5. Kiểm tra tính toàn vẹn của dữ liệu trong CSDL SQLite
	statsReq := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits/stats", nil)
	statsReq.Header.Set("Authorization", "Bearer "+token)
	statsW := httptest.NewRecorder()
	router.ServeHTTP(statsW, statsReq)

	if statsW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for stats verification, got %d", statsW.Code)
	}

	var statsResp map[string]any
	_ = json.Unmarshal(statsW.Body.Bytes(), &statsResp)
	totalHitsInDB := int64(statsResp["total_hits"].(float64))
	totalBlockedInDB := int64(statsResp["total_blocked"].(float64))

	t.Logf(" [CSDL VERIFICATION] Total Hits ghi nhận trong DB:    %d / %d (%.2f%%)",
		totalHitsInDB, totalRequests, float64(totalHitsInDB)/float64(totalRequests)*100)
	t.Logf(" [CSDL VERIFICATION] Total Blocked ghi nhận trong DB: %d (10%% của 20M = 2,000,000)",
		totalBlockedInDB)

	if totalHitsInDB != totalRequests {
		t.Fatalf("Dữ liệu Total Hits trong DB không khớp: mong đợi %d, thực tế %d", totalRequests, totalHitsInDB)
	}
	expectedBlocked := int64(totalRequests / 10)
	if totalBlockedInDB != expectedBlocked {
		t.Fatalf("Dữ liệu Total Blocked trong DB không khớp: mong đợi %d, thực tế %d", expectedBlocked, totalBlockedInDB)
	}

	t.Logf("=== TEST THÀNH CÔNG RỰC RỠ: 20 TRIỆU REQUESTS + CRUD HOÀN HẢO KHÔNG LỖI ===")
}
