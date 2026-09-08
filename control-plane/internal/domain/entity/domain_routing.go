package entity

// DomainRoutingRecord is the routing workflow's flat database authority projection.
type DomainRoutingRecord struct {
	ID                                                                   int64
	Host, Status, Target, Algorithm, ServersJSON, TransportJSON, SSLJSON string
	ProbesJSON                                                           string
	DynamicDNS                                                           bool
}
type DomainRoutingQuery struct{ NodeID string }
type DomainRoutingResult struct {
	Config string              `json:"config"`
	Digest string              `json:"digest"`
	Files  []DomainRoutingFile `json:"files"`
}

type DomainRoutingFile struct {
	Name    string `json:"name"`
	Content []byte `json:"content"`
}
