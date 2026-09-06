package provider

import (
	"sync"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// EventHub định nghĩa hợp đồng quản lý các kết nối SSE subscribers và phát sóng sự kiện realtime.
type EventHub interface {
	Subscribe() (<-chan entity.SSEMessage, func())
	Broadcast(event string, data any)
}

type eventHub struct {
	mu          sync.RWMutex
	subscribers map[chan entity.SSEMessage]struct{}
}

// NewEventHub khởi tạo trung tâm phân phối sự kiện realtime qua SSE.
func NewEventHub() EventHub {
	return &eventHub{
		subscribers: make(map[chan entity.SSEMessage]struct{}),
	}
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
func (h *eventHub) Broadcast(event string, data any) {
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
