package entity_test

import (
	"reflect"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

func TestNodeHeartbeatProtobufRoundTrip(t *testing.T) {
	original := &entity.NodeHeartbeatPayload{
		NodeID:            "node-local-01",
		Timestamp:         1725518400,
		CPUUsage:          24.5,
		MemoryUsage:       38.2,
		ActiveConnections: 142,
		RequestsPerSecond: 2850.75,
		ActiveReleaseID:   12,
		Version:           "0.4.1",
	}

	data := original.MarshalBinary()
	if len(data) == 0 {
		t.Fatal("kỳ vọng dữ liệu binary khác rỗng")
	}

	// Xác nhận payload siêu nhẹ (dưới 100 bytes khi có đủ version và role)
	if len(data) > 100 {
		t.Errorf("kích thước protobuf quá lớn: %d bytes (kỳ vọng <= 100 bytes)", len(data))
	}

	decoded, err := entity.UnmarshalNodeHeartbeat(data)
	if err != nil {
		t.Fatalf("giải mã protobuf thất bại: %v", err)
	}

	if !reflect.DeepEqual(original, decoded) {
		t.Errorf("dữ liệu giải mã không khớp:\nKỳ vọng: %+v\nThực tế: %+v", original, decoded)
	}
}

func TestNodeHeartbeatProtobufInvalid(t *testing.T) {
	_, err := entity.UnmarshalNodeHeartbeat(nil)
	if err == nil {
		t.Error("kỳ vọng lỗi khi giải mã payload rỗng")
	}

	_, err = entity.UnmarshalNodeHeartbeat([]byte{0xFF, 0xFF})
	if err == nil {
		t.Error("kỳ vọng lỗi khi giải mã byte không hợp lệ")
	}
}
