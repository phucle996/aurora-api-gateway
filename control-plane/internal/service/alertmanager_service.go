package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type alertmanagerService struct {
	repo       repo.AlertmanagerRepository
	httpClient *http.Client
}

// NewAlertmanagerService khởi tạo service adapter giao tiếp với Alertmanager & Prometheus.
func NewAlertmanagerService(repo repo.AlertmanagerRepository) port.AlertmanagerService {
	return &alertmanagerService{
		repo: repo,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (s *alertmanagerService) GetConfig(ctx context.Context) (*entity.AlertmanagerSettings, error) {
	return s.repo.GetSettings(ctx)
}

func (s *alertmanagerService) UpdateConfig(ctx context.Context, settings entity.AlertmanagerSettings) error {
	settings.AlertmanagerURL = strings.TrimRight(strings.TrimSpace(settings.AlertmanagerURL), "/")
	settings.PrometheusURL = strings.TrimRight(strings.TrimSpace(settings.PrometheusURL), "/")
	return s.repo.UpdateSettings(ctx, settings)
}

func (s *alertmanagerService) GetOverview(ctx context.Context) (*entity.AlertmanagerOverview, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}

	overview := &entity.AlertmanagerOverview{
		PrometheusURL:   settings.PrometheusURL,
		AlertmanagerURL: settings.AlertmanagerURL,
	}

	if !settings.Enabled {
		return overview, nil
	}

	// 1. Kiểm tra kết nối Prometheus
	if settings.PrometheusURL != "" {
		start := time.Now()
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, settings.PrometheusURL+"/-/ready", nil)
		if reqErr == nil {
			resp, respErr := s.httpClient.Do(req)
			if respErr == nil {
				_ = resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					overview.PrometheusConnected = true
					overview.PrometheusLatencyMs = time.Since(start).Milliseconds()
				}
			}
		}
	}

	// 2. Kiểm tra kết nối Alertmanager
	if settings.AlertmanagerURL != "" {
		start := time.Now()
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, settings.AlertmanagerURL+"/-/ready", nil)
		if reqErr == nil {
			resp, respErr := s.httpClient.Do(req)
			if respErr == nil {
				_ = resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					overview.AlertmanagerConnected = true
					overview.AlertmanagerLatencyMs = time.Since(start).Milliseconds()
				}
			}
		}
	}

	// 3. Lấy số lượng Rules nếu Prometheus kết nối thành công
	if overview.PrometheusConnected {
		rules, err := s.GetLiveRules(ctx)
		if err == nil {
			overview.TotalRulesCount = len(rules)
			for _, r := range rules {
				if r.State == "firing" {
					overview.ActiveAlertsCount += len(r.ActiveAlerts)
				}
			}
		}
	}

	// 4. Lấy số lượng Silences đang active từ Alertmanager
	if overview.AlertmanagerConnected {
		silences, err := s.GetSilences(ctx)
		if err == nil {
			activeSilences := 0
			for _, sil := range silences {
				if sil.Status == "active" {
					activeSilences++
				}
			}
			overview.ActiveSilencesCount = activeSilences
		}
	}

	return overview, nil
}

type prometheusRulesResponse struct {
	Status string `json:"status"`
	Data   struct {
		Groups []struct {
			Name  string `json:"name"`
			File  string `json:"file"`
			Rules []struct {
				State       string            `json:"state"`
				Name        string            `json:"name"`
				Query       string            `json:"query"`
				Duration    float64           `json:"duration"`
				Health      string            `json:"health"`
				LastError   string            `json:"lastError,omitempty"`
				Labels      map[string]string `json:"labels"`
				Annotations map[string]string `json:"annotations"`
				Alerts      []struct {
					Labels      map[string]string `json:"labels"`
					Annotations map[string]string `json:"annotations"`
					State       string            `json:"state"`
					ActiveAt    string            `json:"activeAt"`
					Value       string            `json:"value"`
				} `json:"alerts,omitempty"`
			} `json:"rules"`
		} `json:"groups"`
	} `json:"data"`
}

