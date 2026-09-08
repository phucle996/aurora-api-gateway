package provider

import (
	"context"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

func TestNotificationProvider_TestChannels(t *testing.T) {
	p := NewNotificationProvider()

	tests := []struct {
		name      string
		channelID string
		config    string
		wantErr   bool
	}{
		{
			name:      "Slack dummy webhook",
			channelID: "slack",
			config:    `{"webhook_url":"https://example.com/slack-webhook-placeholder"}`,
			wantErr:   false,
		},
		{
			name:      "Slack missing url",
			channelID: "slack",
			config:    `{"webhook_url":""}`,
			wantErr:   true,
		},
		{
			name:      "Discord dummy webhook",
			channelID: "discord",
			config:    `{"webhook_url":"https://example.com/discord-placeholder"}`,
			wantErr:   false,
		},
		{
			name:      "Discord missing url",
			channelID: "discord",
			config:    `{"webhook_url":""}`,
			wantErr:   true,
		},
		{
			name:      "Telegram dummy token",
			channelID: "telegram",
			config:    `{"bot_token":"dummy-token-123","chat_id":"12345"}`,
			wantErr:   false,
		},
		{
			name:      "Telegram missing token",
			channelID: "telegram",
			config:    `{"bot_token":""}`,
			wantErr:   true,
		},
		{
			name:      "Custom webhook dummy endpoint",
			channelID: "webhook",
			config:    `{"endpoint_url":"https://example.com/webhook-placeholder","method":"POST"}`,
			wantErr:   false,
		},
		{
			name:      "Custom webhook empty endpoint",
			channelID: "webhook",
			config:    `{"endpoint_url":""}`,
			wantErr:   true,
		},
		{
			name:      "PagerDuty valid dummy key",
			channelID: "pagerduty",
			config:    `{"routing_key":"1234567890123456"}`,
			wantErr:   false,
		},
		{
			name:      "PagerDuty short key",
			channelID: "pagerduty",
			config:    `{"routing_key":"short"}`,
			wantErr:   true,
		},
		{
			name:      "Email missing host",
			channelID: "email",
			config:    `{"host":""}`,
			wantErr:   true,
		},
		{
			name:      "Unsupported channel",
			channelID: "unsupported",
			config:    `{}`,
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err, _ := p.Test(tt.channelID, tt.config)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Test(%s) error = %v, wantErr = %v", tt.channelID, err, tt.wantErr)
			}
		})
	}
}

func TestNotificationProvider_SendAlert(t *testing.T) {
	p := NewNotificationProvider()
	ctx := context.Background()

	alert := entity.AlertEvent{
		RuleID:    "rule_critical_threats",
		Title:     "SQL Injection Detected",
		Message:   "Blocked suspicious payload from 192.168.1.100",
		Severity:  "critical",
		Source:    "waf-engine",
		Timestamp: 1700000000000,
	}

	// Should not fail for dummy/placeholder configurations
	channels := []struct {
		id  string
		cfg string
	}{
		{"slack", `{"webhook_url":"https://example.com/slack-placeholder"}`},
		{"discord", `{"webhook_url":"https://example.com/discord-placeholder"}`},
		{"telegram", `{"bot_token":"dummy-token-placeholder","chat_id":"12345"}`},
		{"webhook", `{"endpoint_url":"https://example.com/webhook-placeholder"}`},
		{"pagerduty", `{"routing_key":"placeholder-123456789"}`},
		{"email", `{"host":"placeholder.local"}`},
	}

	for _, ch := range channels {
		t.Run("Send to "+ch.id, func(t *testing.T) {
			if err := p.Send(ctx, ch.id, ch.cfg, alert); err != nil {
				t.Fatalf("Send(%s) unexpected error: %v", ch.id, err)
			}
		})
	}
}
