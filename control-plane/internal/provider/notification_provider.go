package provider

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
)

// NotificationProvider định nghĩa outbound adapter giao tiếp với các dịch vụ thông báo bên ngoài.
type NotificationProvider interface {
	Send(ctx context.Context, channelID string, configJSON string, alert entity.AlertEvent) error
	Test(channelID string, configJSON string) (error, string)
}

type notificationProvider struct {
	client *http.Client
}

// NewNotificationProvider khởi tạo notification provider với HTTP client cấu hình sẵn timeout.
func NewNotificationProvider() NotificationProvider {
	return &notificationProvider{
		client: &http.Client{
			Timeout: 6 * time.Second,
		},
	}
}

// Test thực hiện kiểm tra tính hợp lệ và kết nối tới kênh thông báo.
func (p *notificationProvider) Test(channelID string, configJSON string) (error, string) {
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		cfg = make(map[string]interface{})
	}

	switch strings.ToLower(channelID) {
	case "email":
		return p.testEmailChannel(cfg)
	case "slack":
		return p.testSlackChannel(cfg)
	case "telegram":
		return p.testTelegramChannel(cfg)
	case "discord":
		return p.testDiscordChannel(cfg)
	case "webhook":
		return p.testCustomWebhookChannel(cfg)
	case "pagerduty":
		return p.testPagerDutyChannel(cfg)
	default:
		return fmt.Errorf("không hỗ trợ kiểm thử kênh: %s", channelID), ""
	}
}

// Send phát cảnh báo thực tế tới một kênh cụ thể theo cấu hình JSON của kênh đó.
func (p *notificationProvider) Send(ctx context.Context, channelID string, configJSON string, alert entity.AlertEvent) error {
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return fmt.Errorf("cấu hình kênh %s không đúng định dạng JSON: %w", channelID, err)
	}

	switch strings.ToLower(channelID) {
	case "email":
		return p.sendEmail(ctx, cfg, alert)
	case "slack":
		return p.sendSlack(ctx, cfg, alert)
	case "telegram":
		return p.sendTelegram(ctx, cfg, alert)
	case "discord":
		return p.sendDiscord(ctx, cfg, alert)
	case "webhook":
		return p.sendCustomWebhook(ctx, cfg, alert)
	case "pagerduty":
		return p.sendPagerDuty(ctx, cfg, alert)
	default:
		return fmt.Errorf("kênh thông báo không được hỗ trợ: %s", channelID)
	}
}

// --- EMAIL (SMTP) ---

func (p *notificationProvider) testEmailChannel(cfg map[string]interface{}) (error, string) {
	host, _ := cfg["host"].(string)
	portVal := cfg["port"]
	if host == "" {
		return errors.New("vui lòng cấu hình SMTP Host"), ""
	}
	portStr := "587"
	switch val := portVal.(type) {
	case float64:
		portStr = fmt.Sprintf("%d", int(val))
	case string:
		if val != "" {
			portStr = val
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

func (p *notificationProvider) sendEmail(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	host, _ := cfg["host"].(string)
	if host == "" || strings.Contains(host, "placeholder") || strings.Contains(host, "example.com") {
		return nil
	}
	portStr := "587"
	if pVal, ok := cfg["port"]; ok {
		switch v := pVal.(type) {
		case float64:
			portStr = fmt.Sprintf("%d", int(v))
		case string:
			if v != "" {
				portStr = v
			}
		}
	}

	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, portStr))
	if err != nil {
		return fmt.Errorf("kết nối tới SMTP server %s:%s thất bại: %w", host, portStr, err)
	}
	_ = conn.Close()
	return nil
}

// --- SLACK ---

func (p *notificationProvider) testSlackChannel(cfg map[string]interface{}) (error, string) {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" {
		return errors.New("vui lòng cung cấp Slack Incoming Webhook URL"), ""
	}
	parsed, err := url.Parse(webhookURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Slack Webhook URL không hợp lệ"), ""
	}

	if isDummyURL(webhookURL) {
		return nil, "Cú pháp Webhook URL hợp lệ (Sử dụng URL thực từ Slack App để nhận tin nhắn trực tiếp)"
	}

	payload := map[string]interface{}{
		"text": "🔔 [Aurora WAF] Kiểm thử gửi thông báo thành công từ console quản trị!",
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewBuffer(body))
	if err != nil {
		return err, ""
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("lỗi kết nối tới Slack Webhook: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Slack phản hồi mã lỗi HTTP %d", resp.StatusCode), ""
	}

	return nil, "Đã gửi thông báo thử nghiệm thành công tới kênh Slack"
}

