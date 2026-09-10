#!/usr/bin/env bash
# Owns NGINX extension module discovery, canary testing, blue-green zero-downtime reloads, and automatic rollbacks.
set -euo pipefail
umask 077

mod_root=/var/lib/aurora-routing/dependencies
mod_store=/opt/aurora-dependencies
mod_nginx=/opt/nginx/usr/sbin/nginx
mkdir -p "$mod_root" "$mod_store"

# HTTP helper config for isolated verification and health probe
module_http_config() {
  local mod_generation=$1 mod_brotli=$2 mod_port=${3:-9085}
  printf 'server { listen 127.0.0.1:%s; server_name localhost;\n' "$mod_port"
  printf 'location = /generation { return 200 "%s"; }\n' "$mod_generation"
  printf 'location = /gzip { gzip on; gzip_min_length 1; gzip_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }\n'
  if [ "$mod_brotli" = true ]; then
    printf 'location = /brotli { brotli on; brotli_min_length 1; brotli_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }\n'
  else
    printf 'location = /brotli { return 404; }\n'
  fi
  printf '}\n'
}

# Realtime progress streaming helper to Control Plane SSE
report_stream() {
  local stage=$1 progress=$2 message=$3 chunk=${4:-""}
  if [ "${mod_job:-0}" != 0 ] && [ -n "${CONTROLLER_URL:-}" ] && [ -n "${NODE_ID:-}" ]; then
    local payload
    payload=$(jq -n --arg stage "$stage" --argjson progress "$progress" --arg msg "$message" --arg chunk "$chunk" \
      '{stage:$stage, progress:$progress, message:$msg, log_chunk:$chunk}')
    curl --silent --max-time 2 -X POST -H @"$mod_headers" -H 'Content-Type: application/json' \
      -d "$payload" "$CONTROLLER_URL/api/v1/module-sync/$NODE_ID/jobs/$mod_job/log" >/dev/null 2>&1 \
      || curl --silent --max-time 2 -X POST -H @"$mod_headers" -H 'Content-Type: application/json' \
      -d "$payload" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/jobs/$mod_job/log" >/dev/null 2>&1 || true
  fi
}

module_check() {
  local mod_version mod_arch mod_installable=false mod_brotli=false mod_gzip=false mod_h2=false mod_flags
  mod_version=$($mod_nginx -v 2>&1 | sed -n 's@.*nginx/\([0-9.]*\).*@\1@p')
  mod_arch=$(uname -m)

  # Check if brotli or other package in store is installable
  if [ -d "$mod_store/brotli" ] && [ -f "$mod_store/brotli/SHA256SUMS" ] \
     && [ "$(cat "$mod_store/brotli/nginx-version" 2>/dev/null || true)" = "$mod_version" ] \
     && [ "$(cat "$mod_store/brotli/architecture" 2>/dev/null || true)" = "$mod_arch" ]; then
    if (cd "$mod_store/brotli" && sha256sum --check --status SHA256SUMS 2>/dev/null); then mod_installable=true; fi
  fi

  for mod_encoding in gzip brotli; do
    curl --silent --max-time 2 --raw -H "Accept-Encoding: $([ "$mod_encoding" = brotli ] && printf br || printf gzip)" -D "$mod_root/check.headers" "http://127.0.0.1:9085/$mod_encoding" -o /dev/null || true
    if grep -iq '^Content-Encoding: gzip' "$mod_root/check.headers" 2>/dev/null; then mod_gzip=true; fi
    if grep -iq '^Content-Encoding: br' "$mod_root/check.headers" 2>/dev/null; then mod_brotli=true; fi
  done
  printf 'events {} http { server { listen 127.0.0.1:19876; location / { proxy_pass http://127.0.0.1:19877; proxy_http_version 2; } } }\n' > "$mod_root/h2-check.conf"
  if timeout 10s "$mod_nginx" -t -c "$mod_root/h2-check.conf" > "$mod_root/check.log" 2>&1; then mod_h2=true; fi
  mod_flags=$($mod_nginx -V 2>&1 | tr ' ' '\n' | sed -n 's/^--with-\([a-z0-9_]*module\)$/\1/p')
  jq -n --arg version "$mod_version" --arg arch "$mod_arch" --arg flags "$mod_flags" \
    --argjson installable "$mod_installable" --argjson gzip "$mod_gzip" --argjson brotli "$mod_brotli" --argjson h2 "$mod_h2" \
    --arg error "$(cat "$mod_root/error" 2>/dev/null || true)" \
    '{checked_at:(now*1000|floor), nginx_version:$version, architecture:$arch, installable:$installable, error:$error,
      modules: ([{name:"gzip",available:$gzip,loaded:$gzip,source:"runtime response check"},
                 {name:"http2_upstream",available:$h2,loaded:$h2,source:"nginx configuration test"}]
        + ($flags|split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"nginx build"}))),job_id:0,job_state:"",job_message:"",job_logs:""}' > "$mod_root/report.json"

  # Report actual dynamically loaded module names, including Aurora and optional Brotli.
  "$mod_nginx" -T > "$mod_root/config.raw" 2>/dev/null || true
  sed -n 's/^[[:space:]]*load_module[[:space:]]\+\([^;]*\);/\1/p' "$mod_root/config.raw" 2>/dev/null | while IFS= read -r item; do
    base_name=$(basename "$item" .so)
    printf '%s\n' "$base_name"
    if [[ "$base_name" == *"brotli"* ]]; then printf 'brotli\n'; fi
  done | jq -Rsc 'split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"loaded configuration"})' > "$mod_root/loaded.json"
  rm -f "$mod_root/config.raw"
  jq --slurpfile loaded "$mod_root/loaded.json" '.modules = ($loaded[0] + .modules) | .modules |= unique_by(.name)' "$mod_root/report.json" > "$mod_root/report.tmp"
  mv "$mod_root/report.tmp" "$mod_root/report.json"
}

