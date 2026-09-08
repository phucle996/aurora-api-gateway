#!/usr/bin/env bash
# Owns dependency discovery/install. Called by the existing routing agent, never a proxy process.
set -euo pipefail
umask 077
dep_root=/var/lib/aurora-routing/dependencies
dep_package=/opt/aurora-dependencies/brotli
dep_nginx=/opt/nginx/usr/sbin/nginx
mkdir -p "$dep_root"

# These private workflow functions keep startup, scheduled checks and post-install proof identical.
dependency_http_config() {
  local dep_generation=$1 dep_brotli=$2
  printf 'server { listen 127.0.0.1:9085; server_name localhost;\n'
  printf 'location = /generation { return 200 "%s"; }\n' "$dep_generation"
  printf 'location = /gzip { gzip on; gzip_min_length 1; gzip_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }\n'
  if [ "$dep_brotli" = true ]; then
    printf 'location = /brotli { brotli on; brotli_min_length 1; brotli_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }\n'
  else
    printf 'location = /brotli { return 404; }\n'
  fi
  printf '}\n'
}

dependency_check() {
  local dep_version dep_arch dep_installable=false dep_brotli=false dep_gzip=false dep_h2=false dep_flags
  dep_version=$($dep_nginx -v 2>&1 | sed -n 's@.*nginx/\([0-9.]*\).*@\1@p')
  dep_arch=$(uname -m)
  if [ -f "$dep_package/SHA256SUMS" ] && [ "$(cat "$dep_package/nginx-version")" = "$dep_version" ] && [ "$(cat "$dep_package/architecture")" = "$dep_arch" ]; then
    if (cd "$dep_package" && sha256sum --check --status SHA256SUMS); then dep_installable=true; fi
  fi
  for dep_encoding in gzip brotli; do
    curl --silent --max-time 2 --raw -H "Accept-Encoding: $([ "$dep_encoding" = brotli ] && printf br || printf gzip)" -D "$dep_root/check.headers" "http://127.0.0.1:9085/$dep_encoding" -o /dev/null || true
    if grep -iq '^Content-Encoding: gzip' "$dep_root/check.headers"; then dep_gzip=true; fi
    if grep -iq '^Content-Encoding: br' "$dep_root/check.headers"; then dep_brotli=true; fi
  done
  printf 'events {} http { server { listen 127.0.0.1:19876; location / { proxy_pass http://127.0.0.1:19877; proxy_http_version 2; } } }\n' > "$dep_root/h2-check.conf"
  if timeout 10s "$dep_nginx" -t -c "$dep_root/h2-check.conf" > "$dep_root/check.log" 2>&1; then dep_h2=true; fi
  dep_flags=$($dep_nginx -V 2>&1 | tr ' ' '\n' | sed -n 's/^--with-\([a-z0-9_]*module\)$/\1/p')
  jq -n --arg version "$dep_version" --arg arch "$dep_arch" --arg flags "$dep_flags" \
    --argjson installable "$dep_installable" --argjson gzip "$dep_gzip" --argjson brotli "$dep_brotli" --argjson h2 "$dep_h2" \
    --arg error "$(cat "$dep_root/error" 2>/dev/null || true)" \
    '{checked_at:(now*1000|floor), nginx_version:$version, architecture:$arch, installable:$installable, error:$error,
      modules: ([{name:"gzip",available:$gzip,loaded:$gzip,source:"runtime response check"},
                 {name:"brotli",available:$brotli,loaded:$brotli,source:"runtime response check"},
                 {name:"http2_upstream",available:$h2,loaded:$h2,source:"nginx configuration test"}]
        + ($flags|split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"nginx build"}))),job_id:0,job_state:"",job_message:""}' > "$dep_root/report.json"
  # Report actual dynamically loaded module names, including Aurora and optional Brotli.
  "$dep_nginx" -T > "$dep_root/config.raw" 2>/dev/null || true
  sed -n 's/^load_module \([^;]*\);/\1/p' "$dep_root/config.raw" | while IFS= read -r dep_module; do basename "$dep_module" .so; done | jq -Rsc 'split("\n")|map(select(length>0)|{name:.,available:true,loaded:true,source:"loaded configuration"})' > "$dep_root/loaded.json"
  rm -f "$dep_root/config.raw"
  jq --slurpfile loaded "$dep_root/loaded.json" '.modules += $loaded[0] | .modules |= unique_by(.name)' "$dep_root/report.json" > "$dep_root/report.tmp"
  mv "$dep_root/report.tmp" "$dep_root/report.json"
}