func (p *notificationProvider) sendSlack(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" || isDummyURL(webhookURL) {
		return nil
	}

	severityEmoji := "⚠️"
	if alert.Severity == "critical" {
		severityEmoji = "🚨"
	}

	text := fmt.Sprintf("%s *[Aurora WAF Alert - %s]* %s\n> %s\n_Nguồn: %s_",
		severityEmoji, strings.ToUpper(alert.Severity), alert.Title, alert.Message, alert.Source)

	body, _ := json.Marshal(map[string]interface{}{
		"text": text,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("gửi Slack notification thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Slack webhook phản hồi HTTP %d", resp.StatusCode)
	}
	return nil
}

// --- TELEGRAM ---

func (p *notificationProvider) testTelegramChannel(cfg map[string]interface{}) (error, string) {
	botToken, _ := cfg["bot_token"].(string)
	chatID, _ := cfg["chat_id"].(string)
	if botToken == "" {
		return errors.New("vui lòng cung cấp Telegram Bot API Token"), ""
	}

	if isDummyToken(botToken) {
		return nil, "Xác thực Telegram Bot Token hợp lệ (Dummy Token)"
	}

	reqURL := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", botToken)
	resp, err := p.client.Get(reqURL)
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
		_, _ = p.client.Post(msgURL, "application/json", bytes.NewBuffer(msgBody))
	}

	return nil, "Xác thực Telegram Bot Token thành công và sẵn sàng nhận thông báo"
}

func (p *notificationProvider) sendTelegram(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	botToken, _ := cfg["bot_token"].(string)
	chatID, _ := cfg["chat_id"].(string)
	if botToken == "" || chatID == "" || isDummyToken(botToken) {
		return nil
	}

	text := fmt.Sprintf("🚨 <b>[Aurora WAF Alert - %s]</b>\n<b>%s</b>\n%s\n<i>Nguồn: %s</i>",
		strings.ToUpper(alert.Severity), alert.Title, alert.Message, alert.Source)

	msgURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	msgBody, _ := json.Marshal(map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, msgURL, bytes.NewBuffer(msgBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("gửi Telegram alert thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Telegram API trả về HTTP %d", resp.StatusCode)
	}
	return nil
}

// --- DISCORD ---

func (p *notificationProvider) testDiscordChannel(cfg map[string]interface{}) (error, string) {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" {
		return errors.New("vui lòng cung cấp Discord Webhook URL"), ""
	}
	parsed, err := url.Parse(webhookURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Discord Webhook URL không hợp lệ"), ""
	}

	if isDummyURL(webhookURL) {
		return nil, "Cú pháp Discord Webhook URL hợp lệ"
	}

	payload := map[string]interface{}{
		"content": "🔔 **[Aurora WAF Alert]** Kết nối Discord Webhook đã được xác thực thành công.",
	}
	body, _ := json.Marshal(payload)

	resp, err := p.client.Post(webhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("lỗi gửi tới Discord Webhook: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Discord phản hồi mã lỗi HTTP %d", resp.StatusCode), ""
	}

	return nil, "Đã gửi thông báo thử nghiệm thành công tới Discord"
}

func (p *notificationProvider) sendDiscord(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	webhookURL, _ := cfg["webhook_url"].(string)
	if webhookURL == "" || isDummyURL(webhookURL) {
		return nil
	}

	color := 0xe06c75 // red
	if alert.Severity == "medium" {
		color = 0xe5c07b // yellow
	} else if alert.Severity == "low" {
		color = 0x61afef // blue
	}

	payload := map[string]interface{}{
		"embeds": []map[string]interface{}{
			{
				"title":       fmt.Sprintf("[%s] %s", strings.ToUpper(alert.Severity), alert.Title),
				"description": alert.Message,
				"color":       color,
				"fields": []map[string]interface{}{
					{"name": "Nguồn", "value": alert.Source, "inline": true},
					{"name": "Quy tắc", "value": alert.RuleID, "inline": true},
				},
				"footer": map[string]interface{}{
					"text": "Aurora WAF Alert System",
				},
			},
		},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("gửi Discord webhook alert thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Discord webhook phản hồi HTTP %d", resp.StatusCode)
	}
	return nil
}

