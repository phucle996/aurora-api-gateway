package provider

import (
	"bytes"
	"context"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type endpointCounterKey struct {
	hourBucket string
	endpoint   string
	method     string
}

type endpointCounterVal struct {
	ruleName string
	requests int64
	blocked  int64
}

type hourlyCounterVal struct {
	hits      int64
	blocked   int64
	throttled int64
}

type collectorShard struct {
	mu        sync.Mutex
	hourly    map[string]*hourlyCounterVal
	endpoints map[endpointCounterKey]*endpointCounterVal
}

const numCollectorShards = 16

// RateLimitCollector là background ingestion provider thu thập và tổng hợp telemetry
// của Rate Limiting hoàn toàn off-main-path (qua UDP Syslog hoặc RAM buffer) chống nghẽn I/O.
type RateLimitCollector struct {
	svc     port.RateLimitService
	udpAddr string
	enabled bool

	statusMu sync.RWMutex

	hourMu           sync.RWMutex
	lastHourSlot     int64
	cachedHourBucket string

	shards [numCollectorShards]collectorShard

	conn net.PacketConn
	stop chan struct{}
}

// NewRateLimitCollector khởi tạo collector provider với 16 sharded in-memory buffers.
func NewRateLimitCollector(svc port.RateLimitService, udpAddr string) *RateLimitCollector {
	c := &RateLimitCollector{
		svc:     svc,
		udpAddr: udpAddr,
		enabled: true,
		stop:    make(chan struct{}),
	}
	for i := 0; i < numCollectorShards; i++ {
		c.shards[i].hourly = make(map[string]*hourlyCounterVal)
		c.shards[i].endpoints = make(map[endpointCounterKey]*endpointCounterVal)
	}
	return c
}

// SetEnabled bật/tắt chức năng thu thập metrics của collector.
func (c *RateLimitCollector) SetEnabled(enabled bool) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()
	c.enabled = enabled
	log.Printf("[RateLimitCollector] SetEnabled: %v", enabled)
	if !enabled {
		// Dọn sạch buffer RAM của tất cả các shards khi tắt thu thập
		for i := 0; i < numCollectorShards; i++ {
			c.shards[i].mu.Lock()
			c.shards[i].hourly = make(map[string]*hourlyCounterVal)
			c.shards[i].endpoints = make(map[endpointCounterKey]*endpointCounterVal)
			c.shards[i].mu.Unlock()
		}
	}
}

// IsEnabled kiểm tra trạng thái bật/tắt của collector.
func (c *RateLimitCollector) IsEnabled() bool {
	c.statusMu.RLock()
	defer c.statusMu.RUnlock()
	return c.enabled
}

func (c *RateLimitCollector) getHourBucket(nowUnix int64) string {
	hourSlot := nowUnix - (nowUnix % 3600)
	c.hourMu.RLock()
	if c.lastHourSlot == hourSlot && c.cachedHourBucket != "" {
		b := c.cachedHourBucket
		c.hourMu.RUnlock()
		return b
	}
	c.hourMu.RUnlock()

	c.hourMu.Lock()
	defer c.hourMu.Unlock()
	if c.lastHourSlot == hourSlot && c.cachedHourBucket != "" {
		return c.cachedHourBucket
	}
	c.lastHourSlot = hourSlot
	c.cachedHourBucket = time.Unix(hourSlot, 0).UTC().Format("2006-01-02 15:00:00")
	return c.cachedHourBucket
}

// RecordEvent ghi nhận 1 request vào RAM buffer (zero I/O overhead, sharded partition chống contention).
// Nếu chế độ thu thập đang tắt (Disabled), hàm return ngay lập tức.
func (c *RateLimitCollector) RecordEvent(endpoint, method, ruleName string, blocked bool, throttled bool) {
	if !c.IsEnabled() {
		return
	}

	if endpoint == "" {
		endpoint = "/"
	}
	if method == "" {
		method = "GET"
	}
	if ruleName == "" {
		ruleName = "Default Rate Limit"
	}

	nowUnix := time.Now().Unix()
	hourBucket := c.getHourBucket(nowUnix)

	// Hash FNV-1a nhanh không sinh cấp phát bộ nhớ để chọn shard
	var h uint32 = 2166136261
	for i := 0; i < len(endpoint); i++ {
		h = (h ^ uint32(endpoint[i])) * 16777619
	}
	shard := &c.shards[h%numCollectorShards]

	shard.mu.Lock()
	hVal, ok := shard.hourly[hourBucket]
	if !ok {
		hVal = &hourlyCounterVal{}
		shard.hourly[hourBucket] = hVal
	}
	hVal.hits++
	if blocked {
		hVal.blocked++
	}
	if throttled {
		hVal.throttled++
	}

	epKey := endpointCounterKey{
		hourBucket: hourBucket,
		endpoint:   endpoint,
		method:     method,
	}
	epVal, ok := shard.endpoints[epKey]
	if !ok {
		epVal = &endpointCounterVal{ruleName: ruleName}
		shard.endpoints[epKey] = epVal
	}
	epVal.requests++
	if blocked {
		epVal.blocked++
	}
	shard.mu.Unlock()
}


// Start khởi động background UDP listener và flush ticker định kỳ.
func (c *RateLimitCollector) Start(ctx context.Context) {
	if c.udpAddr != "" {
		conn, err := net.ListenPacket("udp", c.udpAddr)
		if err == nil {
			c.conn = conn
			log.Printf("[RateLimitCollector] Listening on UDP %s (enabled: %v)", c.udpAddr, c.IsEnabled())
			go c.listenUDP()
		} else {
			log.Printf("[RateLimitCollector] FAILED to listen UDP %s: %v", c.udpAddr, err)
		}
	}

	go c.flushLoop(ctx)
}

