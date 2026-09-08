package service_test

import (
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/service"
)

func TestValidateCron(t *testing.T) {
	validExpressions := []string{
		"0 2 * * *",
		"*/15 * * * *",
		"0 */6 * * *",
		"30 1 * * 1-5",
		"0 0 1,15 * *",
		"0 0 1 1 *",
		"59 23 31 12 7",
		"0 0 * * 0",
	}

	for _, expr := range validExpressions {
		if err := service.ValidateCron(expr); err != nil {
			t.Errorf("expected valid cron for %q, got error: %v", expr, err)
		}
	}

	invalidExpressions := []string{
		"",
		"* * * *",      // 4 fields
		"* * * * * *",  // 6 fields
		"60 * * * *",   // minute > 59
		"* 24 * * *",   // hour > 23
		"* * 32 * *",   // day > 31
		"* * * 13 *",   // month > 12
		"* * * * 8",    // weekday > 7
		"*/0 * * * *",  // step 0
		"10-5 * * * *", // start > end
		"abc * * * *",  // non-numeric
	}

	for _, expr := range invalidExpressions {
		if err := service.ValidateCron(expr); err == nil {
			t.Errorf("expected error for invalid cron %q, got nil", expr)
		}
	}
}

func TestMatchCron(t *testing.T) {
	// 2026-09-07 02:00:00 UTC (Monday)
	targetTime := time.Date(2026, 9, 7, 2, 0, 0, 0, time.UTC)

	tests := []struct {
		expr     string
		expected bool
	}{
		{"0 2 * * *", true},
		{"0 2 * * 1", true},    // Monday = 1
		{"0 2 * * 0", false},   // Sunday = 0
		{"*/30 * * * *", true}, // 0 % 30 == 0
		{"0 */2 * * *", true},  // 2 % 2 == 0
		{"0 3 * * *", false},
		{"15 2 * * *", false},
		{"0 2 7 9 *", true}, // Sep 7
		{"0 2 8 9 *", false},
	}

	for _, tc := range tests {
		matched, err := service.MatchCron(tc.expr, targetTime)
		if err != nil {
			t.Fatalf("MatchCron(%q) unexpected error: %v", tc.expr, err)
		}
		if matched != tc.expected {
			t.Errorf("MatchCron(%q) = %v, expected %v", tc.expr, matched, tc.expected)
		}
	}
}
