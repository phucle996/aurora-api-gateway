package entity

type ControllerStatus struct {
	Component        string `json:"component"`
	Stage            string `json:"stage"`
	EnforcementReady *bool  `json:"enforcement_ready"`
	Message          string `json:"message"`
}
