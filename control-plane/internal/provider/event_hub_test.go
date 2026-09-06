package provider_test

import (
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/provider"
)

func TestEventHub_SubscribeAndBroadcast(t *testing.T) {
	hub := provider.NewEventHub()

	ch, unsub := hub.Subscribe()
	defer unsub()

	hub.Broadcast("test_event", map[string]string{"hello": "world"})

	select {
	case msg := <-ch:
		if msg.Event != "test_event" {
			t.Fatalf("expected event test_event, got %s", msg.Event)
		}
		data, ok := msg.Data.(map[string]string)
		if !ok || data["hello"] != "world" {
			t.Fatalf("unexpected data: %+v", msg.Data)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for broadcast event")
	}
}

func TestEventHub_Unsubscribe(t *testing.T) {
	hub := provider.NewEventHub()

	ch, unsub := hub.Subscribe()
	unsub()

	// Channel should be closed
	_, ok := <-ch
	if ok {
		t.Fatal("expected channel to be closed after unsubscribe")
	}
}

func TestEventHub_SlowSubscriberDrop(t *testing.T) {
	hub := provider.NewEventHub()

	ch, unsub := hub.Subscribe()
	defer unsub()

	// Fill buffer (buffer size is 64)
	for i := 0; i < 70; i++ {
		hub.Broadcast("ping", i)
	}

	// Should not block or panic, buffer receives up to 64 items
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			goto done
		}
	}
done:
	if count != 64 {
		t.Fatalf("expected 64 buffered messages, got %d", count)
	}
}
