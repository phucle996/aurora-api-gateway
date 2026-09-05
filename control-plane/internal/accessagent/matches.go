// Package accessagent forwards bounded, sampled NGINX access matches. Cursor
// acknowledgement follows controller commit so replay cannot duplicate alerts.
package accessagent

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var matchLine = regexp.MustCompile(`^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2} \[notice\] \d+#\d+: AuroraAccess generation=\d+ rule=\d+ ip=[0-9a-fA-F:.]+\n$`)

type Forwarder struct {
	Log, Cursor, Controller, NodeID, Token string
	Client                                 *http.Client
}
type cursor struct {
	Inode  uint64
	Offset int64
	Epoch  string
}

func (f Forwarder) Step(ctx context.Context) error {
	file, e := os.Open(f.Log)
	if e != nil {
		return e
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil {
		return e
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fmt.Errorf("missing log inode")
	}
	var c cursor
	b, e := os.ReadFile(f.Cursor)
	if e == nil {
		if json.Unmarshal(b, &c) != nil {
			return fmt.Errorf("invalid access match cursor")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if c.Epoch == "" || c.Inode != st.Ino || info.Size() < c.Offset {
		entropy := make([]byte, 16)
		if _, e = rand.Read(entropy); e != nil {
			return e
		}
		c = cursor{Inode: st.Ino, Epoch: hex.EncodeToString(entropy)}
	}
	persist := func() error {
		b, _ := json.Marshal(c)
		temp, e := os.CreateTemp(filepath.Dir(f.Cursor), ".access-cursor-*")
		if e != nil {
			return e
		}
		name := temp.Name()
		if _, e = temp.Write(b); e == nil {
			e = temp.Sync()
		}
		closeErr := temp.Close()
		if e == nil {
			e = closeErr
		}
		if e == nil {
			e = os.Rename(name, f.Cursor)
		}
		if e != nil {
			_ = os.Remove(name)
			return e
		}
		dir, e := os.Open(filepath.Dir(f.Cursor))
		if e != nil {
			return e
		}
		e = dir.Sync()
		dir.Close()
		if e != nil {
			return e
		}
		return nil
	}
	if e = persist(); e != nil {
		return e
	}

	if _, e = file.Seek(c.Offset, io.SeekStart); e != nil {
		return e
	}
	reader := bufio.NewReaderSize(file, 8192)
	for i := 0; i < 500; i++ {
		raw, e := reader.ReadSlice('\n')
		consumed := len(raw)
		oversized := e == bufio.ErrBufferFull
		for e == bufio.ErrBufferFull {
			raw, e = reader.ReadSlice('\n')
			consumed += len(raw)
		}
		line := string(raw)
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
		if oversized {
			c.Offset += int64(consumed)
			if e = persist(); e != nil {
				return e
			}
			continue
		}
		if pos := strings.Index(line, "AuroraAccess generation="); pos >= 0 && matchLine.MatchString(line) {
			var generation, rule int64
			var ip string
			if _, e = fmt.Sscanf(line[pos:], "AuroraAccess generation=%d rule=%d ip=%s", &generation, &rule, &ip); e != nil {
				return e
			}
			payload, _ := json.Marshal(map[string]any{"key": fmt.Sprintf("%s:%d", c.Epoch, c.Offset), "release_id": generation, "rule_id": rule, "ip": ip})
			reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			q, e := http.NewRequestWithContext(reqCtx, "POST", strings.TrimRight(f.Controller, "/")+"/api/v1/access-sync/"+url.PathEscape(f.NodeID)+"/matches", bytes.NewReader(payload))
			if e != nil {
				cancel()
				return e
			}
			q.Header.Set("Authorization", "Bearer "+f.Token)
			q.Header.Set("Content-Type", "application/json")
			response, e := f.Client.Do(q)
			if e != nil {
				cancel()
				return e
			}
			response.Body.Close()
			cancel()
			if response.StatusCode != 204 {
				return fmt.Errorf("access match rejected: %d", response.StatusCode)
			}
		}
		c.Offset += int64(len(line))
		if e = persist(); e != nil {
			return e
		}
	}
	return nil
}
