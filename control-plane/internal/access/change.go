package access

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type ChangeService struct {
	Repository ChangeRepository
	Compiler   string
}

func (s ChangeService) Change(ctx context.Context, c ChangeCommand) (ChangeResult, error) {
	invalid := ChangeResult{}
	if c.Actor == "" || len(c.Key) < 8 || len(c.Key) > 128 || c.ID < 0 || c.ExpectedVersion < 0 || c.ExpectedRelease < 0 || (c.ID == 0 && (c.ExpectedVersion != 0 || c.Delete)) || (c.ID > 0 && c.ExpectedVersion < 1) || len(c.Document) > 65536 {
		return invalid, ErrInvalid
	}
	var doc any
	switch c.Kind {
	case "rule":
		doc = &ruleInput{}
	case "group":
		doc = &groupInput{}
	case "dataset":
		doc = &datasetInput{}
	default:
		return invalid, ErrInvalid
	}
	if !c.Delete {
		d := json.NewDecoder(bytes.NewReader(c.Document))
		d.DisallowUnknownFields()
		if d.Decode(doc) != nil || d.Decode(&struct{}{}) != io.EOF {
			return invalid, ErrInvalid
		}
		// All network sources use canonical prefixes. This local closure prevents
		// mapped IPv6 inputs from acquiring different identities across source types.
		network := func(raw string) (string, error) {
			p, e := netip.ParsePrefix(strings.TrimSpace(raw))
			if e != nil {
				a, ae := netip.ParseAddr(strings.TrimSpace(raw))
				if ae != nil || a.Zone() != "" {
					return "", ErrInvalid
				}
				a = a.Unmap()
				p = netip.PrefixFrom(a, a.BitLen())
			}
			if p.Addr().Is4In6() || p.Addr().Zone() != "" {
				return "", ErrInvalid
			}
			return p.Masked().String(), nil
		}
		switch v := doc.(type) {
		case *ruleInput:
			v.Name = strings.TrimSpace(v.Name)
			v.Host = strings.ToLower(strings.TrimSpace(v.Host))
			if v.Name == "" || len(v.Name) > 120 || len(v.Description) > 2000 || v.Priority < 0 || v.Priority > 1_000_000 || v.ExpiresAt < 0 || v.ExpiresAt > 253402300799 || len(v.Values) == 0 || len(v.Values) > 1024 {
				return invalid, ErrInvalid
			}
			if v.Action != "allow" && v.Action != "block" && v.Action != "log" {
				return invalid, ErrInvalid
			}
			if v.Host == "" || len(v.Host) > 253 {
				return invalid, ErrInvalid
			}
			if v.Host != "*" {
				for _, label := range strings.Split(v.Host, ".") {
					if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
						return invalid, ErrInvalid
					}
					for _, b := range []byte(label) {
						if !(b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-') {
							return invalid, ErrInvalid
						}
					}
				}
			}
			if !strings.HasPrefix(v.Path, "/") || len(v.Path) > 8192 || strings.ContainsAny(v.Path, "%?#\\*") || strings.Contains(v.Path, "//") {
				return invalid, ErrInvalid
			}
			for _, b := range []byte(v.Path) {
				if b <= 32 || b >= 127 {
					return invalid, ErrInvalid
				}
			}
			for _, p := range strings.Split(v.Path, "/") {
				if p == "." || p == ".." {
					return invalid, ErrInvalid
				}
			}
			if !strings.Contains("|*|GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|", "|"+v.Method+"|") || v.Method == "" {
				return invalid, ErrInvalid
			}
			switch v.Schedule {
			case "always", "business_hours", "weekend", "night":
			default:
				return invalid, ErrInvalid
			}
			for i, value := range v.Values {
				value = strings.TrimSpace(value)
				switch v.Source {
				case "ip", "cidr":
					if v.Source == "ip" {
						if _, e := netip.ParseAddr(value); e != nil {
							p, pe := netip.ParsePrefix(value)
							if pe != nil || p.Bits() != p.Addr().BitLen() {
								return invalid, ErrInvalid
							}
						}
					}
					n, e := network(value)
					if e != nil {
						return invalid, e
					}
					v.Values[i] = n
				case "country":
					value = strings.ToUpper(value)
					if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
						return invalid, ErrInvalid
					}
					v.Values[i] = value
				case "asn":
					n, e := strconv.ParseUint(strings.TrimPrefix(strings.ToUpper(value), "AS"), 10, 32)
					if e != nil || n == 0 {
						return invalid, ErrInvalid
					}
					v.Values[i] = fmt.Sprint(n)
				case "group":
					id, e := strconv.ParseInt(value, 10, 64)
					if e != nil || id < 1 {
						return invalid, ErrInvalid
					}
					v.Values[i] = fmt.Sprint(id)
				default:
					return invalid, ErrInvalid
				}
			}
		case *groupInput:
			v.Name = strings.TrimSpace(v.Name)
			if v.Name == "" || len(v.Name) > 120 || len(v.Networks) == 0 || len(v.Networks) > 4096 {
				return invalid, ErrInvalid
			}
			for i, n := range v.Networks {
				value, e := network(n)
				if e != nil {
					return invalid, e
				}
				v.Networks[i] = value
			}
		case *datasetInput:
			v.Name = strings.TrimSpace(v.Name)
			if v.Name == "" || len(v.Name) > 120 || len(v.Networks) == 0 || len(v.Networks) > 4096 {
				return invalid, ErrInvalid
			}
			for i, n := range v.Networks {
				value, e := network(n.CIDR)
				if e != nil {
					return invalid, e
				}
				n.CIDR = value
				n.Country = strings.ToUpper(strings.TrimSpace(n.Country))
				if n.Country != "" && (len(n.Country) != 2 || n.Country[0] < 'A' || n.Country[0] > 'Z' || n.Country[1] < 'A' || n.Country[1] > 'Z') {
					return invalid, ErrInvalid
				}
				if n.ASN != "" {
					id, e := strconv.ParseUint(strings.TrimPrefix(strings.ToUpper(n.ASN), "AS"), 10, 32)
					if e != nil || id == 0 {
						return invalid, ErrInvalid
					}
					n.ASN = fmt.Sprint(id)
				}
				if n.Country == "" && n.ASN == "" {
					return invalid, ErrInvalid
				}
				v.Networks[i] = n
			}
		}
		c.Document, _ = json.Marshal(doc)
	}
	return s.Repository.Change(ctx, c, func(ctx context.Context, payload []byte) error {
		if s.Compiler == "" || len(payload) > 65536 {
			return ErrCompiler
		}
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, s.Compiler, "--access")
		cmd.Stdin = bytes.NewReader(payload)
		// The compiler emits an identical bounded snapshot. Pipe reads are capped so
		// a failed executable cannot exhaust controller memory.
		stdout, e := cmd.StdoutPipe()
		if e != nil {
			return ErrCompiler
		}
		if cmd.Start() != nil {
			return ErrCompiler
		}
		out, e := io.ReadAll(io.LimitReader(stdout, 65537))
		if e != nil || len(out) > 65536 {
			_ = cmd.Process.Kill()
		}
		wait := cmd.Wait()
		if e != nil || wait != nil || !bytes.Equal(out, payload) {
			return ErrCompiler
		}
		return nil
	})
}
