package taxonomy

import "errors"

var ErrPolicyConflict = errors.New("policy or cluster revision changed; refresh before retrying")
var ErrPolicyInvalid = errors.New("invalid policy: check name, scope, mode, priority and selected rules")
var ErrPolicyNotFound = errors.New("policy or node not found")
var ErrPolicyUnsupported = errors.New("selected rule revision is disabled or unsupported by the runtime")