dependency_install_brotli() {
  local dep_id=$1 dep_old dep_target="$dep_root/brotli-$1" dep_observed=false
  [ -f "$dep_package/SHA256SUMS" ] || return 1
  [ "$(cat "$dep_package/nginx-version")" = "$($dep_nginx -v 2>&1 | sed -n 's@.*nginx/\([0-9.]*\).*@\1@p')" ] || return 1
  [ "$(cat "$dep_package/architecture")" = "$(uname -m)" ] || return 1
  (cd "$dep_package" && sha256sum --check --status SHA256SUMS) || return 1
  mkdir -p "$dep_target"
  # Never overwrite a shared object inode that may already be mapped by a worker.
  for dep_module in ngx_http_brotli_filter_module.so ngx_http_brotli_static_module.so; do
    if [ ! -f "$dep_target/$dep_module" ]; then cp "$dep_package/$dep_module" "$dep_target/$dep_module.tmp"; chmod 600 "$dep_target/$dep_module.tmp"; mv "$dep_target/$dep_module.tmp" "$dep_target/$dep_module"; fi
  done
  cp "$dep_package/SHA256SUMS" "$dep_target/SHA256SUMS"
  (cd "$dep_target" && sha256sum --check --status SHA256SUMS) || return 1
  printf 'load_module %s/ngx_http_brotli_filter_module.so;\nload_module %s/ngx_http_brotli_static_module.so;\n' "$dep_target" "$dep_target" > "$dep_target/modules.conf"
  dependency_http_config "brotli-$dep_id" true > "$dep_target/http.conf"
  sed "s@$dep_root/current/@$dep_target/@g" /etc/nginx/nginx.conf > "$dep_root/candidate.conf"
  timeout 15s "$dep_nginx" -t -c "$dep_root/candidate.conf" > "$dep_root/install.log" 2>&1 || return 1
  dep_old=$(readlink "$dep_root/current")
  ln -sfn "$dep_target" "$dep_root/current.next" || return 1
  mv -Tf "$dep_root/current.next" "$dep_root/current" || return 1
  if sync -f "$dep_root" && "$dep_nginx" -s reload; then
    for dep_attempt in $(seq 1 40); do
      if [ "$(curl --silent --max-time 1 http://127.0.0.1:9085/generation)" = "brotli-$dep_id" ]; then dep_observed=true; break; fi
      sleep 0.25
    done
  fi
  if [ "$dep_observed" = true ]; then
    dependency_check
    if jq -e '.modules[]|select(.name=="brotli" and .loaded)' "$dep_root/report.json" >/dev/null; then
      rm -f "$dep_root/error"
      return 0
    fi
  fi
  ln -sfn "$dep_old" "$dep_root/current.rollback"
  mv -Tf "$dep_root/current.rollback" "$dep_root/current"
  sync -f "$dep_root"
  "$dep_nginx" -s reload || true
  return 1
}

