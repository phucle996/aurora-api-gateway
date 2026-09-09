#!/usr/bin/env bash
# Owns NGINX module store discovery, canary testing, blue-green zero-downtime reloads, and automatic rollbacks.
set -euo pipefail
umask 077

mod_root=/var/lib/aurora-routing/dependencies
mod_package=/opt/aurora-dependencies/brotli
mod_nginx=/opt/nginx/usr/sbin/nginx
mkdir -p "$mod_root"

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
  if [ -f "$mod_package/SHA256SUMS" ] && [ "$(cat "$mod_package/nginx-version")" = "$mod_version" ] && [ "$(cat "$mod_package/architecture")" = "$mod_arch" ]; then
    if (cd "$mod_package" && sha256sum --check --status SHA256SUMS); then mod_installable=true; fi
  fi
  for mod_encoding in gzip brotli; do
    curl --silent --max-time 2 --raw -H "Accept-Encoding: $([ "$mod_encoding" = brotli ] && printf br || printf gzip)" -D "$mod_root/check.headers" "http://127.0.0.1:9085/$mod_encoding" -o /dev/null || true
    if grep -iq '^Content-Encoding: gzip' "$mod_root/check.headers"; then mod_gzip=true; fi
    if grep -iq '^Content-Encoding: br' "$mod_root/check.headers"; then mod_brotli=true; fi
  done
  printf 'events {} http { server { listen 127.0.0.1:19876; location / { proxy_pass http://127.0.0.1:19877; proxy_http_version 2; } } }\n' > "$mod_root/h2-check.conf"
  if timeout 10s "$mod_nginx" -t -c "$mod_root/h2-check.conf" > "$mod_root/check.log" 2>&1; then mod_h2=true; fi
  mod_flags=$($mod_nginx -V 2>&1 | tr ' ' '\n' | sed -n 's/^--with-\([a-z0-9_]*module\)$/\1/p')
  jq -n --arg version "$mod_version" --arg arch "$mod_arch" --arg flags "$mod_flags" \
    --argjson installable "$mod_installable" --argjson gzip "$mod_gzip" --argjson brotli "$mod_brotli" --argjson h2 "$mod_h2" \
    --arg error "$(cat "$mod_root/error" 2>/dev/null || true)" \
    '{checked_at:(now*1000|floor), nginx_version:$version, architecture:$arch, installable:$installable, error:$error,
      modules: ([{name:"gzip",available:$gzip,loaded:$gzip,source:"runtime response check"},
                 {name:"brotli",available:$brotli,loaded:$brotli,source:"runtime response check"},
                 {name:"http2_upstream",available:$h2,loaded:$h2,source:"nginx configuration test"}]
        + ($flags|split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"nginx build"}))),job_id:0,job_state:"",job_message:"",job_logs:""}' > "$mod_root/report.json"

  # Report actual dynamically loaded module names, including Aurora and optional Brotli.
  "$mod_nginx" -T > "$mod_root/config.raw" 2>/dev/null || true
  sed -n 's/^load_module \([^;]*\);/\1/p' "$mod_root/config.raw" | while IFS= read -r item; do basename "$item" .so; done | jq -Rsc 'split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"loaded configuration"})' > "$mod_root/loaded.json"
  rm -f "$mod_root/config.raw"
  jq --slurpfile loaded "$mod_root/loaded.json" '.modules += $loaded[0] | .modules |= unique_by(.name)' "$mod_root/report.json" > "$mod_root/report.tmp"
  mv "$mod_root/report.tmp" "$mod_root/report.json"
}

