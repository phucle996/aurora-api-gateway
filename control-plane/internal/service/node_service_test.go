package service_test

import (
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/service"
)

func TestNodeService_SubscribeEvents(t *testing.T) {
	hub := provider.NewEventHub()
	svc := service.NewNodeService(nil, nil, hub)

	ch, unsub := svc.SubscribeEvents()
	defer unsub()

	hub.Broadcast("custom_event", "payload")

	select {
	case msg := <-ch:
		if msg.Event != "custom_event" || msg.Data != "payload" {
			t.Fatalf("unexpected message: %+v", msg)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for event")
	}
}

func TestNodeService_SubscribeEvents_NilHub(t *testing.T) {
	svc := service.NewNodeService(nil, nil, nil)
	ch, unsub := svc.SubscribeEvents()
	defer unsub()

	if ch != nil {
		t.Fatal("expected nil channel when eventHub is nil")
	}
}