if [ "${1:-}" = init ]; then
  mkdir -p "$dep_root/base" /usr/share/aurora-dependency-check
  chmod 755 /usr/share/aurora-dependency-check
  printf 'Aurora compression verification. %.0s' {1..256} > /usr/share/aurora-dependency-check/data.txt
  chmod 644 /usr/share/aurora-dependency-check/data.txt
  : > "$dep_root/base/modules.conf"
  dependency_http_config base false > "$dep_root/base/http.conf"
  if [ ! -L "$dep_root/current" ]; then ln -s "$dep_root/base" "$dep_root/current"; fi
  if ! timeout 15s "$dep_nginx" -t > "$dep_root/startup.log" 2>&1; then
    # An image/ABI change must not prevent NGINX from starting with its baseline modules.
    ln -sfn "$dep_root/base" "$dep_root/current.boot"
    mv -Tf "$dep_root/current.boot" "$dep_root/current"
    printf 'Optional module configuration failed startup validation; reverted to baseline.\n' > "$dep_root/error"
  fi
  rm -f "$dep_root/last-check"
  exit 0
fi

dep_headers=/etc/nginx/routing-auth.headers
dep_job=0 dep_action=check
if curl --fail --silent --max-time 3 -X POST -H @"$dep_headers" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/poll" -o "$dep_root/job.json"; then
  dep_job=$(jq -r '.id // 0' "$dep_root/job.json")
  dep_action=$(jq -r '.action // "check"' "$dep_root/job.json")
fi
[[ "$dep_job" =~ ^[0-9]+$ ]] || exit 1
dep_now=$(date +%s)
dep_last=$(cat "$dep_root/last-check" 2>/dev/null || printf 0)
if [ "$dep_job" = 0 ] && [ "$((dep_now-dep_last))" -lt 30 ]; then exit 0; fi
dep_state=succeeded dep_message='Dependency check completed'
if [ "$dep_job" != 0 ]; then
  if [ -f "$dep_root/completed-$dep_job.json" ]; then
    # Replay the durable result after a controller disconnect; never reinstall a completed job.
    dep_state=$(jq -r '.state' "$dep_root/completed-$dep_job.json")
    dep_message=$(jq -r '.message' "$dep_root/completed-$dep_job.json")
  elif [ "$dep_action" = install_brotli ]; then
    if dependency_install_brotli "$dep_job"; then dep_message='Brotli installed; NGINX reload and compressed response verified'; else dep_state=failed; dep_message='Brotli installation failed compatibility, integrity, or runtime verification; previous configuration retained'; fi
  elif [ "$dep_action" != check ]; then dep_state=failed; dep_message='Unsupported dependency action'; fi
  jq -n --arg state "$dep_state" --arg message "$dep_message" '{state:$state,message:$message}' > "$dep_root/completed-$dep_job.tmp"
  mv "$dep_root/completed-$dep_job.tmp" "$dep_root/completed-$dep_job.json"
  sync -f "$dep_root/completed-$dep_job.json"
fi
dependency_check
if [ "$dep_job" != 0 ] && [ "$dep_action" = install_brotli ] && [ "$dep_state" = succeeded ] && ! jq -e '.modules[]|select(.name=="brotli" and .loaded)' "$dep_root/report.json" >/dev/null; then
  dep_state=failed
  dep_message='Previously installed module is no longer active after restart; inspect dependencies and retry'
  jq -n --arg state "$dep_state" --arg message "$dep_message" '{state:$state,message:$message}' > "$dep_root/completed-$dep_job.tmp"
  mv "$dep_root/completed-$dep_job.tmp" "$dep_root/completed-$dep_job.json"
  sync -f "$dep_root/completed-$dep_job.json"
fi
if [ "$dep_job" != 0 ]; then
  jq --argjson id "$dep_job" --arg state "$dep_state" --arg message "$dep_message" '.job_id=$id|.job_state=$state|.job_message=$message' "$dep_root/report.json" > "$dep_root/report.tmp"
  mv "$dep_root/report.tmp" "$dep_root/report.json"
fi
if curl --fail --silent --max-time 5 -H @"$dep_headers" -H 'Content-Type: application/json' --data-binary @"$dep_root/report.json" "$CONTROLLER_URL/api/v1/dependency-sync/$NODE_ID/report" >/dev/null; then
  printf '%s' "$dep_now" > "$dep_root/last-check"
fi
