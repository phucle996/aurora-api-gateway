package entity

import (
	"errors"
	"math"

	"google.golang.org/protobuf/encoding/protowire"
)

// NodeHeartbeatPayload chứa dữ liệu trạng thái và telemetry tức thời do Node gửi lên Control Plane.
// Tuân thủ chuẩn Protocol Buffers binary wire format, đảm bảo gói tin siêu nhẹ (~40 bytes).
type NodeHeartbeatPayload struct {
	MetricsScope      string
	Hostname          string
	RuntimeStartedAt  int64
	WorkerIdentity    string
	MetricsAvailable  bool
	Authentication    string
	NodeID            string
	Timestamp         int64
	CPUUsage          float64
	MemoryUsage       float64
	ActiveConnections int
	RequestsPerSecond float64
	ActiveReleaseID   int64
	IP                string
	Version           string
	Role              string
}

// NodeMetricHistoryRecord đại diện cho 1 bản ghi rollup 1 phút được lưu vào bảng node_metrics_history.
type NodeMetricHistoryRecord struct {
	MetricsScope      string
	NodeID            string
	Timestamp         int64
	CPUUsage          float64
	MemoryUsage       float64
	ActiveConnections int
	RequestsPerSecond float64
}

// MarshalBinary tuần tự hóa NodeHeartbeatPayload sang định dạng Protobuf binary wire format.
func (p *NodeHeartbeatPayload) MarshalBinary() []byte {
	var b []byte
	if p.NodeID != "" {
		b = protowire.AppendTag(b, 1, protowire.BytesType)
		b = protowire.AppendString(b, p.NodeID)
	}
	if p.Timestamp != 0 {
		b = protowire.AppendTag(b, 2, protowire.VarintType)
		b = protowire.AppendVarint(b, uint64(p.Timestamp))
	}
	if p.CPUUsage != 0 {
		b = protowire.AppendTag(b, 3, protowire.Fixed64Type)
		b = protowire.AppendFixed64(b, math.Float64bits(p.CPUUsage))
	}
	if p.MemoryUsage != 0 {
		b = protowire.AppendTag(b, 4, protowire.Fixed64Type)
		b = protowire.AppendFixed64(b, math.Float64bits(p.MemoryUsage))
	}
	if p.ActiveConnections != 0 {
		b = protowire.AppendTag(b, 5, protowire.VarintType)
		b = protowire.AppendVarint(b, uint64(p.ActiveConnections))
	}
	if p.RequestsPerSecond != 0 {
		b = protowire.AppendTag(b, 6, protowire.Fixed64Type)
		b = protowire.AppendFixed64(b, math.Float64bits(p.RequestsPerSecond))
	}
	if p.ActiveReleaseID != 0 {
		b = protowire.AppendTag(b, 7, protowire.VarintType)
		b = protowire.AppendVarint(b, uint64(p.ActiveReleaseID))
	}
	if p.Version != "" {
		b = protowire.AppendTag(b, 8, protowire.BytesType)
		b = protowire.AppendString(b, p.Version)
	}
	if p.Role != "" {
		b = protowire.AppendTag(b, 9, protowire.BytesType)
		b = protowire.AppendString(b, p.Role)
	}
	for tag, value := range map[protowire.Number]string{10: p.MetricsScope, 11: p.Hostname, 13: p.WorkerIdentity} {
		if value != "" {
			b = protowire.AppendTag(b, tag, protowire.BytesType)
			b = protowire.AppendString(b, value)
		}
	}
	b = protowire.AppendTag(b, 12, protowire.VarintType)
	b = protowire.AppendVarint(b, uint64(p.RuntimeStartedAt))
	b = protowire.AppendTag(b, 14, protowire.VarintType)
	available := uint64(0)
	if p.MetricsAvailable {
		available = 1
	}
	b = protowire.AppendVarint(b, available)
	return b
}

// UnmarshalNodeHeartbeat giải mã dữ liệu Protobuf binary wire format thành NodeHeartbeatPayload.
func UnmarshalNodeHeartbeat(b []byte) (*NodeHeartbeatPayload, error) {
	if len(b) == 0 {
		return nil, errors.New("empty protobuf payload")
	}

	p := &NodeHeartbeatPayload{}
	for len(b) > 0 {
		num, typ, n := protowire.ConsumeTag(b)
		if n < 0 {
			return nil, errors.New("invalid protobuf tag")
		}
		b = b[n:]
		expected := protowire.VarintType
		switch num {
		case 1, 8, 9, 10, 11, 13:
			expected = protowire.BytesType
		case 3, 4, 6:
			expected = protowire.Fixed64Type
		}
		if num >= 1 && num <= 14 && typ != expected {
			return nil, errors.New("invalid heartbeat wire type")
		}
		switch num {
		case 1: // NodeID
			v, n := protowire.ConsumeString(b)
			if n < 0 {
				return nil, errors.New("invalid node_id string in protobuf")
			}
			p.NodeID = v
			b = b[n:]
		case 2: // Timestamp
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return nil, errors.New("invalid timestamp varint in protobuf")
			}
			p.Timestamp = int64(v)
			b = b[n:]
		case 3: // CPUUsage
			v, n := protowire.ConsumeFixed64(b)
			if n < 0 {
				return nil, errors.New("invalid cpu_usage fixed64 in protobuf")
			}
			p.CPUUsage = math.Float64frombits(v)
			b = b[n:]
		case 4: // MemoryUsage
			v, n := protowire.ConsumeFixed64(b)
			if n < 0 {
				return nil, errors.New("invalid memory_usage fixed64 in protobuf")
			}
			p.MemoryUsage = math.Float64frombits(v)
			b = b[n:]
		case 5: // ActiveConnections
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return nil, errors.New("invalid active_connections varint in protobuf")
			}
			p.ActiveConnections = int(v)
			b = b[n:]
		case 6: // RequestsPerSecond
			v, n := protowire.ConsumeFixed64(b)
			if n < 0 {
				return nil, errors.New("invalid requests_per_second fixed64 in protobuf")
			}
			p.RequestsPerSecond = math.Float64frombits(v)
			b = b[n:]
		case 7: // ActiveReleaseID
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return nil, errors.New("invalid active_release_id varint in protobuf")
			}
			p.ActiveReleaseID = int64(v)
			b = b[n:]
		case 8: // Version
			v, n := protowire.ConsumeString(b)
			if n < 0 {
				return nil, errors.New("invalid version string in protobuf")
			}
			p.Version = v
			b = b[n:]
		case 9: // Role
			v, n := protowire.ConsumeString(b)
			if n < 0 {
				return nil, errors.New("invalid role string in protobuf")
			}
			p.Role = v
			b = b[n:]
		case 10, 11, 13:
			v, n := protowire.ConsumeString(b)
			if n < 0 {
				return nil, errors.New("invalid node metadata")
			}
			switch num {
			case 10:
				p.MetricsScope = v
			case 11:
				p.Hostname = v
			case 13:
				p.WorkerIdentity = v
			}
			b = b[n:]
		case 12, 14:
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return nil, errors.New("invalid runtime metadata")
			}
			if num == 12 {
				p.RuntimeStartedAt = int64(v)
			} else {
				p.MetricsAvailable = v == 1
			}
			b = b[n:]
		default:
			n := protowire.ConsumeFieldValue(num, typ, b)
			if n < 0 {
				return nil, errors.New("invalid protobuf field value")
			}
			b = b[n:]
		}
	}
	return p, nil
}
