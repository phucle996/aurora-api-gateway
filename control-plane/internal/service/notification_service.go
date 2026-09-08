package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type NotificationService = port.NotificationService

type notificationService struct {
	repo repo.NotificationRepository
}

// NewNotificationService khởi tạo service quản lý cấu hình thông báo và test channel.
func NewNotificationService(repo repo.NotificationRepository) NotificationService {
	return &notificationService{repo: repo}
}

func (s *notificationService) GetOverview(ctx context.Context) (*entity.NotificationOverview, error) {
	return s.repo.GetOverview(ctx)
}

func (s *notificationService) UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return errors.New("channel ID không được để trống")
	}

	if configJSON == "" {
		configJSON = "{}"
	}
	if !json.Valid([]byte(configJSON)) {
		return errors.New("cấu hình channel phải là định dạng JSON hợp lệ")
	}

	return s.repo.UpdateChannel(ctx, id, enabled, configJSON)
}

func (s *notificationService) UpdateRule(ctx context.Context, id string, enabled bool) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("rule ID không được để trống")
	}
	return s.repo.UpdateRule(ctx, id, enabled)
}

func (s *notificationService) TestChannel(ctx context.Context, id string) (*entity.TestNotificationResult, error) {
	id = strings.ToLower(strings.TrimSpace(id))
	channel, err := s.repo.GetChannelByID(ctx, id)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	var testErr error
	var testMsg string

	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(channel.ConfigJSON), &cfg); err != nil {
		cfg = make(map[string]interface{})
	}

	switch id {
	case "email":
		testErr, testMsg = testEmailChannel(cfg)
	case "slack":
		testErr, testMsg = testSlackChannel(cfg)
	case "telegram":
		testErr, testMsg = testTelegramChannel(cfg)
	case "discord":
		testErr, testMsg = testDiscordChannel(cfg)
	case "webhook":
		testErr, testMsg = testCustomWebhookChannel(cfg)
	case "pagerduty":
		testErr, testMsg = testPagerDutyChannel(cfg)
	default:
		return nil, fmt.Errorf("không hỗ trợ kiểm thử kênh: %s", id)
	}

	latency := time.Since(start).Milliseconds()
	status := "success"
	if testErr != nil {
		status = "failed"
		testMsg = testErr.Error()
	}

	_ = s.repo.RecordTestResult(ctx, id, status, testMsg)

	if testErr != nil {
		return &entity.TestNotificationResult{
			Success:   false,
			Message:   testMsg,
			LatencyMs: latency,
		}, nil
	}

	return &entity.TestNotificationResult{
		Success:   true,
		Message:   testMsg,
		LatencyMs: latency,
	}, nil
}

func testEmailChannel(cfg map[string]interface{}) (error, string) {
	host, _ := cfg["host"].(string)
	portVal := cfg["port"]
	if host == "" {
		return errors.New("vui lòng cấu hình SMTP Host"), ""
	}
	portStr := "587"
	switch p := portVal.(type) {
	case float64:
		portStr = fmt.Sprintf("%d", int(p))
	case string:
		if p != "" {
			portStr = p
		}
	}

	target := net.JoinHostPort(host, portStr)
	conn, err := net.DialTimeout("tcp", target, 3*time.Second)
	if err != nil {
		return fmt.Errorf("không thể kết nối TCP tới SMTP Server %s: %w", target, err), ""
	}
	_ = conn.Close()

	return nil, fmt.Sprintf("Kết nối TCP thành công tới máy chủ SMTP %s (Port %s)", host, portStr)
}

func testSlackChannel(cfg map[string]interface{}) (error, string) {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" {
		return errors.New("vui lòng cung cấp Slack Incoming Webhook URL"), ""
	}
	parsed, err := url.Parse(webhookURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Slack Webhook URL không hợp lệ"), ""
	}

	// Nếu là URL dummy template
	if strings.Contains(webhookURL, "XXXXXXXXXXXXXXXXXXXXXXXX") {
		return nil, "Cú pháp Webhook URL hợp lệ (Sử dụng URL thực từ Slack App để nhận tin nhắn trực tiếp)"
	}

	payload := map[string]interface{}{
		"text": "🔔 [Aurora WAF] Kiểm thử gửi thông báo thành công từ console quản trị!",
	}
	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("lỗi kết nối tới Slack Webhook: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Slack phản hồi mã lỗi HTTP %d", resp.StatusCode), ""
	}

	return nil, "Đã gửi thông báo thử nghiệm thành công tới kênh Slack"
}

