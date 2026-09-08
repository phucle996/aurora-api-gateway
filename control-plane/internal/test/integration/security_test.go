package integration_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const securityTestToken = "test-token-at-least-32-bytes-long-1234"

func securityFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "security.db")
	a, err := app.NewApp(context.Background(), config.Config{
		SQLitePath: path,
		JWTSecret:  securityTestToken,
	})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Close() })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	cfg := config.Config{
		SQLitePath: path,
		JWTSecret:  securityTestToken,
	}
	module := app.NewModule(pools.Writer, pools.Reader, cfg)
	app.RegisterRoutes(router, module, securityTestToken)
	return router
}

func computeHOTPCode(secret string, step int64) string {
	cleanSecret := strings.ToUpper(strings.ReplaceAll(secret, " ", ""))
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(cleanSecret)
	counterBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(counterBytes, uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counterBytes)
	hash := mac.Sum(nil)
	offset := hash[len(hash)-1] & 0x0F
	truncatedHash := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7FFFFFFF
	codeInt := truncatedHash % 1000000
	return fmt.Sprintf("%06d", codeInt)
}

func TestSecurityWorkflow_EndToEnd(t *testing.T) {
	handler := securityFixture(t)

	// 1. GET /api/v1/settings/security
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/security", nil)
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GetOverview, got %d: %s", rec.Code, rec.Body.String())
	}

	var overview struct {
		AuthProviders []struct {
			ID      string `json:"id"`
			Enabled bool   `json:"enabled"`
		} `json:"auth_providers"`
		TwoFactor struct {
			Enabled bool `json:"enabled"`
		} `json:"two_factor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &overview); err != nil {
		t.Fatalf("failed to decode overview JSON: %v", err)
	}

	if len(overview.AuthProviders) != 4 {
		t.Fatalf("expected 4 auth providers, got %d", len(overview.AuthProviders))
	}
	if !overview.AuthProviders[0].Enabled || overview.AuthProviders[0].ID != "local" {
		t.Fatalf("expected local auth provider to be enabled by default")
	}
	if overview.TwoFactor.Enabled {
		t.Fatalf("expected 2FA to be disabled initially")
	}

	// 2. Prevent disabling the last active provider (Local)
	disableLocalReq := dto.UpdateAuthProviderRequest{
		Enabled:    false,
		ConfigJSON: `{}`,
	}
	bodyBytes, _ := json.Marshal(disableLocalReq)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/security/auth-providers/local", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when disabling last active provider, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Enable OIDC provider
	enableOidcReq := dto.UpdateAuthProviderRequest{
		Enabled:    true,
		ConfigJSON: `{"issuer_url":"https://accounts.google.com","client_id":"test-client"}`,
	}
	bodyBytes, _ = json.Marshal(enableOidcReq)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/security/auth-providers/oidc", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for updating OIDC, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Init 2FA
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/security/2fa/init", nil)
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Init2FA, got %d: %s", rec.Code, rec.Body.String())
	}

	var initOut struct {
		Secret     string `json:"secret"`
		OtpAuthURL string `json:"otpauth_url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &initOut); err != nil {
		t.Fatalf("failed to parse Init2FA output: %v", err)
	}
	if initOut.Secret == "" || !strings.HasPrefix(initOut.OtpAuthURL, "otpauth://totp/") {
		t.Fatalf("invalid init 2FA output: %+v", initOut)
	}

	// 5. Verify 2FA with incorrect code (expect failure)
	verifyBadReq := dto.Verify2FARequest{
		Secret: initOut.Secret,
		Code:   "000000",
	}
	bodyBytes, _ = json.Marshal(verifyBadReq)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/security/2fa/verify", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for wrong 2FA code, got %d", rec.Code)
	}

	// 6. Verify 2FA with correct TOTP code
	currentStep := time.Now().Unix() / 30
	validCode := computeHOTPCode(initOut.Secret, currentStep)
	verifyGoodReq := dto.Verify2FARequest{
		Secret: initOut.Secret,
		Code:   validCode,
	}
	bodyBytes, _ = json.Marshal(verifyGoodReq)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/security/2fa/verify", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid 2FA verify, got %d: %s", rec.Code, rec.Body.String())
	}

	var verifyOut struct {
		Enabled       bool     `json:"enabled"`
		RecoveryCodes []string `json:"recovery_codes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &verifyOut); err != nil {
		t.Fatalf("failed to decode verify output: %v", err)
	}
	if !verifyOut.Enabled || len(verifyOut.RecoveryCodes) != 6 {
		t.Fatalf("expected 6 recovery codes, got %d", len(verifyOut.RecoveryCodes))
	}

	// 7. Change Password - with wrong current password (expect failure)
	changeBadPassReq := dto.ChangePasswordRequest{
		CurrentPassword: "wrong-current-password",
		NewPassword:     "NewSecretPass@123",
	}
	bodyBytes, _ = json.Marshal(changeBadPassReq)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/security/change-password", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for incorrect current password, got %d", rec.Code)
	}

	// 8. Change Password - with correct current password "admin"
	changeGoodPassReq := dto.ChangePasswordRequest{
		CurrentPassword: "admin",
		NewPassword:     "NewSecretPass@123",
	}
	bodyBytes, _ = json.Marshal(changeGoodPassReq)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/security/change-password", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+securityTestToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for password change, got %d: %s", rec.Code, rec.Body.String())
	}

	// 9. Verify login with the new password works!
	loginReq := dto.LoginRequest{
		Username: "admin",
		Password: "NewSecretPass@123",
	}
	bodyBytes, _ = json.Marshal(loginReq)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login with new password, got %d: %s", rec.Code, rec.Body.String())
	}
}
