package service

import (
	"context"
	"log"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/provider"
)

const defaultNotificationQueueSize = 256

// NotificationWorker là background worker xử lý hàng đợi cảnh báo sự cố (Alert Queue)
// và dispatch bất đồng bộ tới các kênh thông báo ngoại vi thông qua NotificationProvider.
type NotificationWorker struct {
	repo     repo.NotificationRepository
	provider provider.NotificationProvider
	queue    chan entity.AlertEvent
	stop     chan struct{}
	wg       sync.WaitGroup
	started  bool
	mu       sync.Mutex
}

// NewNotificationWorker khởi tạo worker quản lý hàng đợi Go channel và bộ lọc quy tắc.
func NewNotificationWorker(
	repo repo.NotificationRepository,
	provider provider.NotificationProvider,
	queueSize int,
) *NotificationWorker {
	if queueSize <= 0 {
		queueSize = defaultNotificationQueueSize
	}
	return &NotificationWorker{
		repo:     repo,
		provider: provider,
		queue:    make(chan entity.AlertEvent, queueSize),
		stop:     make(chan struct{}),
	}
}

// Enqueue đưa một sự kiện cảnh báo vào hàng đợi theo cơ chế non-blocking.
// Trả về true nếu sự kiện được xếp hàng thành công, false nếu hàng đợi đã bão hòa.
func (w *NotificationWorker) Enqueue(event entity.AlertEvent) bool {
	if event.Timestamp == 0 {
		event.Timestamp = time.Now().UnixMilli()
	}

	select {
	case w.queue <- event:
		return true
	default:
		log.Printf("[NotificationWorker] Cảnh báo bị bỏ qua do hàng đợi đầy (dung lượng %d): [%s] %s",
			cap(w.queue), event.Severity, event.Title)
		return false
	}
}

// Start khởi chạy tiến trình goroutine tiêu thụ các sự kiện trong hàng đợi.
func (w *NotificationWorker) Start(ctx context.Context) {
	w.mu.Lock()
	if w.started {
		w.mu.Unlock()
		return
	}
	w.started = true
	w.mu.Unlock()

	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		log.Printf("[NotificationWorker] Tiến trình chạy ngầm gửi cảnh báo (Alert Worker) đã khởi động")

		for {
			select {
			case event := <-w.queue:
				w.processEvent(ctx, event)
			case <-w.stop:
				log.Printf("[NotificationWorker] Đang đóng hàng đợi và dọn dẹp các cảnh báo tồn đọng...")
				// Xả hết các event còn sót lại trước khi dừng hẳn
				for {
					select {
					case event := <-w.queue:
						w.processEvent(ctx, event)
					default:
						return
					}
				}
			}
		}
	}()
}

// Stop dừng worker an toàn và chờ các tác vụ đang thực thi hoàn tất.
func (w *NotificationWorker) Stop() {
	w.mu.Lock()
	if !w.started {
		w.mu.Unlock()
		return
	}
	w.started = false
	w.mu.Unlock()

	close(w.stop)
	w.wg.Wait()
	log.Printf("[NotificationWorker] Tiến trình gửi cảnh báo đã dừng hoàn tất")
}

// processEvent kiểm tra điều kiện quy tắc và phát tán thông điệp tới các kênh đang bật.
func (w *NotificationWorker) processEvent(ctx context.Context, event entity.AlertEvent) {
	// 1. Nếu sự kiện gắn liền với rule_id cụ thể, kiểm tra quy tắc đó có đang bật (enabled) hay không
	if event.RuleID != "" {
		enabled, err := w.repo.IsRuleEnabled(ctx, event.RuleID)
		if err != nil {
			log.Printf("[NotificationWorker] Lỗi kiểm tra trạng thái quy tắc %s: %v", event.RuleID, err)
		} else if !enabled {
			// Quy tắc đang tắt -> Không gửi cảnh báo
			return
		}
	}

	// 2. Lấy danh sách các kênh thông báo đang kích hoạt (enabled = 1)
	channels, err := w.repo.GetEnabledChannels(ctx)
	if err != nil {
		log.Printf("[NotificationWorker] Lỗi truy vấn danh sách kênh thông báo: %v", err)
		return
	}
	if len(channels) == 0 {
		return
	}

	// 3. Dispatch tới từng kênh qua NotificationProvider
	for _, ch := range channels {
		sendCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		if err := w.provider.Send(sendCtx, ch.ID, ch.ConfigJSON, event); err != nil {
			log.Printf("[NotificationWorker] Gửi cảnh báo tới kênh '%s' thất bại: %v", ch.ID, err)
		}
		cancel()
	}
}
