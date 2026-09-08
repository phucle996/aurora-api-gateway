package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
	"database/sql"
	"fmt"
)

type DomainRoutingRepository struct{ reader *sql.DB }

func NewDomainRoutingRepository(reader *sql.DB) *DomainRoutingRepository {
	return &DomainRoutingRepository{reader: reader}
}
func (r *DomainRoutingRepository) RoutingRecords(ctx context.Context, q entity.DomainRoutingQuery) ([]entity.DomainRoutingRecord, error) {
	// One statement supplies both node authority and the entire current route projection.
	rows, err := r.reader.QueryContext(ctx, `WITH authority AS (SELECT id FROM cluster_nodes WHERE id=?)
 SELECT coalesce(d.id,0),coalesce(d.domain,''),coalesce(d.status,''),coalesce(d.upstream,''),coalesce(u.algorithm,d.upstream_algorithm),coalesce(u.servers_json,''),coalesce(u.transport_json,''),coalesce(u.internal_ssl_json,''),coalesce(u.probes_json,'[]'),coalesce(u.dynamic_dns,0)
 FROM authority a LEFT JOIN domains d ON 1=1 LEFT JOIN upstreams u ON u.name=d.upstream ORDER BY d.id`, q.NodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []entity.DomainRoutingRecord{}
	authorized := false
	for rows.Next() {
		authorized = true
		var v entity.DomainRoutingRecord
		var algorithm sql.NullString
		if err = rows.Scan(&v.ID, &v.Host, &v.Status, &v.Target, &algorithm, &v.ServersJSON, &v.TransportJSON, &v.SSLJSON, &v.ProbesJSON, &v.DynamicDNS); err != nil {
			return nil, err
		}
		v.Algorithm = algorithm.String
		if v.ID > 0 {
			out = append(out, v)
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if !authorized {
		return nil, fmt.Errorf("unregistered routing node")
	}
	return out, nil
}
