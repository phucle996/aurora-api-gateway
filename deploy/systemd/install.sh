#!/usr/bin/env bash
# Aurora WAF Linux installer.
# Detects NGINX installations, matches the correct module version, generates systemd units, and starts services.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root." >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

# Read supported NGINX versions from the bundled manifest.
SUPPORTED_VERSIONS=()
if [ -f "${SCRIPT_DIR}/modules/supported-versions.txt" ]; then
  while IFS=' ' read -r ver _sha; do
    [[ "$ver" =~ ^#.*$ || -z "$ver" ]] && continue
    SUPPORTED_VERSIONS+=("$ver")
  done < "${SCRIPT_DIR}/modules/supported-versions.txt"
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

# Check if a module .so exists for a given NGINX version.
find_module_for_version() {
  local ver="$1"
  local module="${SCRIPT_DIR}/modules/ngx_http_aurora_waf_module-${ver}.so"
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
  echo "  WARNING: No supported-versions.txt found in modules directory."
fi
echo ""

# Detect all NGINX binaries on this host.
echo "==> Scanning for NGINX installations..."
mapfile -t nginx_bins < <(detect_nginx)

SELECTED_NGINX=""
SELECTED_MODULE=""

if [ ${#nginx_bins[@]} -eq 0 ]; then
  echo ""
  echo "  No NGINX installation found on this host."
  echo "  The Control Plane will still be installed."
  echo "  Modules will be copied to /usr/lib/nginx/modules/ for later use."
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

  while true; do
    read -rp "  Select NGINX to install module into [0-${#nginx_bins[@]}]: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 0 ] && [ "$choice" -le "${#nginx_bins[@]}" ]; then
      break
    fi
    echo "  Invalid choice. Try again."
  done

  if [ "$choice" -eq 0 ]; then
    echo "  Skipping NGINX module installation."
  else
    SELECTED_NGINX="${nginx_bins[$((choice - 1))]}"
    SELECTED_VERSION=$(get_nginx_version "$SELECTED_NGINX")
    SELECTED_MODULE=$(find_module_for_version "$SELECTED_VERSION")

    if [ -z "$SELECTED_MODULE" ]; then
      echo ""
      echo "  ERROR: No pre-built module found for NGINX ${SELECTED_VERSION}."
      echo "  Available modules:"
      for f in "${SCRIPT_DIR}"/modules/ngx_http_aurora_waf_module-*.so; do
        [ -f "$f" ] || continue
        local_ver=$(basename "$f" | sed 's/ngx_http_aurora_waf_module-//;s/\.so//')
        echo "    - ${local_ver}"
      done
      echo ""
      echo "  You can build a compatible module from source with:"
      echo "    NGINX_VERSION=${SELECTED_VERSION} bash scripts/build-nginx-module.sh"
      echo ""
      echo "  Control Plane will still be installed."
      SELECTED_NGINX=""
    else
      echo ""
      echo "  Matched module: $(basename "$SELECTED_MODULE") for NGINX ${SELECTED_VERSION}"
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
mkdir -p /var/run/aurora-waf

# ── Binaries ───────────────────────────────────────────────────────────────────
echo "==> Installing Aurora WAF binaries..."
install -m 755 "${SCRIPT_DIR}/bin/aurora-controller" /usr/local/bin/aurora-controller
install -m 755 "${SCRIPT_DIR}/bin/aurora-compile"    /usr/local/bin/aurora-compile

# ── NGINX module ───────────────────────────────────────────────────────────────
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
  # Copy all modules to a standard location for later use.
  echo "==> Copying all WAF modules to /usr/lib/nginx/modules/..."
  mkdir -p /usr/lib/nginx/modules
  for f in "${SCRIPT_DIR}"/modules/ngx_http_aurora_waf_module-*.so; do
    [ -f "$f" ] || continue
    install -m 755 "$f" /usr/lib/nginx/modules/
  done
  NGINX_CONF="/etc/nginx/nginx.conf"
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
RuntimeDirectory=aurora-waf

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
PIDFile=/var/run/aurora-waf/nginx.pid

Environment="NODE_ID=node-01"
Environment="CONTROL_PLANE_URL=https://control-plane.internal:8080"
Environment="POLICY_DEST=/etc/aurora-waf/active-policy.json"
Environment="CERTS_DIR=/etc/aurora-waf/certs"
Environment="NGINX_CONF=${UNIT_NGINX_CONF}"
EnvironmentFile=-/etc/aurora-waf/node.env

ExecStartPre=/usr/bin/bash -c '\\
    set -euo pipefail; \\
    mkdir -p \$(dirname "\$POLICY_DEST") /var/run/aurora-waf; \\
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
systemctl daemon-reload

echo "==> Enabling and starting aurora-waf-controller..."
systemctl enable --now aurora-waf-controller

echo ""
echo "========================================"
echo "  Aurora WAF Control Plane is running."
echo "========================================"
echo ""
if [ -n "$SELECTED_NGINX" ]; then
  echo "  NGINX detected: ${SELECTED_NGINX} (v${SELECTED_VERSION})"
  echo "  Module installed: $(basename "$SELECTED_MODULE") -> ${NGINX_MODULES_PATH}"
  echo ""
  echo "  To start the Data Plane:"
  echo "    1. Ensure 'load_module ...ngx_http_aurora_waf_module.so;' is in nginx.conf"
  echo "    2. Configure /etc/aurora-waf/node.env"
  echo "    3. sudo systemctl enable --now aurora-waf-nginx"
else
  echo "  No NGINX was selected for module installation."
  echo "  Pre-built modules copied to /usr/lib/nginx/modules/:"
  for f in /usr/lib/nginx/modules/ngx_http_aurora_waf_module-*.so; do
    [ -f "$f" ] || continue
    echo "    - $(basename "$f")"
  done
  echo ""
  echo "  Supported NGINX versions: ${SUPPORTED_VERSIONS[*]:-see modules directory}"
fi
echo ""
echo "  Override defaults: /etc/aurora-waf/controller.env or node.env"
echo ""
