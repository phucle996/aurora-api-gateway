#!/usr/bin/env bash
# Aurora WAF Linux installer.
# Automatically downloads release package (latest or specified -v version),
# detects NGINX installations, installs modules, generates systemd units, and starts services.
set -euo pipefail

# ── Parse command-line options ────────────────────────────────────────────────
VERSION="latest"
NON_INTERACTIVE=0
SKIP_MODULE=0
NGINX_CHOICE=""

usage() {
  cat << 'EOF'
Aurora WAF Linux Installer

Usage:
  install.sh [OPTIONS]
  curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-waf/main/install.sh | sudo bash -s -- [OPTIONS]

Options:
  -v, --version <tag>     Release version to install (e.g. v0.1.0 or 0.1.0). Default: latest
  -y, --yes               Non-interactive mode (accept defaults automatically)
  --skip-module           Skip installing dynamic module into local NGINX
  --nginx-choice <index>  Pre-select NGINX installation index (0 = skip module)
  -h, --help              Show this help message
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version)
      [ -n "${2:-}" ] || { echo "Error: -v/--version requires a version argument." >&2; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    -y|--yes)
      NON_INTERACTIVE=1
      shift
      ;;
    --skip-module)
      SKIP_MODULE=1
      shift
      ;;
    --nginx-choice)
      [ -n "${2:-}" ] || { echo "Error: --nginx-choice requires an index argument." >&2; exit 1; }
      NGINX_CHOICE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root (e.g. sudo $0)." >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo "")

# ── Resolve Payload (local bundle or download release tarball) ────────────────
PAYLOAD_DIR=""
TMP_DIR=""

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# If invoked inside an extracted release tarball without explicit -v flag, use local files
if [ -n "$SCRIPT_DIR" ] && [ "$VERSION" = "latest" ] && [ -f "${SCRIPT_DIR}/bin/aurora-controller" ] && [ -d "${SCRIPT_DIR}/modules" ]; then
  PAYLOAD_DIR="${SCRIPT_DIR}"
  echo "==> Using local release payload at ${PAYLOAD_DIR}"