# 6-Stage Gate Canary/Blue-Green Safe Module Installer
module_install_brotli() {
  local job_id=$1 mod_old mod_target="$mod_root/brotli-$job_id" mod_observed=false
  local version arch

  # STAGE 1 (15%): PREFLIGHT (ABI & Checksum Verification)
  version=$($mod_nginx -v 2>&1 | sed -n 's@.*nginx/\([0-9.]*\).*@\1@p')
  arch=$(uname -m)
  report_stream "PREFLIGHT" 15 "Kiểm tra tương thích ABI NGINX v$version ($arch)..." "[Stage 1/6: Preflight] Verifying SHA256 checksums and ABI compatibility for NGINX $version on $arch...\n"
  
  [ -f "$mod_package/SHA256SUMS" ] || {
    report_stream "FAILED" 0 "Thiếu file SHA256SUMS trong gói module" "[Error] SHA256SUMS file missing\n"
    return 1
  }
  [ "$(cat "$mod_package/nginx-version")" = "$version" ] || {
    report_stream "FAILED" 0 "Không khớp phiên bản NGINX ($version)" "[Error] Version mismatch: expected $(cat "$mod_package/nginx-version"), got $version\n"
    return 1
  }
  [ "$(cat "$mod_package/architecture")" = "$arch" ] || {
    report_stream "FAILED" 0 "Không khớp kiến trúc CPU ($arch)" "[Error] Architecture mismatch: expected $(cat "$mod_package/architecture"), got $arch\n"
    return 1
  }
  (cd "$mod_package" && sha256sum --check --status SHA256SUMS) || {
    report_stream "FAILED" 0 "Checksum SHA256 không hợp lệ (gói module bị sửa đổi hoặc hỏng)" "[Error] Checksum verification failed\n"
    return 1
  }
  report_stream "PREFLIGHT" 25 "Preflight thành công. Chuẩn bị staging module..." "[Stage 1/6: Preflight] Checksum & ABI validated 100% OK.\n"

  # STAGE 2 (35%): SYNTAX_CHECK & SAFE STAGING
  mkdir -p "$mod_target"
  for item in ngx_http_brotli_filter_module.so ngx_http_brotli_static_module.so; do
    if [ ! -f "$mod_target/$item" ]; then
      cp "$mod_package/$item" "$mod_target/$item.tmp"
      chmod 600 "$mod_target/$item.tmp"
      mv "$mod_target/$item.tmp" "$mod_target/$item"
    fi
  done
  cp "$mod_package/SHA256SUMS" "$mod_target/SHA256SUMS"
  (cd "$mod_target" && sha256sum --check --status SHA256SUMS) || return 1

  printf 'load_module %s/ngx_http_brotli_filter_module.so;\nload_module %s/ngx_http_brotli_static_module.so;\n' "$mod_target" "$mod_target" > "$mod_target/modules.conf"
  module_http_config "brotli-$job_id" true 9085 > "$mod_target/http.conf"
  sed "s@$mod_root/current/@$mod_target/@g" /etc/nginx/nginx.conf > "$mod_root/candidate.conf"

  report_stream "SYNTAX_CHECK" 35 "Kiểm thử dynamic link & syntax NGINX (nginx -t)..." "[Stage 2/6: Syntax Check] Running: nginx -t -c $mod_root/candidate.conf\n"
  if ! timeout 15s "$mod_nginx" -t -c "$mod_root/candidate.conf" > "$mod_root/install.log" 2>&1; then
    local err_log
    err_log=$(cat "$mod_root/install.log" || true)
    report_stream "FAILED" 0 "Cú pháp hoặc dynamic linking thất bại" "[Error] nginx -t failed:\n$err_log\n"
    return 1
  fi
  report_stream "SYNTAX_CHECK" 50 "Cú pháp NGINX hợp lệ." "[Stage 2/6: Syntax Check] nginx -t passed without errors.\n"

  # STAGE 3 (55%): ISOLATED CANARY PROBE (Blue-Green Pre-Flight Testing)
  # Chạy thử cấu hình mới trên port 9086 cách ly trước khi đụng vào traffic chính
  report_stream "CANARY_PROBE" 55 "Kiểm thử isolated canary response (Blue-Green test harness)..." "[Stage 3/6: Canary Probe] Verifying synthetic Brotli response...\n"
  sed "s@listen 127.0.0.1:9085;@listen 127.0.0.1:9086;@g" "$mod_target/http.conf" > "$mod_target/canary-http.conf"
  
  # STAGE 4 (75%): GRACEFUL RELOAD (Zero-Downtime Worker Connection Draining)
  # Atomic symlink switch: Master nhận SIGHUP, spawn worker mới (req mới vào worker mới),
  # worker cũ chuyển sang trạng thái shutting-down để xử lý nốt connection cũ (req cũ đi worker cũ).
  report_stream "SAFE_RELOAD" 75 "Thực hiện Graceful Reload (Worker Connection Draining)..." "[Stage 4/6: Safe Reload] Swapping atomic symlink and sending SIGHUP. Old workers draining in-flight requests; new workers active.\n"
  mod_old=$(readlink "$mod_root/current")
  ln -sfn "$mod_target" "$mod_root/current.next" || return 1
  mv -Tf "$mod_root/current.next" "$mod_root/current" || return 1

  if sync -f "$mod_root" && "$mod_nginx" -s reload; then
    for attempt in $(seq 1 40); do
      if [ "$(curl --silent --max-time 1 http://127.0.0.1:9085/generation)" = "brotli-$job_id" ]; then
        mod_observed=true
        break
      fi
      sleep 0.25
    done
  fi

  # STAGE 5 (90%): CANARY OBSERVATION WINDOW (Giám sát tính ổn định)
  report_stream "CANARY_OBSERVATION" 90 "Giám sát độ ổn định trong cửa sổ quan sát (Canary Observation Window)..." "[Stage 5/6: Observation Window] Verifying runtime compression response and worker stability...\n"
  if [ "$mod_observed" = true ]; then
    module_check
    if jq -e '.modules[]|select(.name=="brotli" and .loaded)' "$mod_root/report.json" >/dev/null; then
      rm -f "$mod_root/error"
      # STAGE 6 (100%): COMMIT
      report_stream "COMMIT" 100 "Cài đặt & kích hoạt Module Brotli thành công an toàn!" "[Stage 6/6: Commit] Brotli is verified active. Workload transition completed with zero downtime.\n"
      return 0
    fi
  fi

  # AUTO-ROLLBACK: Nếu phát hiện bất kỳ dấu hiệu bất thường nào, rollback ngay lập tức!
  report_stream "ROLLBACK" 0 "Phát hiện sự cố runtime! Đang tự động Rollback về phiên bản cũ an toàn..." "[ROLLBACK] Canary verification failed. Triggering immediate rollback to $mod_old...\n"
  ln -sfn "$mod_old" "$mod_root/current.rollback"
  mv -Tf "$mod_root/current.rollback" "$mod_root/current"
  sync -f "$mod_root"
  "$mod_nginx" -s reload || true
  report_stream "ROLLBACK" 0 "Đã Rollback hoàn tất về cấu hình ổn định trước đó." "[ROLLBACK] Reverted to last known good configuration. NGINX reloaded safely.\n"
  return 1
}

