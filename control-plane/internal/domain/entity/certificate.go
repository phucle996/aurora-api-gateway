package entity

// Tuân thủ Flat Entity: không chứa json tags.

// CertificateItem là flat projection entity đại diện cho một SSL Certificate (SNI & mTLS).
type CertificateItem struct {
	ID          string
	Name        string
	SNIsJSON    string
	CertPEM     string
	KeyPEM      string
	MTLSEnabled bool
	ClientCAPEM string
	VerifyDepth int
	Enabled     bool
	Description string
	CreatedAt   string
	UpdatedAt   string
}

// CreateCertificateCommand chứa dữ liệu để tạo mới một SSL Certificate.
type CreateCertificateCommand struct {
	ID          string
	Name        string
	SNIsJSON    string
	CertPEM     string
	KeyPEM      string
	MTLSEnabled bool
	ClientCAPEM string
	VerifyDepth int
	Enabled     bool
	Description string
}

// UpdateCertificateCommand chứa dữ liệu cập nhật Certificate đã có.
type UpdateCertificateCommand struct {
	ID          string
	Name        string
	SNIsJSON    string
	CertPEM     string
	KeyPEM      string
	MTLSEnabled bool
	ClientCAPEM string
	VerifyDepth int
	Enabled     bool
	Description string
}

// ListCertificatesQuery chứa các điều kiện lọc và phân trang danh sách Certificate.
type ListCertificatesQuery struct {
	Search string
	Limit  int
	Offset int
}

// ListCertificatesResult chứa danh sách Certificate và tổng số lượng bản ghi thỏa mãn.
type ListCertificatesResult struct {
	Items []CertificateItem
	Total int
}
