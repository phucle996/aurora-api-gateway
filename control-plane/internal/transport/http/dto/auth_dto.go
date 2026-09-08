package dto

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Code     string `json:"code,omitempty"`
}

type Verify2FALoginRequest struct {
	TwoFactorToken string `json:"two_factor_token"`
	Code           string `json:"code"`
}