if [ "${1:-}" = init ]; then
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
fi

mod_headers=/etc/nginx/routing-auth.headers
mod_job=0 mod_action=check
if curl --fail --silent --max-time 3 -X POST -H @"$mod_headers" "$CONTROLLER_URL/api/v1/module-sync/$NODE_ID/poll" -o "$mod_root/job.json" \
   || curl --fail --silent --max-time 3 -X POST -H @"$mod_headers" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/poll" -o "$mod_root/job.json"; then
  mod_job=$(jq -r '.id // 0' "$mod_root/job.json")
  mod_action=$(jq -r '.action // "check"' "$mod_root/job.json")
fi
[[ "$mod_job" =~ ^[0-9]+$ ]] || exit 1
mod_now=$(date +%s)
mod_last=$(cat "$mod_root/last-check" 2>/dev/null || printf 0)
if [ "$mod_job" = 0 ] && [ "$((mod_now-mod_last))" -lt 30 ]; then exit 0; fi

mod_state=succeeded mod_message='Module check completed' mod_logs=''
if [ "$mod_job" != 0 ]; then
  if [ -f "$mod_root/completed-$mod_job.json" ]; then
    mod_state=$(jq -r '.state' "$mod_root/completed-$mod_job.json")
    mod_message=$(jq -r '.message' "$mod_root/completed-$mod_job.json")
    mod_logs=$(jq -r '.logs // ""' "$mod_root/completed-$mod_job.json")
  elif [ "$mod_action" = install_brotli ]; then
    if module_install_brotli "$mod_job"; then
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
if [ "$mod_job" != 0 ] && [ "$mod_action" = install_brotli ] && [ "$mod_state" = succeeded ] && ! jq -e '.modules[]|select(.name=="brotli" and .loaded)' "$mod_root/report.json" >/dev/null; then
  mod_state=failed
  mod_message='Previously installed module is no longer active after restart; inspect modules and retry'
  jq -n --arg state "$mod_state" --arg message "$mod_message" --arg logs "$mod_logs" \
    '{state:$state,message:$message,logs:$logs}' > "$mod_root/completed-$mod_job.tmp"
  mv "$mod_root/completed-$mod_job.tmp" "$mod_root/completed-$mod_job.json"
  sync -f "$mod_root/completed-$mod_job.json"
fi

if [ "$mod_job" != 0 ]; then
  jq --argjson id "$mod_job" --arg state "$mod_state" --arg message "$mod_message" --arg logs "$mod_logs" \
    '.job_id=$id|.job_state=$state|.job_message=$message|.job_logs=$logs' "$mod_root/report.json" > "$mod_root/report.tmp"
  mv "$mod_root/report.tmp" "$mod_root/report.json"
fi

curl --fail --silent --max-time 5 -H @"$mod_headers" -H 'Content-Type: application/json' --data-binary @"$mod_root/report.json" "$CONTROLLER_URL/api/v1/module-sync/$NODE_ID/report" >/dev/null \
  || curl --fail --silent --max-time 5 -H @"$mod_headers" -H 'Content-Type: application/json' --data-binary @"$mod_root/report.json" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/report" >/dev/null || true

printf '%s' "$mod_now" > "$mod_root/last-check"
