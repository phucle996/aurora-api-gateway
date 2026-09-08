package entity

// Tuân thủ Flat Entity: không chứa json tags.

// DomainRoutingRecord is the routing workflow's flat database authority projection.
type DomainRoutingRecord struct {
	ID                                                                   int64
	Host, Status, Target, Algorithm, ServersJSON, TransportJSON, SSLJSON string
	ProbesJSON                                                           string
	DynamicDNS                                                           bool
}

type DomainRoutingQuery struct{ NodeID string }

type DomainRoutingResult struct {
	Config string
	Digest string
	Files  []DomainRoutingFile
}

type DomainRoutingFile struct {
	Name    string
	Content []byte
}
