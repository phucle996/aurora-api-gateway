package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
)

func TestAuthLoginAndMeWorkflow(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "auth_test.db")
	a, err := app.NewApp(ctx, config.Config{
		SQLitePath: dbPath,
		JWTSecret:  "test-jwt-secret-key-32b-length!!",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	handler := a.Handler()

	// Case 1: Login with admin/admin -> Success
	loginBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "admin",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on valid login, got %d: %s", rec.Code, rec.Body.String())
	}

	var loginResp struct {
		Token     string `json:"token"`
		TokenType string `json:"token_type"`
		ExpiresIn int64  `json:"expires_in"`
		User      struct {
			ID       string `json:"id"`
			Username string `json:"username"`
			Role     string `json:"role"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &loginResp); err != nil {
		t.Fatalf("failed to decode login response: %v", err)
	}
	if loginResp.Token == "" {
		t.Fatal("expected non-empty JWT token")
	}
	if loginResp.User.Username != "admin" {
		t.Fatalf("expected username 'admin', got %q", loginResp.User.Username)
	}

	// Check HttpOnly cookie set on login response
	cookies := rec.Result().Cookies()
	var authCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "aurora_token" {
			authCookie = c
			break
		}
	}
	if authCookie == nil {
		t.Fatal("expected aurora_token cookie in login response")
	}
	if !authCookie.HttpOnly {
		t.Fatal("expected aurora_token cookie to be HttpOnly")
	}
	if authCookie.Value != loginResp.Token {
		t.Fatalf("cookie value %q does not match login token %q", authCookie.Value, loginResp.Token)
	}

	// Case 2: Validate /api/v1/auth/me using HttpOnly cookie (no Authorization header)
	meReq := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	meReq.AddCookie(authCookie)
	meRec := httptest.NewRecorder()
	handler.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on /me with cookie, got %d: %s", meRec.Code, meRec.Body.String())
	}

	var meResp struct {
		User struct {
			Username string `json:"username"`
			Role     string `json:"role"`
		} `json:"user"`
	}
	if err := json.Unmarshal(meRec.Body.Bytes(), &meResp); err != nil {
		t.Fatalf("failed to decode me response: %v", err)
	}
	if meResp.User.Username != "admin" {
		t.Fatalf("expected username 'admin' from /me, got %q", meResp.User.Username)
	}

	// Case 3: Access protected rules route with HttpOnly cookie
	rulesReq := httptest.NewRequest("GET", "/api/v1/rules/stats", nil)
	rulesReq.AddCookie(authCookie)
	rulesRec := httptest.NewRecorder()
	handler.ServeHTTP(rulesRec, rulesReq)

	if rulesRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on /api/v1/rules/stats with cookie, got %d: %s", rulesRec.Code, rulesRec.Body.String())
	}

	// Case 4: Logout clears HttpOnly cookie
	logoutReq := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	logoutRec := httptest.NewRecorder()
	handler.ServeHTTP(logoutRec, logoutReq)

	if logoutRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on logout, got %d", logoutRec.Code)
	}
	logoutCookies := logoutRec.Result().Cookies()
	var clearedCookie *http.Cookie
	for _, c := range logoutCookies {
		if c.Name == "aurora_token" {
			clearedCookie = c
			break
		}
	}
	if clearedCookie == nil || clearedCookie.MaxAge >= 0 {
		t.Fatal("expected expired aurora_token cookie on logout")
	}

	// Case 5: Invalid password -> 401 Unauthorized
	invalidBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "wrongpassword",
	})
	invReq := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(invalidBody))
	invReq.Header.Set("Content-Type", "application/json")
	invRec := httptest.NewRecorder()
	handler.ServeHTTP(invRec, invReq)

	if invRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401 on wrong password, got %d", invRec.Code)
	}

	// Case 6: Non-existent user -> 401 Unauthorized
	nonExistentBody, _ := json.Marshal(map[string]string{
		"username": "hacker",
		"password": "password",
	})
	nonExReq := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(nonExistentBody))
	nonExReq.Header.Set("Content-Type", "application/json")
	nonExRec := httptest.NewRecorder()
	handler.ServeHTTP(nonExRec, nonExReq)

	if nonExRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401 on non-existent user, got %d", nonExRec.Code)
	}

	// Case 7: /api/v1/auth/me without token/cookie -> 401 Unauthorized
	unauthReq := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	unauthRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthRec, unauthReq)

	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401 on /me without token, got %d", unauthRec.Code)
	}
}

func TestAuthTwoFactorLoginWorkflow(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "auth_2fa_test.db")
	a, err := app.NewApp(ctx, config.Config{
		SQLitePath: dbPath,
		JWTSecret:  "test-jwt-secret-key-32b-length!!",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	handler := a.Handler()

	// Enable 2FA on user usr_admin_01 directly in test DB
	pools, err := infra.OpenSQLitePool(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()

	secret := "JBSWY3DPEHPK3PXP"
	recoveryCodes := `["WAF-AAAA-BBBB","WAF-CCCC-DDDD"]`
	_, err = pools.Writer.ExecContext(ctx, "UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_recovery_codes = ? WHERE id = 'usr_admin_01'",
		secret, recoveryCodes)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Initial login: should return requires_2fa = true and two_factor_token
	loginBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "admin",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var challengeResp struct {
		Requires2FA    bool   `json:"requires_2fa"`
		TwoFactorToken string `json:"two_factor_token"`
		Token          string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &challengeResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !challengeResp.Requires2FA {
		t.Fatal("expected requires_2fa to be true")
	}
	if challengeResp.TwoFactorToken == "" {
		t.Fatal("expected non-empty two_factor_token")
	}
	if challengeResp.Token != "" {
		t.Fatal("expected session token to be empty when 2FA is pending")
	}

	// 2. Attempt to use 2fa_pending token on protected endpoint /api/v1/auth/me -> 401 Unauthorized
	protReq := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	protReq.Header.Set("Authorization", "Bearer "+challengeResp.TwoFactorToken)
	protRec := httptest.NewRecorder()
	handler.ServeHTTP(protRec, protReq)

	if protRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized when using 2fa_pending token on protected endpoint, got %d", protRec.Code)
	}

	// 3. Verify with invalid code -> 401 Unauthorized
	badVerifyBody, _ := json.Marshal(map[string]string{
		"two_factor_token": challengeResp.TwoFactorToken,
		"code":             "000000",
	})
	badReq := httptest.NewRequest("POST", "/api/v1/auth/2fa/login-verify", bytes.NewReader(badVerifyBody))
	badReq.Header.Set("Content-Type", "application/json")
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)

	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on wrong 2FA code, got %d", badRec.Code)
	}

	// 4. Verify with recovery code -> 200 OK and session JWT
	goodVerifyBody, _ := json.Marshal(map[string]string{
		"two_factor_token": challengeResp.TwoFactorToken,
		"code":             "WAF-AAAA-BBBB",
	})
	goodReq := httptest.NewRequest("POST", "/api/v1/auth/2fa/login-verify", bytes.NewReader(goodVerifyBody))
	goodReq.Header.Set("Content-Type", "application/json")
	goodRec := httptest.NewRecorder()
	handler.ServeHTTP(goodRec, goodReq)

	if goodRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid recovery code, got %d: %s", goodRec.Code, goodRec.Body.String())
	}

	var sessionResp struct {
		Token string `json:"token"`
		User  struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.Unmarshal(goodRec.Body.Bytes(), &sessionResp); err != nil {
		t.Fatalf("failed to decode session response: %v", err)
	}
	if sessionResp.Token == "" || sessionResp.User.Username != "admin" {
		t.Fatalf("invalid session response: %+v", sessionResp)
	}

	// 5. Test protected endpoint with real session token -> 200 OK
	meReq := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+sessionResp.Token)
	meRec := httptest.NewRecorder()
	handler.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /me with session token, got %d", meRec.Code)
	}

	// 6. Test single-step login with code in payload -> 200 OK
	singleStepBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "admin",
		"code":     "WAF-CCCC-DDDD",
	})
	singleReq := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(singleStepBody))
	singleReq.Header.Set("Content-Type", "application/json")
	singleRec := httptest.NewRecorder()
	handler.ServeHTTP(singleRec, singleReq)

	if singleRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on single-step login with recovery code, got %d: %s", singleRec.Code, singleRec.Body.String())
	}

	var singleResp struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(singleRec.Body.Bytes(), &singleResp)
	if singleResp.Token == "" {
		t.Fatal("expected valid token from single-step 2FA login")
	}
}
