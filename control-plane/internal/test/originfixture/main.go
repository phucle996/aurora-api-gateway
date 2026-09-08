// Local integration fixture: reports what the origin actually received.
package main

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/quic-go/quic-go/http3"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

func main() {
	dir := os.Args[1]
	pair, err := tls.LoadX509KeyPair(filepath.Join(dir, "origin.crt"), filepath.Join(dir, "origin.key"))
	if err != nil {
		log.Fatal(err)
	}
	ca, err := os.ReadFile(filepath.Join(dir, "ca.crt"))
	if err != nil {
		log.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(ca)
	var healthy atomic.Bool
	healthy.Store(true)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			if !healthy.Load() {
				w.WriteHeader(503)
			}
			return
		}
		if r.URL.Path == "/admin/health" {
			healthy.Store(r.URL.Query().Get("value") != "false")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		body := raw
		if r.URL.Path == "/grpc" {
			var decoded bytes.Buffer
			for len(body) > 0 {
				if len(body) < 5 {
					http.Error(w, "short frame", 400)
					return
				}
				n := int(binary.BigEndian.Uint32(body[1:5]))
				if n > len(body)-5 {
					http.Error(w, "short message", 400)
					return
				}
				message := body[5 : 5+n]
				if body[0] == 1 {
					gz, e := gzip.NewReader(bytes.NewReader(message))
					if e != nil {
						http.Error(w, e.Error(), 400)
						return
					}
					message, e = io.ReadAll(gz)
					gz.Close()
					if e != nil {
						http.Error(w, e.Error(), 400)
						return
					}
				}
				decoded.Write(message)
				body = body[5+n:]
			}
			sum := sha256.Sum256(decoded.Bytes())
			message := []byte(hex.EncodeToString(sum[:]))
			frame := make([]byte, 5)
			binary.BigEndian.PutUint32(frame[1:], uint32(len(message)))
			w.Header().Set("Content-Type", "application/grpc")
			w.Header().Set("Origin-Encoding", r.Header.Get("Grpc-Encoding"))
			w.Header().Set("Trailer", "Grpc-Status, Grpc-Message")
			w.Write(append(frame, message...))
			w.Header().Set("Grpc-Status", "0")
			return
		}
		var reader io.ReadCloser
		switch r.Header.Get("Content-Encoding") {
		case "gzip":
			reader, err = gzip.NewReader(bytes.NewReader(raw))
		case "deflate":
			reader, err = zlib.NewReader(bytes.NewReader(raw))
		}
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if reader != nil {
			body, err = io.ReadAll(reader)
			reader.Close()
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
		}
		sum := sha256.Sum256(body)
		client := ""
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			client = r.TLS.PeerCertificates[0].Subject.CommonName
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"protocol": r.Proto, "encoding": r.Header.Get("Content-Encoding"), "bytes": len(body), "wire_bytes": len(raw), "sha256": hex.EncodeToString(sum[:]), "client": client, "host": r.Host, "transport_header": r.Header.Get("X-Aurora-Transport")})
	})
	addresses := map[string]int{}
	for _, mode := range []string{"plain", "tls", "mtls"} {
		listener, e := net.Listen("tcp", "0.0.0.0:0")
		if e != nil {
			log.Fatal(e)
		}
		addresses[mode] = listener.Addr().(*net.TCPAddr).Port
		if mode == "plain" {
			go http.Serve(listener, h2c.NewHandler(handler, &http2.Server{}))
			continue
		}
		conf := &tls.Config{Certificates: []tls.Certificate{pair}, ClientCAs: roots, NextProtos: []string{"h2", "http/1.1"}, MinVersion: tls.VersionTLS12}
		if mode == "mtls" {
			conf.ClientAuth = tls.RequireAndVerifyClientCert
		}
		server := &http.Server{Handler: handler, TLSConfig: conf}
		http2.ConfigureServer(server, &http2.Server{})
		go server.Serve(tls.NewListener(listener, conf))
	}
	for _, mode := range []string{"quic", "quic_mtls"} {
		packet, e := net.ListenPacket("udp", "0.0.0.0:0")
		if e != nil {
			log.Fatal(e)
		}
		addresses[mode] = packet.LocalAddr().(*net.UDPAddr).Port
		conf := &tls.Config{Certificates: []tls.Certificate{pair}, ClientCAs: roots, MinVersion: tls.VersionTLS13}
		if mode == "quic_mtls" {
			conf.ClientAuth = tls.RequireAndVerifyClientCert
		}
		server := &http3.Server{Handler: handler, TLSConfig: conf}
		go server.Serve(packet)
	}
	json.NewEncoder(os.Stdout).Encode(addresses)
	select {}
}
