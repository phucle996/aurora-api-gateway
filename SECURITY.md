# Security Policy

The Aurora WAF team takes security and reliability extremely seriously. Aurora WAF operates as an in-line reverse proxy and security inspection engine; ensuring the security, isolation, and robustness of the data plane and control plane is our highest priority.

## Supported Versions

Only the latest active development versions receive security updates.

| Version | Supported          | Notes |
| ------- | ------------------ | ----- |
| 0.1.x   | :white_check_mark: | Current active release branch |
| < 0.1.0 | :x:                | Experimental development releases |

---

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues or discussions.**

If you discover a security vulnerability in Aurora WAF, report it privately using one of the following channels:

1. **GitHub Private Vulnerability Reporting (Recommended)**:
   Navigate to the **Security** tab of this repository, select **Advisories**, and click **Report a vulnerability**. This creates a confidential advisory between you and the project maintainers.

2. **Security Email**:
   Send an encrypted or plain email to [security@aurora-waf.io](mailto:security@aurora-waf.io).

### What to Include in Your Report

To help us triage and resolve the issue quickly, include:
- **Component affected**: Rust Engine (`crates/engine`), C ABI FFI (`crates/ffi`), NGINX Module (`adapters/nginx`), Go Control Plane (`control-plane`), or Management Console (`ui`).
- **Description**: Clear description of the vulnerability and its potential impact.
- **Proof of Concept (PoC)**: Minimal reproduction steps, request payload, or test case. Please sanitize any proprietary or confidential data.
- **Version/Environment**: Aurora WAF commit hash or version, OS, NGINX version, and compiler versions.

---

## Response Timeline & Disclosure Process

- **Initial Acknowledgment**: Within **48 hours** of receiving your report.
- **Triage & Assessment**: Within **5 business days**, we will confirm reproduction and determine CVSS severity.
- **Fix & Advisory**: We aim to release a patch within **30 days** for critical issues.
- **Coordinated Disclosure**: We follow coordinated vulnerability disclosure. A public advisory and release will be published once the patch is available or after a mutually agreed embargo period (typically 90 days).

---

## Security Architecture & Invariants

Aurora WAF is built on key security invariants:

1. **Zero-Allocation Data Plane**:
   - The Rust engine (`crates/engine`) inspects requests in the NGINX access phase with zero unnecessary heap allocations.
   - Strict FFI memory boundary (`crates/ffi`): All pointers passed across the C ABI are validated, bounds-checked, and safely converted.

2. **Control-Plane Workflow Isolation**:
   - The Go Control Plane isolates CRUD operations from dynamic node-routing projections.
   - Node authorization is verified via cryptographic tokens and database CTE authority checks before any routing table or policy is served.

3. **Safe Policy Reloads**:
   - Atomic hot-reloads of compiled policies ensure zero downtime and prevent half-applied state transitions.
   - Invalid syntax or malformed rules are rejected at compile time before reaching worker nodes.

For more details on security design, read [Threat Model](docs/THREAT_MODEL.md) and [Runtime Contract](docs/RUNTIME.md).
