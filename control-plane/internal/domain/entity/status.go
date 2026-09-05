package entity

type ControllerStatus struct {
	Component        string
	Stage            string
	EnforcementReady *bool
	Message          string
}