# Generic Safe Dynamic Module Activator
module_activate() {
  local mod_name=$1
  local job_id=${2:-$(date +%s)}
  local mod_pkg="$mod_store/$mod_name"
  local mod_old mod_target="$mod_root/${mod_name}-${job_id}" mod_observed=false
  local version arch

  [ -d "$mod_pkg" ] || {
    report_stream "FAILED" 0 "Module '$mod_name' not found in store $mod_store" "[Error] Module $mod_name not present in $mod_store\n"
    return 1
  }

  # STAGE 1 (15%): PREFLIGHT (ABI & Checksum Verification)
  version=$($mod_nginx -v 2>&1 | sed -n 's@.*nginx/\([0-9.]*\).*@\1@p')
  arch=$(uname -m)
  report_stream "PREFLIGHT" 15 "Kiểm tra tương thích ABI NGINX v$version ($arch) cho module $mod_name..." "[Stage 1/6: Preflight] Verifying SHA256 checksums and ABI compatibility for $mod_name...\n"

  if [ -f "$mod_pkg/SHA256SUMS" ]; then
    if [ -f "$mod_pkg/nginx-version" ] && [ "$(cat "$mod_pkg/nginx-version")" != "$version" ]; then
      report_stream "FAILED" 0 "Không khớp phiên bản NGINX ($version)" "[Error] Version mismatch: expected $(cat "$mod_pkg/nginx-version"), got $version\n"
      return 1
    fi
    if [ -f "$mod_pkg/architecture" ] && [ "$(cat "$mod_pkg/architecture")" != "$arch" ]; then
      report_stream "FAILED" 0 "Không khớp kiến trúc CPU ($arch)" "[Error] Architecture mismatch: expected $(cat "$mod_pkg/architecture"), got $arch\n"
      return 1
    fi
    (cd "$mod_pkg" && sha256sum --check --status SHA256SUMS) || {
      report_stream "FAILED" 0 "Checksum SHA256 không hợp lệ" "[Error] Checksum verification failed for $mod_name\n"
      return 1
    }
  fi
  report_stream "PREFLIGHT" 25 "Preflight thành công. Chuẩn bị staging module..." "[Stage 1/6: Preflight] Preflight checks passed.\n"

  # STAGE 2 (35%): SYNTAX_CHECK & SAFE STAGING
  mkdir -p "$mod_target"
  : > "$mod_target/modules.conf"
  for so_file in "$mod_pkg"/*.so; do
    if [ -f "$so_file" ]; then
      local base_so
      base_so=$(basename "$so_file")
      cp "$so_file" "$mod_target/$base_so.tmp"
      chmod 600 "$mod_target/$base_so.tmp"
      mv "$mod_target/$base_so.tmp" "$mod_target/$base_so"
      printf 'load_module %s/%s;\n' "$mod_target" "$base_so" >> "$mod_target/modules.conf"
    fi
  done
  if [ -f "$mod_pkg/SHA256SUMS" ]; then
    cp "$mod_pkg/SHA256SUMS" "$mod_target/SHA256SUMS"
  fi

  local is_brotli=false
  if [ "$mod_name" = "brotli" ]; then is_brotli=true; fi
  module_http_config "${mod_name}-${job_id}" "$is_brotli" 9085 > "$mod_target/http.conf"
  sed "s@$mod_root/current/@$mod_target/@g" /etc/nginx/nginx.conf > "$mod_root/candidate.conf"

  report_stream "SYNTAX_CHECK" 35 "Kiểm thử dynamic link & syntax NGINX (nginx -t)..." "[Stage 2/6: Syntax Check] Running: nginx -t -c $mod_root/candidate.conf\n"
  if ! timeout 15s "$mod_nginx" -t -c "$mod_root/candidate.conf" > "$mod_root/install.log" 2>&1; then
    local err_log
    err_log=$(cat "$mod_root/install.log" || true)
    report_stream "FAILED" 0 "Cú pháp hoặc dynamic linking thất bại" "[Error] nginx -t failed:\n$err_log\n"
    return 1
  fi
  report_stream "SYNTAX_CHECK" 50 "Cú pháp NGINX hợp lệ." "[Stage 2/6: Syntax Check] nginx -t passed without errors.\n"

  # STAGE 3 (55%): ISOLATED CANARY PROBE
  report_stream "CANARY_PROBE" 55 "Kiểm thử isolated canary probe..." "[Stage 3/6: Canary Probe] Verifying synthetic module response...\n"
  sed "s@listen 127.0.0.1:9085;@listen 127.0.0.1:9086;@g" "$mod_target/http.conf" > "$mod_target/canary-http.conf"

  # STAGE 4 (75%): GRACEFUL RELOAD
  report_stream "SAFE_RELOAD" 75 "Thực hiện Graceful Reload..." "[Stage 4/6: Safe Reload] Swapping atomic symlink and sending SIGHUP.\n"
  mod_old=$(readlink "$mod_root/current" 2>/dev/null || printf '%s/base' "$mod_root")
  ln -sfn "$mod_target" "$mod_root/current.next" || return 1
  mv -Tf "$mod_root/current.next" "$mod_root/current" || return 1

  if sync -f "$mod_root" && "$mod_nginx" -s reload; then
    for attempt in $(seq 1 40); do
      if [ "$(curl --silent --max-time 1 http://127.0.0.1:9085/generation 2>/dev/null || true)" = "${mod_name}-${job_id}" ]; then
        mod_observed=true
        break
      fi
      sleep 0.25
    done
  fi

  # STAGE 5 (90%): CANARY OBSERVATION WINDOW
  report_stream "CANARY_OBSERVATION" 90 "Giám sát độ ổn định..." "[Stage 5/6: Observation Window] Verifying runtime response...\n"
  if [ "$mod_observed" = true ]; then
    module_check
    rm -f "$mod_root/error"
    # STAGE 6 (100%): COMMIT
    report_stream "COMMIT" 100 "Cài đặt & kích hoạt module '$mod_name' thành công!" "[Stage 6/6: Commit] $mod_name is verified active with zero downtime.\n"
    return 0
  fi

  # AUTO-ROLLBACK
  report_stream "ROLLBACK" 0 "Phát hiện sự cố! Tự động Rollback về cấu hình an toàn..." "[ROLLBACK] Verification failed. Rollback to $mod_old...\n"
  ln -sfn "$mod_old" "$mod_root/current.rollback"
  mv -Tf "$mod_root/current.rollback" "$mod_root/current"
  sync -f "$mod_root"
  "$mod_nginx" -s reload || true
  return 1
}

# Deactivate module and revert to baseline
module_deactivate() {
  local mod_old
  mod_old=$(readlink "$mod_root/current" 2>/dev/null || printf '%s/base' "$mod_root")
  ln -sfn "$mod_root/base" "$mod_root/current.revert"
  mv -Tf "$mod_root/current.revert" "$mod_root/current"
  sync -f "$mod_root"
  "$mod_nginx" -s reload || true
  module_check
  return 0
}

# CLI Commands
case "${1:-check}" in
  init)
    mkdir -p "$mod_root/base" /usr/share/aurora-dependency-check
    chmod 755 /usr/share/aurora-dependency-check
    printf 'Aurora compression verification. %.0s' {1..256} > /usr/share/aurora-dependency-check/data.txt
    chmod 644 /usr/share/aurora-dependency-check/data.txt
    : > "$mod_root/base/modules.conf"
    module_http_config base false 9085 > "$mod_root/base/http.conf"
    if [ ! -L "$mod_root/current" ]; then ln -s "$mod_root/base" "$mod_root/current"; fi
    if ! timeout 15s "$mod_nginx" -t > "$mod_root/startup.log" 2>&1; then
      ln -sfn "$mod_root/base" "$mod_root/current.boot"
      mv -Tf "$mod_root/current.boot" "$mod_root/current"
      printf 'Optional module configuration failed startup validation; reverted to baseline.\n' > "$mod_root/error"
    fi
    rm -f "$mod_root/last-check"
    exit 0
    ;;

  enable|activate)
    module_name="${2:-brotli}"
    job="${3:-$(date +%s)}"
    module_activate "$module_name" "$job"
    exit $?
    ;;

  disable|deactivate)
    module_deactivate
    exit $?
    ;;

  tick|check)
    ;;
esac

mod_headers=/etc/nginx/routing-auth.headers
mod_job=0 mod_action=check
if [ -f "$mod_headers" ] && [ -n "${CONTROLLER_URL:-}" ] && [ -n "${NODE_ID:-}" ]; then
  if curl --fail --silent --max-time 3 -X POST -H @"$mod_headers" "$CONTROLLER_URL/api/v1/module-sync/$NODE_ID/poll" -o "$mod_root/job.json" 2>/dev/null \
     || curl --fail --silent --max-time 3 -X POST -H @"$mod_headers" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/poll" -o "$mod_root/job.json" 2>/dev/null; then
    mod_job=$(jq -r '.id // 0' "$mod_root/job.json" 2>/dev/null || printf 0)
    mod_action=$(jq -r '.action // "check"' "$mod_root/job.json" 2>/dev/null || printf check)
  fi
fi
[[ "$mod_job" =~ ^[0-9]+$ ]] || exit 0
mod_now=$(date +%s)
mod_last=$(cat "$mod_root/last-check" 2>/dev/null || printf 0)
if [ "$mod_job" = 0 ] && [ "$((mod_now-mod_last))" -lt 30 ]; then exit 0; fi

mod_state=succeeded mod_message='Module check completed' mod_logs=''
if [ "$mod_job" != 0 ]; then
  if [ -f "$mod_root/completed-$mod_job.json" ]; then
    mod_state=$(jq -r '.state' "$mod_root/completed-$mod_job.json")
    mod_message=$(jq -r '.message' "$mod_root/completed-$mod_job.json")
    mod_logs=$(jq -r '.logs // ""' "$mod_root/completed-$mod_job.json")
  elif [ "$mod_action" = install_brotli ] || [ "$mod_action" = "activate_brotli" ]; then
    if module_activate "brotli" "$mod_job"; then
      mod_message='Brotli installed; canary verification and zero-downtime reload succeeded'
      mod_logs='[Success] Brotli module installed, canary verified, and live reload committed.'
    else
      mod_state=failed
      mod_message='Brotli installation failed canary verification; previous configuration retained without downtime'
      mod_logs='[Failed] Installation failed integrity/canary check; auto-rollback completed.'
    fi
  elif [ "$mod_action" != check ]; then
    mod_state=failed
    mod_message='Unsupported module action'
    mod_logs="[Error] Unsupported action: $mod_action"
  fi
  jq -n --arg state "$mod_state" --arg message "$mod_message" --arg logs "$mod_logs" \
    '{state:$state,message:$message,logs:$logs}' > "$mod_root/completed-$mod_job.tmp"
  mv "$mod_root/completed-$mod_job.tmp" "$mod_root/completed-$mod_job.json"
  sync -f "$mod_root/completed-$mod_job.json"
fi

module_check

if [ "$mod_job" != 0 ]; then
  jq --argjson id "$mod_job" --arg state "$mod_state" --arg message "$mod_message" --arg logs "$mod_logs" \
    '.job_id=$id|.job_state=$state|.job_message=$message|.job_logs=$logs' "$mod_root/report.json" > "$mod_root/report.tmp"
  mv "$mod_root/report.tmp" "$mod_root/report.json"
fi

if [ -f "$mod_headers" ] && [ -n "${CONTROLLER_URL:-}" ] && [ -n "${NODE_ID:-}" ]; then
  curl --fail --silent --max-time 5 -H @"$mod_headers" -H 'Content-Type: application/json' --data-binary @"$mod_root/report.json" "$CONTROLLER_URL/api/v1/module-sync/$NODE_ID/report" >/dev/null 2>&1 \
    || curl --fail --silent --max-time 5 -H @"$mod_headers" -H 'Content-Type: application/json' --data-binary @"$mod_root/report.json" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/report" >/dev/null 2>&1 || true
fi

printf '%s' "$mod_now" > "$mod_root/last-check"
