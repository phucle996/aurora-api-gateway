package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"fmt"
	"net/netip"
	"regexp"
	"strings"
	"unicode/utf8"
)

type createDefinitionService struct {
	repo repo.CreateRuleDefinitionRepository
}

func NewCreateRuleDefinitionService(r repo.CreateRuleDefinitionRepository) port.CreateRuleDefinitionService {
	return &createDefinitionService{r}
}
func (s *createDefinitionService) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand) (entity.CreateRuleDefinitionResult, error) {
	invalid := map[string]string{}
	if len(c.RequestKey) < 16 || len(c.RequestKey) > 128 {
		invalid["idempotency_key"] = "Use a stable key of 16..128 characters for this submission"
	}
	if strings.TrimSpace(c.Name) == "" || len(c.Name) > 120 || !utf8.ValidString(c.Name) {
		invalid["name"] = "Required, at most 120 UTF-8 bytes"
	}
	if len(c.Description) > 2000 || !utf8.ValidString(c.Description) {
		invalid["description"] = "At most 2000 UTF-8 bytes"
	}
	if c.Priority < 0 || c.Priority > 1000000 {
		invalid["priority"] = "Must be between 0 and 1000000"
	}
	if c.Score < 0 || c.Score > 1000 {
		invalid["score"] = "Must be between 0 and 1000"
	}
	switch c.Group {
	case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		invalid["group"] = "Unknown rule group"
	}
	switch c.Severity {
	case "low", "medium", "high", "critical":
	default:
		invalid["severity"] = "Unknown severity"
	}
	if c.PolicyID != nil {
		invalid["policy_id"] = "Create unassigned; policy binding is a separate workflow"
	}
	if c.LogicMode != "all" && c.LogicMode != "any" {
		invalid["logic_mode"] = "Use all or any"
	}
	if len(c.Conditions) < 1 || len(c.Conditions) > 16 {
		invalid["conditions"] = "Supply 1..16 ordered conditions"
		return entity.CreateRuleDefinitionResult{}, &entity.CreateRuleFieldError{Fields: invalid}
	}
	totalPatternBytes := 0
	for i, condition := range c.Conditions {
		prefix := fmt.Sprintf("conditions[%d]", i)
		switch condition.Field {
		case "uri_raw", "path", "query", "header", "body", "client_ip", "method":
		default:
			invalid[prefix+".field"] = "Unknown request field"
		}
		switch condition.Operator {
		case "equals", "contains", "starts_with", "ends_with", "regex", "cidr":
		default:
			invalid[prefix+".operator"] = "Unknown operator"
		}
		if condition.Value == "" || len(condition.Value) > 8192 || !utf8.ValidString(condition.Value) || strings.ContainsRune(condition.Value, 0) {
			invalid[prefix+".value"] = "Required, at most 8192 UTF-8 bytes, no NUL"
		}
		if condition.Field == "header" {
			if len(condition.HeaderName) < 1 || len(condition.HeaderName) > 128 {
				invalid[prefix+".header_name"] = "Header name required (max 128 bytes)"
			}
			for _, b := range []byte(condition.HeaderName) {
				if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("!#$%&'*+-.^_\x60|~", rune(b))) {
					invalid[prefix+".header_name"] = "Invalid HTTP header token"
				}
			}
		} else if condition.HeaderName != "" {
			invalid[prefix+".header_name"] = "Only valid for header conditions"
		}
		if condition.Operator == "cidr" {
			if condition.Field != "client_ip" {
				invalid[prefix+".operator"] = "CIDR operator requires client_ip"
			}
			if _, err := netip.ParsePrefix(condition.Value); err != nil {
				invalid[prefix+".value"] = "Invalid IPv4/IPv6 CIDR"
			}
		} else if condition.Field == "client_ip" {
			if condition.Operator != "equals" {
				invalid[prefix+".operator"] = "Client IP supports equals or cidr"
			}
			if _, err := netip.ParseAddr(condition.Value); err != nil {
				invalid[prefix+".value"] = "Invalid IPv4/IPv6 address"
			}
		}
		if condition.Operator == "regex" {
			totalPatternBytes += len(condition.Value)
			if len(condition.Value) > 1024 {
				invalid[prefix+".value"] = "Regex limited to 1024 bytes"
			} else if _, err := regexp.Compile(condition.Value); err != nil {
				invalid[prefix+".value"] = "Invalid RE2-compatible regex (no backreferences/lookaround)"
			}
		}
	}
	if totalPatternBytes > 4096 {
		invalid["conditions"] = "Combined regex budget is 4096 bytes"
	}
	switch c.Action {
	case "allow", "log":
		if c.ResponseCode != nil {
			invalid["response_code"] = "Only block controls the HTTP response"
		}
		if c.CustomResponse != "" {
			invalid["custom_response"] = "Only block accepts a response body"
		}
	case "block":
		if c.ResponseCode == nil {
			invalid["response_code"] = "Required for block"
		} else {
			switch *c.ResponseCode {
			case 400, 403, 429, 500:
			default:
				invalid["response_code"] = "Use 400, 403, 429 or 500"
			}
		}
	default:
		invalid["action"] = "Supported definitions: allow, log, block; CAPTCHA is not available"
	}
	if utf8.RuneCountInString(c.CustomResponse) > 512 || !utf8.ValidString(c.CustomResponse) || strings.ContainsRune(c.CustomResponse, 0) {
		invalid["custom_response"] = "At most 512 characters, no NUL"
	}
	if c.SourceIP != "" {
		entries := strings.Split(c.SourceIP, ",")
		if len(entries) > 32 || len(c.SourceIP) > 2048 {
			invalid["source_ip"] = "At most 32 addresses/CIDRs, 2048 bytes"
		}
		for _, entry := range entries {
			entry = strings.TrimSpace(entry)
			_, a := netip.ParseAddr(entry)
			_, p := netip.ParsePrefix(entry)
			if a != nil && p != nil {
				invalid["source_ip"] = "Use comma-separated IPv4/IPv6 addresses or CIDRs"
			}
		}
	}
	if c.HostDomain != "" {
		if len(c.HostDomain) > 253 {
			invalid["host_domain"] = "Hostname too long"
		}
		for _, label := range strings.Split(c.HostDomain, ".") {
			if len(label) < 1 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
				invalid["host_domain"] = "Use an ASCII hostname without scheme, port or wildcard"
			}
			for _, b := range []byte(label) {
				if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-') {
					invalid["host_domain"] = "Use an ASCII hostname without scheme, port or wildcard"
				}
			}
		}
	}
	if c.PathPrefix != "" && (!strings.HasPrefix(c.PathPrefix, "/") || len(c.PathPrefix) > 8192 || strings.ContainsAny(c.PathPrefix, "\x00\r\n?#")) {
		invalid["path_prefix"] = "Use a path prefix, max 8192 bytes, without query/fragment/controls"
	}
	for _, b := range []byte(c.PathPrefix) {
		if b < 32 || b == 127 {
			invalid["path_prefix"] = "Path prefix must not contain control characters"
		}
	}
	switch c.HTTPMethod {
	case "", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
	default:
		invalid["http_method"] = "Unknown HTTP method"
	}
	if len(invalid) > 0 {
		return entity.CreateRuleDefinitionResult{}, &entity.CreateRuleFieldError{Fields: invalid}
	}

	// Compatibility is conservative and fail-closed, not an assertion that syntax
	// validation makes extended predicates executable by the exact-path engine.
	issues := []string{}
	path := ""
	if len(c.Conditions) != 1 || c.Conditions[0].Field != "path" || c.Conditions[0].Operator != "equals" {
		issues = append(issues, "Runtime currently requires one Request Path / Equals condition")
	} else {
		path = c.Conditions[0].Value
		canonical := strings.HasPrefix(path, "/") && !strings.ContainsAny(path, "%?#\\") && !strings.Contains(path, "//")
		for _, b := range []byte(path) {
			if b <= 32 || b >= 127 {
				canonical = false
			}
		}
		for _, segment := range strings.Split(path, "/") {
			if segment == "." || segment == ".." {
				canonical = false
			}
		}
		if !canonical {
			issues = append(issues, "Runtime requires a canonical ASCII path without escapes or dot segments")
			path = ""
		}
	}
	if c.SourceIP != "" || c.HostDomain != "" || c.PathPrefix != "" || c.HTTPMethod != "" {
		issues = append(issues, "Runtime scope filtering is not implemented")
	}
	if c.Action == "block" && (*c.ResponseCode != 403 || c.CustomResponse != "") {
		issues = append(issues, "Runtime supports only the default 403 response body")
	}
	if c.LogEvent {
		issues = append(issues, "Per-rule security event collection is not implemented")
	}
	if c.AddToReputation {
		issues = append(issues, "IP reputation mutations are not implemented")
	}
	return s.repo.CreateDefinition(ctx, c, issues, path)
}