func (s *alertmanagerService) GetLiveRules(ctx context.Context) ([]entity.PrometheusRuleItem, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	if settings.PrometheusURL == "" {
		return []entity.PrometheusRuleItem{}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, settings.PrometheusURL+"/api/v1/rules", nil)
	if err != nil {
		return nil, fmt.Errorf("tạo request prometheus rules thất bại: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gọi prometheus rules API thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("prometheus rules API trả về mã lỗi %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var parsed prometheusRulesResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("giải mã prometheus rules JSON thất bại: %w", err)
	}

	var items []entity.PrometheusRuleItem
	for _, grp := range parsed.Data.Groups {
		for _, r := range grp.Rules {
			severity := r.Labels["severity"]
			if severity == "" {
				severity = "medium"
			}
			durationStr := fmt.Sprintf("%.0fs", r.Duration)
			if r.Duration >= 60 {
				durationStr = fmt.Sprintf("%.0fm", r.Duration/60)
			}

			activeAlerts := make([]entity.PrometheusActiveAlert, len(r.Alerts))
			for i, a := range r.Alerts {
				activeAlerts[i] = entity.PrometheusActiveAlert{
					Labels:      a.Labels,
					Annotations: a.Annotations,
					State:       a.State,
					ActiveAt:    a.ActiveAt,
					Value:       a.Value,
				}
			}

			items = append(items, entity.PrometheusRuleItem{
				Name:         r.Name,
				Group:        grp.Name,
				Query:        r.Query,
				Duration:     durationStr,
				Severity:     severity,
				State:        strings.ToLower(r.State),
				Health:       r.Health,
				LastError:    r.LastError,
				Labels:       r.Labels,
				Annotations:  r.Annotations,
				ActiveAlerts: activeAlerts,
			})
		}
	}

	return items, nil
}

func (s *alertmanagerService) GetFiringAlerts(ctx context.Context) ([]entity.PrometheusActiveAlert, error) {
	rules, err := s.GetLiveRules(ctx)
	if err != nil {
		return nil, err
	}

	var firing []entity.PrometheusActiveAlert
	for _, r := range rules {
		for _, a := range r.ActiveAlerts {
			if a.State == "firing" {
				firing = append(firing, a)
			}
		}
	}
	return firing, nil
}

type alertmanagerSilenceResponse struct {
	ID        string `json:"id"`
	Status    struct {
		State string `json:"state"`
	} `json:"status"`
	StartsAt  string                       `json:"startsAt"`
	EndsAt    string                       `json:"endsAt"`
	CreatedBy string                       `json:"createdBy"`
	Comment   string                       `json:"comment"`
	Matchers  []entity.AlertmanagerMatcher `json:"matchers"`
}

func (s *alertmanagerService) GetSilences(ctx context.Context) ([]entity.AlertmanagerSilenceItem, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	if settings.AlertmanagerURL == "" {
		return []entity.AlertmanagerSilenceItem{}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, settings.AlertmanagerURL+"/api/v2/silences", nil)
	if err != nil {
		return nil, fmt.Errorf("tạo request alertmanager silences thất bại: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gọi alertmanager silences API thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("alertmanager silences API trả về mã lỗi %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var raw []alertmanagerSilenceResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("giải mã alertmanager silences JSON thất bại: %w", err)
	}

	items := make([]entity.AlertmanagerSilenceItem, len(raw))
	for i, sil := range raw {
		items[i] = entity.AlertmanagerSilenceItem{
			ID:        sil.ID,
			Status:    strings.ToLower(sil.Status.State),
			StartsAt:  sil.StartsAt,
			EndsAt:    sil.EndsAt,
			CreatedBy: sil.CreatedBy,
			Comment:   sil.Comment,
			Matchers:  sil.Matchers,
		}
	}

	return items, nil
}

func (s *alertmanagerService) CreateSilence(ctx context.Context, silence entity.AlertmanagerSilenceItem) (string, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return "", err
	}
	if settings.AlertmanagerURL == "" {
		return "", fmt.Errorf("chưa cấu hình alertmanager_url")
	}

	if silence.StartsAt == "" {
		silence.StartsAt = time.Now().UTC().Format(time.RFC3339)
	}

	payload := map[string]interface{}{
		"startsAt":  silence.StartsAt,
		"endsAt":    silence.EndsAt,
		"createdBy": silence.CreatedBy,
		"comment":   silence.Comment,
		"matchers":  silence.Matchers,
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("tuần tự hóa silence payload thất bại: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, settings.AlertmanagerURL+"/api/v2/silences", bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("tạo request tạo silence thất bại: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("gửi request tới alertmanager silences API thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("alertmanager từ chối tạo silence (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	var res struct {
		SilenceID string `json:"silenceID"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", fmt.Errorf("giải mã silence ID phản hồi thất bại: %w", err)
	}

	return res.SilenceID, nil
}

func (s *alertmanagerService) ExpireSilence(ctx context.Context, silenceID string) error {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return err
	}
	if settings.AlertmanagerURL == "" {
		return fmt.Errorf("chưa cấu hình alertmanager_url")
	}

	targetURL := fmt.Sprintf("%s/api/v2/silence/%s", settings.AlertmanagerURL, silenceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, targetURL, nil)
	if err != nil {
		return fmt.Errorf("tạo request expire silence thất bại: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("gửi request expire silence thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("alertmanager expire silence thất bại (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}
