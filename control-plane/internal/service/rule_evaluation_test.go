package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"errors"
	"testing"
)

type missingTestRuleRepository struct{ repo.RuleRepository }

func (missingTestRuleRepository) Detail(context.Context, entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	return entity.RuleDetailResult{}, taxonomy.ErrRuleNotFound
}

func TestRuleEvaluationUsesExplicitOperators(t *testing.T) {
	cases := []struct {
		name, field, operator, value, body string
		matched, invalid                   bool
	}{
		{"literal regex characters", "body", "contains", "a+b", "aaab", false, false},
		{"literal match", "body", "contains", "a+b", "a+b", true, false},
		{"case sensitive literal", "body", "contains", "ABC", "abc", false, false},
		{"no form decoding in body", "body", "equals", "a b", "a+b", false, false},
		{"explicit regex", "body", "regex", "a+b", "aaab", true, false},
		{"invalid regex", "body", "regex", "[", "abc", false, true},
		{"unknown operator", "body", "almost_equals", "abc", "abc", false, true},
		{"unknown field", "fake_path", "equals", "/", "", false, true},
		{"invalid cidr", "client_ip", "cidr", "wrong", "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &ruleService{}
			got, err := s.Test(context.Background(), entity.TestRuleCommand{Body: tc.body, Conditions: []entity.RuleDetailCondition{{Field: tc.field, Operator: tc.operator, Value: tc.value}}})
			if tc.invalid {
				if !errors.Is(err, taxonomy.ErrRuleInvalid) {
					t.Fatalf("expected invalid input, got %v", err)
				}
				return
			}
			if err != nil || got.Matched != tc.matched {
				t.Fatalf("matched=%v err=%v", got.Matched, err)
			}
			if got.LatencyMS != float64(got.EvaluationTimeNs)/1e6 {
				t.Fatal("latency differs from measured duration")
			}
		})
	}
}
func TestRuleEvaluationHeaderCaseAndMissingRule(t *testing.T) {
	s := &ruleService{repo: missingTestRuleRepository{}}
	cmd := entity.TestRuleCommand{Headers: map[string]string{"x-test": "value"}, Conditions: []entity.RuleDetailCondition{{Field: "header", HeaderName: "X-Test", Operator: "equals", Value: "value"}}}
	got, err := s.Test(context.Background(), cmd)
	if err != nil || !got.Matched {
		t.Fatalf("header case: matched=%v err=%v", got.Matched, err)
	}
	cmd.Headers["X-TEST"] = "other"
	if _, err := s.Test(context.Background(), cmd); !errors.Is(err, taxonomy.ErrRuleInvalid) {
		t.Fatalf("ambiguous headers accepted: %v", err)
	}
	id := int64(999999)
	if _, err := s.Test(context.Background(), entity.TestRuleCommand{RuleID: &id}); !errors.Is(err, taxonomy.ErrRuleNotFound) {
		t.Fatalf("missing rule accepted: %v", err)
	}
}
