package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

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
