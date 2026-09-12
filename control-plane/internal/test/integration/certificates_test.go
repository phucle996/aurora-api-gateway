package integration_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/migrations"
	"github.com/gin-gonic/gin"
)

func generateTestCertPair(t *testing.T) (string, string) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "api.aurora.local",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	return string(certPEM), string(keyPEM)
}

func certificatesFixture(t *testing.T) (http.Handler, string) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "certs.db")
	db, err := infra.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}

	for _, m := range []string{
		migrations.Tables,
		migrations.Seeds,
	} {
		if _, err := db.Exec(m); err != nil {
			t.Fatalf("migration failed: %v", err)
		}
	}

	cfg := config.Config{
		SQLitePath: path,
		JWTSecret:  "certs-test-token-at-least-32-bytes",
	}
	module := app.NewModule(db, db, cfg)
	router := gin.New()
	token := "certs-operator-secret-token"
	app.RegisterRoutes(router, module, token)
	return router, token
}

func TestCertificatesCRUD(t *testing.T) {
	handler, token := certificatesFixture(t)
	certPEM, keyPEM := generateTestCertPair(t)

	request := func(method, path string, body interface{}, wantCode int) map[string]interface{} {
		var reqBody []byte
		if body != nil {
			reqBody, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(reqBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != wantCode {
			t.Fatalf("%s %s expected status %d, got %d: %s", method, path, wantCode, w.Code, w.Body.String())
		}
		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		return res
	}

	// 1. Tạo certificate thành công
	createRes := request("POST", "/api/v1/certificates", map[string]interface{}{
		"name":         "Aurora API Wildcard",
		"snis":         []string{"api.aurora.local", "*.aurora.local"},
		"cert_pem":     certPEM,
		"key_pem":      keyPEM,
		"mtls_enabled": false,
		"description":  "Primary edge SSL cert",
	}, 201)

	certID := createRes["id"].(string)
	if certID == "" {
		t.Fatal("expected non-empty cert ID")
	}
	if _, exposed := createRes["key_pem"]; exposed || createRes["key_configured"] != true {
		t.Fatalf("certificate create response must not expose private key: %v", createRes)
	}

	// 2. Tạo thất bại do cert và key không khớp
	request("POST", "/api/v1/certificates", map[string]interface{}{
		"name":     "Mismatched Cert",
		"snis":     []string{"test.local"},
		"cert_pem": certPEM,
		"key_pem":  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
	}, 400)

	// 3. Tạo thất bại do mTLS thiếu client CA
	request("POST", "/api/v1/certificates", map[string]interface{}{
		"name":         "mTLS without CA",
		"snis":         []string{"mtls.local"},
		"cert_pem":     certPEM,
		"key_pem":      keyPEM,
		"mtls_enabled": true,
	}, 400)

	// 4. Lấy chi tiết
	getRes := request("GET", fmt.Sprintf("/api/v1/certificates/%s", certID), nil, 200)
	if getRes["name"] != "Aurora API Wildcard" {
		t.Fatalf("unexpected certificate: %v", getRes)
	}
	if _, exposed := getRes["key_pem"]; exposed || getRes["key_configured"] != true {
		t.Fatalf("certificate read response must not expose private key: %v", getRes)
	}

	// 5. Cập nhật certificate
	updateRes := request("PUT", fmt.Sprintf("/api/v1/certificates/%s", certID), map[string]interface{}{
		"name":        "Aurora API Wildcard v2",
		"snis":        []string{"api.aurora.local"},
		"cert_pem":    certPEM,
		"key_pem":     keyPEM,
		"description": "Updated cert",
	}, 200)
	if updateRes["name"] != "Aurora API Wildcard v2" {
		t.Fatalf("update failed: %v", updateRes)
	}

	// 6. Xóa certificate
	request("DELETE", fmt.Sprintf("/api/v1/certificates/%s", certID), nil, 200)

	// 7. Xác nhận đã xóa
	request("GET", fmt.Sprintf("/api/v1/certificates/%s", certID), nil, 404)
}