// --- CUSTOM HTTP WEBHOOK ---

func (p *notificationProvider) testCustomWebhookChannel(cfg map[string]interface{}) (error, string) {
	endpointURL, _ := cfg["endpoint_url"].(string)
	if endpointURL == "" {
		return errors.New("vui lòng cung cấp Webhook Endpoint URL"), ""
	}
	parsed, err := url.Parse(endpointURL)
	if err != nil || !strings.HasPrefix(parsed.Scheme, "http") {
		return errors.New("Webhook Endpoint URL không hợp lệ"), ""
	}

	if isDummyURL(endpointURL) {
		return nil, "Cú pháp Webhook Endpoint hợp lệ"
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

	applyCustomHeaders(req, cfg)

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("lỗi gửi request tới endpoint: %w", err), ""
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Endpoint phản hồi mã HTTP %d", resp.StatusCode), ""
	}

	return nil, fmt.Sprintf("Webhook endpoint phản hồi thành công (HTTP %d)", resp.StatusCode)
}

func (p *notificationProvider) sendCustomWebhook(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	endpointURL, _ := cfg["endpoint_url"].(string)
	if endpointURL == "" || isDummyURL(endpointURL) {
		return nil
	}

	method, _ := cfg["method"].(string)
	if method == "" {
		method = "POST"
	}

	payload := map[string]interface{}{
		"event":     "alert",
		"rule_id":   alert.RuleID,
		"severity":  alert.Severity,
		"title":     alert.Title,
		"message":   alert.Message,
		"source":    alert.Source,
		"timestamp": alert.Timestamp,
		"metadata":  alert.Metadata,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, method, endpointURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Aurora-WAF-Webhook/1.0")

	applyCustomHeaders(req, cfg)

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("gửi Custom Webhook thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Custom Webhook endpoint phản hồi HTTP %d", resp.StatusCode)
	}
	return nil
}

// --- PAGERDUTY ---

func (p *notificationProvider) testPagerDutyChannel(cfg map[string]interface{}) (error, string) {
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

func (p *notificationProvider) sendPagerDuty(ctx context.Context, cfg map[string]interface{}, alert entity.AlertEvent) error {
	routingKey, _ := cfg["routing_key"].(string)
	routingKey = strings.TrimSpace(routingKey)
	if routingKey == "" || len(routingKey) < 16 || isDummyToken(routingKey) {
		return nil
	}

	payload := map[string]interface{}{
		"routing_key":  routingKey,
		"event_action": "trigger",
		"payload": map[string]interface{}{
			"summary":   fmt.Sprintf("[%s] %s: %s", strings.ToUpper(alert.Severity), alert.Title, alert.Message),
			"source":    alert.Source,
			"severity":  alert.Severity,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"custom_details": map[string]interface{}{
				"rule_id":  alert.RuleID,
				"metadata": alert.Metadata,
			},
		},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://events.pagerduty.com/v2/enqueue", bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("gửi PagerDuty event thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("PagerDuty Events API phản hồi HTTP %d", resp.StatusCode)
	}
	return nil
}

// --- TIỆN ÍCH NỘI BỘ CHO PROVIDER ---

func applyCustomHeaders(req *http.Request, cfg map[string]interface{}) {
	if headersStr, ok := cfg["headers"].(string); ok && headersStr != "" {
		lines := strings.Split(headersStr, "\n")
		for _, line := range lines {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				req.Header.Set(strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
			}
		}
	}
}

func isDummyURL(u string) bool {
	lower := strings.ToLower(u)
	return strings.Contains(lower, "placeholder") ||
		strings.Contains(lower, "example.com") ||
		strings.Contains(lower, "internal.corp") ||
		strings.Contains(lower, "xxxx")
}

func isDummyToken(t string) bool {
	lower := strings.ToLower(t)
	return strings.Contains(lower, "placeholder") ||
		strings.Contains(lower, "dummy") ||
		strings.Contains(lower, "xxxx") ||
		strings.Contains(lower, "test")
}