func testTelegramChannel(cfg map[string]interface{}) (error, string) {
	botToken, _ := cfg["bot_token"].(string)
	chatID, _ := cfg["chat_id"].(string)
	if botToken == "" {
		return errors.New("vui lòng cung cấp Telegram Bot API Token"), ""
	}

	client := &http.Client{Timeout: 4 * time.Second}
	// Kiểm tra getMe của Telegram bot
	reqURL := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", botToken)
	resp, err := client.Get(reqURL)
	if err != nil {
		return fmt.Errorf("lỗi kết nối máy chủ Telegram: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("Bot Token không hợp lệ (Telegram HTTP %d)", resp.StatusCode), ""
	}

	if chatID != "" {
		msgURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
		msgBody, _ := json.Marshal(map[string]interface{}{
			"chat_id": chatID,
			"text":    "🔔 [Aurora WAF] Kiểm thử tin nhắn Telegram từ Console quản trị.",
		})
		_, _ = client.Post(msgURL, "application/json", bytes.NewBuffer(msgBody))
	}

	return nil, "Xác thực Telegram Bot Token thành công và sẵn sàng nhận thông báo"
}

func testDiscordChannel(cfg map[string]interface{}) (error, string) {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" {
		return errors.New("vui lòng cung cấp Discord Webhook URL"), ""
	}
	parsed, err := url.Parse(webhookURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Discord Webhook URL không hợp lệ"), ""
	}

	payload := map[string]interface{}{
		"content": "🔔 **[Aurora WAF Alert]** Kết nối Discord Webhook đã được xác thực thành công.",
	}
	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("lỗi gửi tới Discord Webhook: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Discord phản hồi mã lỗi HTTP %d", resp.StatusCode), ""
	}

	return nil, "Đã gửi thông báo thử nghiệm thành công tới Discord"
}

func testCustomWebhookChannel(cfg map[string]interface{}) (error, string) {
	endpointURL, _ := cfg["endpoint_url"].(string)
	if endpointURL == "" {
		return errors.New("vui lòng cung cấp Webhook Endpoint URL"), ""
	}
	parsed, err := url.Parse(endpointURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Webhook Endpoint URL không hợp lệ"), ""
	}

	method, _ := cfg["method"].(string)
	if method == "" {
		method = "POST"
	}

	payload := map[string]interface{}{
		"event":       "test_ping",
		"system":      "Aurora WAF",
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
		"severity":    "info",
		"description": "Test ping verification from Aurora WAF console",
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest(method, endpointURL, bytes.NewBuffer(body))
	if err != nil {
		return err, ""
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Aurora-WAF-Webhook/1.0")

	// Parse headers nếu có
	if headersStr, ok := cfg["headers"].(string); ok && headersStr != "" {
		lines := strings.Split(headersStr, "\n")
		for _, line := range lines {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				req.Header.Set(strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
			}
		}
	}

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("lỗi gửi request tới endpoint: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Endpoint phản hồi mã HTTP %d", resp.StatusCode), ""
	}

	return nil, fmt.Sprintf("Webhook endpoint phản hồi thành công (HTTP %d)", resp.StatusCode)
}

func testPagerDutyChannel(cfg map[string]interface{}) (error, string) {
	routingKey, _ := cfg["routing_key"].(string)
	routingKey = strings.TrimSpace(routingKey)
	if routingKey == "" {
		return errors.New("vui lòng cấu hình PagerDuty Events API v2 Routing Key"), ""
	}
	if len(routingKey) < 16 {
		return errors.New("Routing Key không hợp lệ (độ dài tối thiểu 16 ký tự)"), ""
	}

	return nil, "Cấu hình PagerDuty Integration Key hợp lệ và sẵn sàng kích hoạt sự cố"
}
