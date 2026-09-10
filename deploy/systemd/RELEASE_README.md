# Aurora API Gateway — Linux Systemd Release

## Quick Start

### 1. One-Line Installer (Remote)

Install latest release directly:
```bash
curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-api-gateway/main/install.sh | sudo bash
```

Or install a specific version (e.g. `v0.1.0`):
```bash
curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-api-gateway/main/install.sh | sudo bash -s -- -v v0.1.0
```

### 2. Local Installation from Release Tarball

```bash
tar xzf aurora-waf-*-linux-amd64.tar.gz
cd aurora-waf-*-linux-amd64
sudo ./install.sh
```

The installer will:
- Scan for existing NGINX installations and show version/compatibility info
- Auto-match the correct pre-built `.so` module to your NGINX version
- Install binaries, WAF module, and generate systemd units
- Enable and start the Control Plane service

## Contents

| Path | Description |
|------|-------------|
| `bin/aurora-controller` | Control Plane HTTP server (Go binary) |
| `bin/aurora-compile` | WAF rule compiler (Rust binary) |
| `modules/ngx_http_aurora_waf_module-*.so` | Pre-built NGINX dynamic modules (one per supported version) |
| `modules/supported-versions.txt` | List of supported NGINX versions |
| `deploy/` | Agent scripts for bare-metal node setup |
| `install.sh` | Interactive installer with NGINX detection |

## Supported NGINX Versions

This release includes pre-built WAF modules for:
- NGINX 1.26.3
- NGINX 1.27.4
- NGINX 1.28.0
- NGINX 1.30.4

The installer automatically detects your NGINX version and selects the matching module.

If your NGINX version is not listed, you can build from source:
```bash
NGINX_VERSION=<your-version> bash scripts/build-nginx-module.sh
```