else
  # Require curl and tar for downloading and extraction
  command -v curl >/dev/null 2>&1 || { echo "Error: curl is required to download release package." >&2; exit 1; }
  command -v tar  >/dev/null 2>&1 || { echo "Error: tar is required to extract release package." >&2; exit 1; }

  TARGET_TAG=""
  if [ "$VERSION" = "latest" ]; then
    echo "==> Fetching latest release version from GitHub..."
    TARGET_TAG=$(curl -sIL -o /dev/null -w '%{url_effective}' "https://github.com/phucle996/aurora-waf/releases/latest" 2>/dev/null | sed -E 's|.*/tag/||' || true)
    if [ -z "$TARGET_TAG" ] || [ "$TARGET_TAG" = "latest" ]; then
      TARGET_TAG=$(curl -sSL "https://api.github.com/repos/phucle996/aurora-waf/releases/latest" 2>/dev/null | grep -m1 '"tag_name":' | cut -d '"' -f 4 || true)
    fi
    if [ -z "$TARGET_TAG" ]; then
      echo "Error: Could not resolve latest release tag from GitHub." >&2
      exit 1
    fi
  else
    if [[ "$VERSION" =~ ^v ]]; then
      TARGET_TAG="$VERSION"
    else
      TARGET_TAG="v${VERSION}"
    fi
  fi

  RAW_VER="${TARGET_TAG#v}"
  ARCHIVE_NAME="aurora-waf-${RAW_VER}-linux-amd64.tar.gz"
  DOWNLOAD_URL="https://github.com/phucle996/aurora-waf/releases/download/${TARGET_TAG}/${ARCHIVE_NAME}"
  SHA256_URL="${DOWNLOAD_URL}.sha256"

  TMP_DIR=$(mktemp -d /tmp/aurora-install.XXXXXX)

  echo "==> Downloading Aurora WAF release ${TARGET_TAG}..."
  echo "    Source: ${DOWNLOAD_URL}"
  if ! curl -fSL --progress-bar -o "${TMP_DIR}/${ARCHIVE_NAME}" "${DOWNLOAD_URL}"; then
    echo "Error: Failed to download release from ${DOWNLOAD_URL}" >&2
    exit 1
  fi

  # Checksum verification
  if curl -fsSL -o "${TMP_DIR}/${ARCHIVE_NAME}.sha256" "${SHA256_URL}" 2>/dev/null; then
    echo "==> Verifying SHA256 checksum..."
    EXPECTED_SHA=$(awk '{print $1}' "${TMP_DIR}/${ARCHIVE_NAME}.sha256")
    ACTUAL_SHA=$(sha256sum "${TMP_DIR}/${ARCHIVE_NAME}" | awk '{print $1}')
    if [ -n "$EXPECTED_SHA" ] && [ "$EXPECTED_SHA" = "$ACTUAL_SHA" ]; then
      echo "    Checksum OK (${ACTUAL_SHA:0:16}...)"
    else
      echo "Error: Checksum verification failed!" >&2
      echo "  Expected: ${EXPECTED_SHA}" >&2
      echo "  Actual:   ${ACTUAL_SHA}" >&2
      exit 1
    fi
  fi

  echo "==> Extracting release package..."
  tar -xzf "${TMP_DIR}/${ARCHIVE_NAME}" -C "${TMP_DIR}"

  if [ -d "${TMP_DIR}/aurora-waf-${RAW_VER}-linux-amd64" ]; then
    PAYLOAD_DIR="${TMP_DIR}/aurora-waf-${RAW_VER}-linux-amd64"
  else
    PAYLOAD_DIR="${TMP_DIR}"
  fi
fi

