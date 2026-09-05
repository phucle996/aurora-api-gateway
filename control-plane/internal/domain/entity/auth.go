package entity

type User struct {
	ID           string
	Username     string
	PasswordHash string
	Salt         string
	Role         string
	CreatedAt    string
	UpdatedAt    string
}

type LoginInput struct {
	Username string
	Password string
}

type LoginOutput struct {
	Token     string
	TokenType string
	ExpiresIn int64
	User      User
}

type Claims struct {
	Subject   string `json:"sub"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	Issuer    string `json:"iss"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}