// Stop đóng UDP socket và dọn dẹp tài nguyên.
func (c *RateLimitCollector) Stop() {
	close(c.stop)
	if c.conn != nil {
		_ = c.conn.Close()
	}
	// Flush nốt lần cuối
	c.Flush(context.Background())
}

func (c *RateLimitCollector) listenUDP() {
	buf := make([]byte, 65536)
	for {
		select {
		case <-c.stop:
			return
		default:
		}

		n, _, err := c.conn.ReadFrom(buf)
		if err != nil {
			log.Printf("[RateLimitCollector] UDP ReadFrom error: %v", err)
			return
		}

		line := buf[:n]
		if !c.IsEnabled() {
			continue
		}

		if bytes.Contains(line, []byte("\n")) {
			for _, sub := range bytes.Split(line, []byte("\n")) {
				c.parseAndRecordLogLine(sub)
			}
		} else {
			c.parseAndRecordLogLine(line)
		}
	}
}

// parseAndRecordLogLine phân tích dòng syslog non-blocking từ NGINX mà không cấp phát bộ nhớ thừa.
func (c *RateLimitCollector) parseAndRecordLogLine(line []byte) {
	str := string(bytes.TrimSpace(line))
	if str == "" {
		return
	}

	is429 := strings.Contains(str, " 429 ") || strings.Contains(str, "status=429") || strings.Contains(str, "blocked")
	isThrottled := strings.Contains(str, "throttled") || strings.Contains(str, "delay=")

	method := "GET"
	for _, m := range []string{"POST", "GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"} {
		if strings.Contains(str, m+" ") {
			method = m
			break
		}
	}

	endpoint := "/"
	idx := strings.Index(str, method+" ")
	if idx >= 0 {
		rest := str[idx+len(method)+1:]
		endIdx := strings.IndexAny(rest, " ?\"'\n")
		if endIdx > 0 {
			endpoint = rest[:endIdx]
		}
	}

	ruleName := "Rate Limit Rule"
	if rIdx := strings.Index(str, "rl_rule="); rIdx >= 0 {
		rest := str[rIdx+8:]
		endIdx := strings.IndexAny(rest, " \"'\n")
		if endIdx > 0 {
			ruleName = rest[:endIdx]
		} else if len(rest) > 0 {
			ruleName = rest
		}
	}

	c.RecordEvent(endpoint, method, ruleName, is429, isThrottled)
}

func (c *RateLimitCollector) flushLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			c.Flush(context.Background())
			return
		case <-c.stop:
			return
		case <-ticker.C:
			c.Flush(ctx)
		}
	}
}

// Flush tổng hợp các shards và đồng bộ dữ liệu telemetry xuống tầng lưu trữ.
func (c *RateLimitCollector) Flush(ctx context.Context) {
	if !c.IsEnabled() {
		return
	}

	mergedHourly := make(map[string]*hourlyCounterVal)
	mergedEndpoints := make(map[endpointCounterKey]*endpointCounterVal)

	for i := 0; i < numCollectorShards; i++ {
		shard := &c.shards[i]
		shard.mu.Lock()
		if len(shard.hourly) == 0 && len(shard.endpoints) == 0 {
			shard.mu.Unlock()
			continue
		}
		currH := shard.hourly
		currE := shard.endpoints
		shard.hourly = make(map[string]*hourlyCounterVal)
		shard.endpoints = make(map[endpointCounterKey]*endpointCounterVal)
		shard.mu.Unlock()

		for h, v := range currH {
			mv, ok := mergedHourly[h]
			if !ok {
				mv = &hourlyCounterVal{}
				mergedHourly[h] = mv
			}
			mv.hits += v.hits
			mv.blocked += v.blocked
			mv.throttled += v.throttled
		}

		for k, v := range currE {
			mv, ok := mergedEndpoints[k]
			if !ok {
				mv = &endpointCounterVal{ruleName: v.ruleName}
				mergedEndpoints[k] = mv
			}
			mv.requests += v.requests
			mv.blocked += v.blocked
		}
	}

	if len(mergedHourly) == 0 && len(mergedEndpoints) == 0 {
		log.Printf("[RateLimitCollector] Flush: buffer is empty")
		return
	}

	hourlySamples := make([]entity.RateLimitHourlyMetricSample, 0, len(mergedHourly))
	for hour, val := range mergedHourly {
		hourlySamples = append(hourlySamples, entity.RateLimitHourlyMetricSample{
			HourBucket:     hour,
			TotalHits:      val.hits,
			BlockedCount:   val.blocked,
			ThrottledCount: val.throttled,
		})
	}

	endpointSamples := make([]entity.RateLimitEndpointMetricSample, 0, len(mergedEndpoints))
	for key, val := range mergedEndpoints {
		endpointSamples = append(endpointSamples, entity.RateLimitEndpointMetricSample{
			HourBucket:   key.hourBucket,
			Endpoint:     key.endpoint,
			Method:       key.method,
			RuleName:     val.ruleName,
			RequestCount: val.requests,
			BlockedCount: val.blocked,
		})
	}

	log.Printf("[RateLimitCollector] Flush: flushing %d hourly, %d endpoint samples to DB", len(hourlySamples), len(endpointSamples))
	if err := c.svc.RecordMetrics(ctx, hourlySamples, endpointSamples); err != nil {
		log.Printf("[RateLimitCollector] Flush ERROR: %v", err)
	}
}
