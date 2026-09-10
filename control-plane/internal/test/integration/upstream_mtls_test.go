package integration_test

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUpstreamMTLSCredentials(t *testing.T) {
	h := upstreamsFixture(t)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	root := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	rootDER, err := x509.CreateCertificate(rand.Reader, root, root, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))
	clientKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	keyDER, _ := x509.MarshalPKCS8PrivateKey(clientKey)
	secret := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}))
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "client"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
	der, _ := x509.CreateCertificate(rand.Reader, leaf, root, &clientKey.PublicKey, key)
	cert := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	call := func(method, path string, body any, status int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer upstreams-test-token-at-least-32-bytes")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s status %d: %s", method, path, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "PRIVATE KEY") {
			t.Fatal("response leaked private key")
		}
		out := map[string]any{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	ssl := map[string]any{"enabled": true, "verifyCert": true, "sniHost": "origin.test", "mTLS": true, "caCert": ca, "clientCert": cert, "clientKey": secret}
	payload := map[string]any{"name": "mtls", "architecture_type": "Single Server", "servers": []any{map[string]any{"address": "127.0.0.1:8443"}}, "internal_ssl": ssl}
	created := call("POST", "/api/v1/upstreams", payload, 201)
	if created["internal_ssl"].(map[string]any)["clientKeyConfigured"] != true {
		t.Fatal("missing configured-key status")
	}
	path := fmt.Sprintf("/api/v1/upstreams/%.0f", created["id"])
	call("GET", path, nil, 200)
	call("GET", "/api/v1/upstreams", nil, 200)
	call("GET", "/api/v1/upstream-sync/node-01", nil, 200)
	delete(ssl, "clientKey")
	payload["description"] = "retain stored key"
	call("PUT", path, payload, 200)
	ssl["clientKey"] = secret
	for _, mutation := range []func(){
		func() { ssl["clientKey"] = "invalid" },
		func() { ssl["verifyCert"] = false },
		func() { ssl["caCert"] = "not a certificate" },
		func() { ssl["caCert"] = "  \n" },
		func() { ssl["enabled"] = false },
		func() {
			leaf.NotAfter = time.Now().Add(-time.Minute)
			d, _ := x509.CreateCertificate(rand.Reader, leaf, root, &clientKey.PublicKey, key)
			ssl["clientCert"] = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: d}))
		},
	} {
		mutation()
		call("PUT", path, payload, 400)
		ssl["clientKey"] = secret
		ssl["verifyCert"] = true
		ssl["caCert"] = ca
		ssl["enabled"] = true
		ssl["clientCert"] = cert
	}
	unchanged := call("GET", path, nil, 200)
	if unchanged["version"].(float64) != 2 {
		t.Fatal("rejected changes mutated version")
	}
	call("DELETE", path, nil, 200)
}
