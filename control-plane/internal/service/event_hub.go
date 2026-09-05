package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"sync"
	"time"
)

// EventHub định nghĩa hợp đồng quản lý các kết nối SSE subscribers và gom batch sự kiện.
type EventHub interface {
	Subscribe() (<-chan entity.SSEMessage, func())
	Broadcast(event string, data interface{})
	QueueHeartbeat(evt entity.NodeHeartbeatEvent)
}

type eventHub struct {
	mu          sync.RWMutex
	subscribers map[chan entity.SSEMessage]struct{}

	batchMu      sync.Mutex
	pendingBeats map[string]entity.NodeHeartbeatEvent
}

// NewEventHub khởi tạo trung tâm phân phối sự kiện realtime và worker gom batch.
func NewEventHub() EventHub {
	h := &eventHub{
		subscribers:  make(map[chan entity.SSEMessage]struct{}),
		pendingBeats: make(map[string]entity.NodeHeartbeatEvent),
	}

	// Worker gom batch heartbeat: gom xả các node heartbeats sau mỗi 1200ms
	go h.flushLoop(1200 * time.Millisecond)

	return h
}

// QueueHeartbeat đưa sự kiện nhịp tim của một node vào hàng chờ để gom batch gửi chung một lượt.
func (h *eventHub) QueueHeartbeat(evt entity.NodeHeartbeatEvent) {
	h.batchMu.Lock()
	defer h.batchMu.Unlock()
	h.pendingBeats[evt.NodeID] = evt
}

// flushLoop định kỳ gom tất cả pending node heartbeats và bắn 1 event duy nhất lên client.
func (h *eventHub) flushLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		h.flushBatch()
	}
}

func (h *eventHub) flushBatch() {
	h.batchMu.Lock()
	if len(h.pendingBeats) == 0 {
		h.batchMu.Unlock()
		return
	}

	batch := make([]entity.NodeHeartbeatEvent, 0, len(h.pendingBeats))
	for _, beat := range h.pendingBeats {
		batch = append(batch, beat)
	}
	h.pendingBeats = make(map[string]entity.NodeHeartbeatEvent)
	h.batchMu.Unlock()

	// Phát sóng danh sách gom batch các node cho toàn bộ client SSE
	h.Broadcast("nodes_heartbeat", batch)
}

// Subscribe đăng ký một client nhận sự kiện realtime. Trả về channel dữ liệu và hàm unsubscribe để huỷ đăng ký.
func (h *eventHub) Subscribe() (<-chan entity.SSEMessage, func()) {
	ch := make(chan entity.SSEMessage, 64)

	h.mu.Lock()
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subscribers[ch]; ok {
			delete(h.subscribers, ch)
			close(ch)
		}
	}

	return ch, unsubscribe
}

// Broadcast gửi sự kiện tới toàn bộ client đang kết nối mà không block goroutine người gửi.
func (h *eventHub) Broadcast(event string, data interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	msg := entity.SSEMessage{
		Event: event,
		Data:  data,
	}

	for ch := range h.subscribers {
		select {
		case ch <- msg:
		default:
			// Client nhận chậm hoặc nghẽn mạng -> bỏ qua packet này để không block toàn hệ thống
		}
	}
}