# ── Read supported NGINX versions ─────────────────────────────────────────────
SUPPORTED_VERSIONS=()
if [ -f "${PAYLOAD_DIR}/modules/supported-versions.txt" ]; then
  while IFS=' ' read -r ver _sha; do
    [[ "$ver" =~ ^#.*$ || -z "$ver" ]] && continue
    SUPPORTED_VERSIONS+=("$ver")
  done < "${PAYLOAD_DIR}/modules/supported-versions.txt"
fi

# ── Detect NGINX installations ────────────────────────────────────────────────
detect_nginx() {
  local search_paths=(
    /usr/sbin/nginx
    /usr/local/sbin/nginx
    /usr/local/nginx/sbin/nginx
    /opt/nginx/sbin/nginx
    /opt/nginx/usr/sbin/nginx
  )

  local path_nginx
  path_nginx=$(command -v nginx 2>/dev/null || true)
  if [ -n "$path_nginx" ]; then
    search_paths+=("$path_nginx")
  fi

  declare -A seen
  for bin in "${search_paths[@]}"; do
    [ -x "$bin" ] || continue
    local real
    real=$(readlink -f "$bin" 2>/dev/null || echo "$bin")
    [ -z "${seen[$real]:-}" ] || continue
    seen[$real]=1
    echo "$bin"
  done
}

get_nginx_version() {
  "$1" -v 2>&1 | sed -n 's/.*nginx\/\([0-9.]*\).*/\1/p'
}

has_compat_flag() {
  "$1" -V 2>&1 | grep -q '\-\-with-compat' && echo "YES" || echo "NO"
}

find_module_for_version() {
  local ver="$1"
  local module="${PAYLOAD_DIR}/modules/ngx_http_aurora_waf_module-${ver}.so"
  if [ -f "$module" ]; then
    echo "$module"
  fi
}

show_nginx_info() {
  local bin="$1"
  local version
  version=$(get_nginx_version "$bin")
  local compat
  compat=$(has_compat_flag "$bin")

  local module_status="NO MODULE"
  if [ -n "$(find_module_for_version "$version")" ]; then
    module_status="AVAILABLE"
  fi

  printf "  %-35s  version=%-10s  compat=%-3s  module=%s\n" "$bin" "$version" "$compat" "$module_status"
}

echo ""
echo "========================================"
echo "  Aurora WAF Installer"
echo "========================================"
echo ""

if [ ${#SUPPORTED_VERSIONS[@]} -gt 0 ]; then
  echo "  Supported NGINX versions: ${SUPPORTED_VERSIONS[*]}"
else
  echo "  Notice: No supported-versions.txt found in modules directory."
fi
echo ""

SELECTED_NGINX=""
SELECTED_MODULE=""
SELECTED_VERSION=""

if [ "$SKIP_MODULE" -eq 1 ]; then
  echo "==> Skipping NGINX module installation (--skip-module specified)."
else
  echo "==> Scanning for NGINX installations..."
  mapfile -t nginx_bins < <(detect_nginx)

  if [ ${#nginx_bins[@]} -eq 0 ]; then
    echo ""
    echo "  No NGINX installation found on this host."
    echo "  The Control Plane will still be installed."
    echo "  Pre-built modules will be copied to /usr/lib/nginx/modules/ for later use."
    echo ""
  else
    echo ""
    echo "  Found ${#nginx_bins[@]} NGINX installation(s):"
    echo ""

    for i in "${!nginx_bins[@]}"; do
      printf "  [%d] " "$((i + 1))"
      show_nginx_info "${nginx_bins[$i]}"
    done

    echo ""
    echo "  [0]  Skip — do not install the WAF module into any NGINX"
    echo ""

    choice=""
    if [ -n "$NGINX_CHOICE" ]; then
      choice="$NGINX_CHOICE"
      echo "  Using pre-selected NGINX choice: ${choice}"
    elif [ "$NON_INTERACTIVE" -eq 1 ]; then
      # In non-interactive mode, check if first nginx has matching module, otherwise skip
      first_ver=$(get_nginx_version "${nginx_bins[0]}")
      if [ -n "$(find_module_for_version "$first_ver")" ]; then
        choice="1"
      else
        choice="0"
      fi
      echo "  Non-interactive mode: selected choice [${choice}]"
    else
      # Try reading from /dev/tty if stdin is piped (e.g. curl | sudo bash)
      TTY_INPUT="/dev/tty"
      if [ ! -t 0 ] && [ -r /dev/tty ]; then
        exec 3<&0
        exec 0< /dev/tty
      fi

      while true; do
        read -rp "  Select NGINX to install module into [0-${#nginx_bins[@]}]: " choice || choice="0"
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 0 ] && [ "$choice" -le "${#nginx_bins[@]}" ]; then
          break
        fi
        echo "  Invalid choice. Try again."
      done

      if [ ! -t 0 ] && [ -r /dev/tty ]; then
        exec 0<&3
        exec 3<&-
      fi
    fi

    if [ "$choice" -eq 0 ]; then
      echo "  Skipping NGINX module installation."
    else
      SELECTED_NGINX="${nginx_bins[$((choice - 1))]}"
      SELECTED_VERSION=$(get_nginx_version "$SELECTED_NGINX")
      SELECTED_MODULE=$(find_module_for_version "$SELECTED_VERSION")

      if [ -z "$SELECTED_MODULE" ]; then
        echo ""
        echo "  NOTICE: No pre-built module found for NGINX ${SELECTED_VERSION}."
        echo "  Available pre-built modules:"
        for f in "${PAYLOAD_DIR}"/modules/ngx_http_aurora_waf_module-*.so; do
          [ -f "$f" ] || continue
          local_ver=$(basename "$f" | sed 's/ngx_http_aurora_waf_module-//;s/\.so//')
          echo "    - ${local_ver}"
        done
        echo ""
        echo "  Control Plane will still be installed."
        SELECTED_NGINX=""
      else
        echo ""
        echo "  Matched module: $(basename "$SELECTED_MODULE") for NGINX ${SELECTED_VERSION}"
      fi
    fi
  fi
fi

echo ""

# ── System user ────────────────────────────────────────────────────────────────
echo "==> Creating aurora system user..."
id -u aurora &>/dev/null || useradd --system --no-create-home --shell /bin/false aurora

# ── Directories ────────────────────────────────────────────────────────────────
echo "==> Creating data directories..."
install -d -m 750 -o aurora -g aurora /var/lib/aurora-waf
install -d -m 750 -o aurora -g aurora /etc/aurora-waf
mkdir -p /run/aurora-waf
chown -R aurora:aurora /run/aurora-waf 2>/dev/null || true

# ── Security tokens & Environment ──────────────────────────────────────────────
if [ ! -f /etc/aurora-waf/controller.env ]; then
  echo "==> Generating production secrets in /etc/aurora-waf/controller.env..."
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -A n -v -t x1 | tr -d ' \n')
  cat > /etc/aurora-waf/controller.env << ENV_EOF
# Aurora WAF Controller Environment
AURORA_ENV=production
AURORA_JWT_SECRET=${JWT_SECRET}
ENV_EOF
  chmod 600 /etc/aurora-waf/controller.env
  chown aurora:aurora /etc/aurora-waf/controller.env
fi

if [ ! -f /etc/aurora-waf/admin.token ]; then
  echo "==> Generating admin token in /etc/aurora-waf/admin.token..."
  ADMIN_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -A n -v -t x1 | tr -d ' \n')
  echo "${ADMIN_TOKEN}" > /etc/aurora-waf/admin.token
  chmod 600 /etc/aurora-waf/admin.token
  chown aurora:aurora /etc/aurora-waf/admin.token
fi

# ── Binaries ───────────────────────────────────────────────────────────────────
echo "==> Installing Aurora WAF binaries..."
install -m 755 "${PAYLOAD_DIR}/bin/aurora-controller" /usr/local/bin/aurora-controller
install -m 755 "${PAYLOAD_DIR}/bin/aurora-compile"    /usr/local/bin/aurora-compile

# ── NGINX module ───────────────────────────────────────────────────────────────
NGINX_CONF="/etc/nginx/nginx.conf"
NGINX_MODULES_PATH=""

if [ -n "$SELECTED_NGINX" ] && [ -n "$SELECTED_MODULE" ]; then
  NGINX_MODULES_PATH=$("$SELECTED_NGINX" -V 2>&1 | grep -oP '(?<=--modules-path=)\S+' || true)
  if [ -z "$NGINX_MODULES_PATH" ]; then
    NGINX_PREFIX=$("$SELECTED_NGINX" -V 2>&1 | grep -oP '(?<=--prefix=)\S+' || echo "/etc/nginx")
    NGINX_MODULES_PATH="${NGINX_PREFIX}/modules"
  fi
  mkdir -p "$NGINX_MODULES_PATH"

  echo "==> Installing WAF module (NGINX ${SELECTED_VERSION}) into ${NGINX_MODULES_PATH}..."
  install -m 755 "$SELECTED_MODULE" "${NGINX_MODULES_PATH}/ngx_http_aurora_waf_module.so"

  NGINX_CONF=$("$SELECTED_NGINX" -V 2>&1 | grep -oP '(?<=--conf-path=)\S+' || echo "/etc/nginx/nginx.conf")

  if grep -q 'ngx_http_aurora_waf_module' "$NGINX_CONF" 2>/dev/null; then
    echo "  load_module directive already present in ${NGINX_CONF}"
  else
    echo ""
    echo "  Add the following line at the TOP of ${NGINX_CONF}:"
    echo ""
    echo "    load_module ${NGINX_MODULES_PATH}/ngx_http_aurora_waf_module.so;"
    echo ""
  fi

  echo "==> Validating NGINX configuration..."
  if "$SELECTED_NGINX" -t 2>&1; then
    echo "  NGINX config validation passed."
  else
    echo "  WARNING: nginx -t reported errors. Check your configuration."
  fi
else
  # Copy all modules to standard location for later use.
  echo "==> Copying all WAF modules to /usr/lib/nginx/modules/..."
  mkdir -p /usr/lib/nginx/modules
  for f in "${PAYLOAD_DIR}"/modules/ngx_http_aurora_waf_module-*.so; do
    [ -f "$f" ] || continue
    install -m 755 "$f" /usr/lib/nginx/modules/
  done
fi

# ── Generate Control Plane systemd unit ────────────────────────────────────────
echo "==> Generating aurora-waf-controller.service..."
cat > /etc/systemd/system/aurora-waf-controller.service << 'UNIT_EOF'
[Unit]
Description=Aurora WAF Control Plane Service
Documentation=https://github.com/phucle996/aurora-waf
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aurora
Group=aurora

StateDirectory=aurora-waf
ConfigurationDirectory=aurora-waf
ConfigurationDirectoryMode=0750
RuntimeDirectory=aurora-waf
RuntimeDirectoryMode=0750

Environment="AURORA_ENV=production"
Environment="AURORA_HTTP_ADDR=127.0.0.1:8080"
Environment="AURORA_SQLITE_PATH=/var/lib/aurora-waf/aurora.db"
Environment="AURORA_ADMIN_TOKEN_FILE=/etc/aurora-waf/admin.token"
Environment="AURORA_COMPILER_PATH=/usr/local/bin/aurora-compile"
EnvironmentFile=-/etc/aurora-waf/controller.env

ExecStart=/usr/local/bin/aurora-controller

ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/aurora-waf
ReadOnlyPaths=/etc/aurora-waf
NoNewPrivileges=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes

Restart=on-failure
RestartSec=3s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT_EOF

# ── Generate Data Plane (NGINX WAF Node) systemd unit ─────────────────────────
UNIT_NGINX_BIN="${SELECTED_NGINX:-/usr/sbin/nginx}"
UNIT_NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"

echo "==> Generating aurora-waf-nginx.service..."
cat > /etc/systemd/system/aurora-waf-nginx.service << UNIT_EOF
[Unit]
Description=Aurora WAF NGINX Data Plane Node
Documentation=https://github.com/phucle996/aurora-waf
After=network-online.target
Wants=network-online.target

[Service]
Environment="AURORA_METRICS_SCOPE=host"
Type=forking
PIDFile=/run/aurora-waf/nginx.pid

Environment="NODE_ID=node-01"
Environment="CONTROL_PLANE_URL=https://control-plane.internal:8080"
Environment="POLICY_DEST=/etc/aurora-waf/active-policy.json"
Environment="CERTS_DIR=/etc/aurora-waf/certs"
Environment="NGINX_CONF=${UNIT_NGINX_CONF}"
EnvironmentFile=-/etc/aurora-waf/node.env

ExecStartPre=/usr/bin/bash -c '\\
    set -euo pipefail; \\
    mkdir -p \$(dirname "\$POLICY_DEST") /run/aurora-waf; \\
    if [ ! -f "\$POLICY_DEST" ]; then \\
        echo "[Aurora WAF] Initializing baseline policy..."; \\
        printf "{\\n  \\"schema_version\\": 1,\\n  \\"block_paths\\": [\\n    \\"/blocked\\",\\n    \\"/__aurora_blocked\\"\\n  ]\\n}\\n" > "\$POLICY_DEST"; \\
        chmod 600 "\$POLICY_DEST"; \\
    fi; \\
    if [ -f "\${CERTS_DIR}/node.crt" ] && [ -f "\${CERTS_DIR}/node.key" ] && [ -f "\${CERTS_DIR}/ca.crt" ]; then \\
        TMP_FILE="\${POLICY_DEST}.tmp"; \\
        AUTH_HEADER=(); \\
        if [ -n "\${AUTH_TOKEN:-}" ]; then \\
            AUTH_HEADER=(-H "Authorization: Bearer \${AUTH_TOKEN}"); \\
        fi; \\
        HTTP_CODE=\$(curl --silent --show-error --write-out "%%{http_code}" \\
            --cacert "\${CERTS_DIR}/ca.crt" \\
            --cert "\${CERTS_DIR}/node.crt" \\
            --key "\${CERTS_DIR}/node.key" \\
            "\${AUTH_HEADER[@]}" \\
            --connect-timeout 3 \\
            --max-time 10 \\
            --output "\$TMP_FILE" \\
            "\${CONTROL_PLANE_URL}/api/v1/policy-sync/\${NODE_ID}" || echo "000"); \\
        if [ "\$HTTP_CODE" -eq 200 ] && [ -s "\$TMP_FILE" ]; then \\
            mv -f "\$TMP_FILE" "\$POLICY_DEST"; \\
            chmod 600 "\$POLICY_DEST"; \\
            echo "[Aurora WAF] Policy synced from controller."; \\
        else \\
            rm -f "\$TMP_FILE"; \\
            echo "[Aurora WAF] Cannot sync policy (HTTP \$HTTP_CODE), using existing policy."; \\
        fi; \\
    fi'

ExecStartPre=${UNIT_NGINX_BIN} -t -q -c \${NGINX_CONF}
ExecStart=${UNIT_NGINX_BIN} -c \${NGINX_CONF}
ExecReload=/bin/kill -s HUP \$MAINPID
ExecStop=/bin/kill -s QUIT \$MAINPID
KillMode=mixed
TimeoutStopSec=15s
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=multi-user.target
UNIT_EOF

# ── Activate ───────────────────────────────────────────────────────────────────
if systemctl is-system-running &>/dev/null || [ -d /run/systemd/system ]; then
  systemctl daemon-reload

  echo "==> Enabling and starting aurora-waf-controller..."
  systemctl enable --now aurora-waf-controller

  echo ""
  echo "========================================"
  echo "  Aurora WAF Control Plane is running!"
  echo "========================================"
else
  echo ""
  echo "========================================"
  echo "  Aurora WAF installed successfully!"
  echo "========================================"
  echo "  Notice: systemd is not booted as PID 1. Skipping live service activation."
  echo "  Systemd units have been installed to /etc/systemd/system/."
fi
echo ""
if [ -n "$SELECTED_NGINX" ]; then
  echo "  NGINX detected: ${SELECTED_NGINX} (v${SELECTED_VERSION})"
  echo "  Module installed: $(basename "$SELECTED_MODULE") -> ${NGINX_MODULES_PATH}"
  echo ""
  echo "  To start the Data Plane:"
  echo "    1. Ensure 'load_module ${NGINX_MODULES_PATH}/ngx_http_aurora_waf_module.so;' is at the top of nginx.conf"
  echo "    2. Configure /etc/aurora-waf/node.env"
  echo "    3. sudo systemctl enable --now aurora-waf-nginx"
else
  echo "  Pre-built modules copied to /usr/lib/nginx/modules/:"
  for f in /usr/lib/nginx/modules/ngx_http_aurora_waf_module-*.so; do
    [ -f "$f" ] || continue
    echo "    - $(basename "$f")"
  done
  echo ""
  echo "  Supported NGINX versions: ${SUPPORTED_VERSIONS[*]:-see modules directory}"
fi
echo ""
echo "  Control Plane UI: http://127.0.0.1:8080"
echo "  Admin Token File: /etc/aurora-waf/admin.token"
echo "  Environment file: /etc/aurora-waf/controller.env"
echo ""
