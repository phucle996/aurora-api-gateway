package entity

import (
	"errors"
	"math"

	"google.golang.org/protobuf/encoding/protowire"
)

// NodeHeartbeatPayload chứa dữ liệu trạng thái và telemetry tức thời do Node gửi lên Control Plane.
// Tuân thủ chuẩn Protocol Buffers binary wire format, đảm bảo gói tin siêu nhẹ (~40 bytes).
type NodeHeartbeatPayload struct {
	NodeID            string
	Timestamp         int64
	CPUUsage          float64
	MemoryUsage       float64
	ActiveConnections int
	RequestsPerSecond float64
	ActiveReleaseID   int64
}

// NodeMetricHistoryRecord đại diện cho 1 bản ghi rollup 1 phút được lưu vào bảng node_metrics_history.
type NodeMetricHistoryRecord struct {
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
