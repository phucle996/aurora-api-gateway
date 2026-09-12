package service

import (
	"context"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

// SpecSyncService handles node declarative configuration sync queries and status reports.
type SpecSyncService struct {
	repo repo.SpecSyncRepository
}

// NewSpecSyncService creates a new SpecSyncService instance.
func NewSpecSyncService(repo repo.SpecSyncRepository) *SpecSyncService {
	return &SpecSyncService{
		repo: repo,
	}
}

// SyncSpec serves the cluster declarative NodeSpec snapshot in O(1) time
// by reading the pre-compiled active release from the database.
func (s *SpecSyncService) SyncSpec(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error) {
	if q.NodeID == "" {
		return nil, fmt.Errorf("node_id is required")
	}

	if s.repo == nil {
		return &entity.SpecSyncResult{
			InSync: false,
		}, nil
	}

	active, err := s.repo.GetActiveSpecRelease(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get active spec release: %w", err)
	}

	if active == nil {
		return &entity.SpecSyncResult{
			InSync:    false,
			ReleaseID: 0,
			Hash:      "",
			SpecJSON:  "",
		}, nil
	}

	if q.CurrentHash != "" && q.CurrentHash == active.Digest {
		return &entity.SpecSyncResult{
			InSync:    true,
			ReleaseID: active.ID,
			Hash:      active.Digest,
			SpecJSON:  "",
		}, nil
	}

	return &entity.SpecSyncResult{
		InSync:    false,
		ReleaseID: active.ID,
		Hash:      active.Digest,
		SpecJSON:  active.SpecJSON,
	}, nil
}

// ReportSpec records the node's applied spec version and telemetry report.
func (s *SpecSyncService) ReportSpec(ctx context.Context, cmd entity.SpecReportCommand) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.RecordReport(ctx, cmd)
}
