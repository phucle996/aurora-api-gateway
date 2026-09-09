#!/usr/bin/env bash
# Owns the Docker NGINX routing apply boundary; failed candidates never replace last-known-good routing.
set -uo pipefail
umask 077
routing_dir=/var/lib/aurora-routing
routing_active=$routing_dir/active-domain-routing.conf
routing_candidate=$routing_dir/candidate-domain-routing.conf
routing_previous=$routing_dir/previous-domain-routing.conf
routing_bundle=$routing_dir/candidate-bundle.json
mkdir -p "$routing_dir/certificates"
chmod 700 "$routing_dir/certificates"
routing_test=/etc/nginx/routing-validation.conf
routing_headers=/etc/nginx/routing-auth.headers
printf 'Authorization: Bearer %s\n' "$AUTH_TOKEN" > "$routing_headers"
while true; do
  if [ -x /node-modules.sh ]; then
    /node-modules.sh tick || printf '[Modules] check failed; retrying\n' >&2
  else
    /node-dependencies.sh tick || printf '[Dependencies] check failed; retrying\n' >&2
  fi
  if [ -s /var/run/nginx.pid ] && curl --fail --silent --show-error --max-time 5 -H @"$routing_headers" "$CONTROLLER_URL/api/v1/domain-routing/$NODE_ID/bundle" -o "$routing_bundle"; then
    routing_files_ok=true
    if ! jq -e '.config | type == "string"' "$routing_bundle" >/dev/null || ! jq -e '.files | type == "array"' "$routing_bundle" >/dev/null; then
      rm -f "$routing_bundle"
      sleep 2
      continue
    fi
    while IFS= read -r routing_asset; do
      routing_name=$(printf '%s' "$routing_asset" | jq -r '.name')
      if [[ ! "$routing_name" =~ ^[a-f0-9]{64}\.pem$ ]]; then routing_files_ok=false; break; fi
      routing_pem="$routing_dir/certificates/$routing_name"
      if [ -f "$routing_pem" ] && [ "$(sha256sum "$routing_pem" | cut -d ' ' -f 1).pem" = "$routing_name" ]; then continue; fi
      if ! printf '%s' "$routing_asset" | jq -r '.content' | base64 -d > "$routing_pem.tmp"; then routing_files_ok=false; break; fi
      routing_hash=$(sha256sum "$routing_pem.tmp" | cut -d ' ' -f 1)
      if [ "$routing_hash.pem" != "$routing_name" ]; then routing_files_ok=false; break; fi
      chmod 600 "$routing_pem.tmp"
      if ! mv "$routing_pem.tmp" "$routing_pem" || ! sync -f "$routing_pem"; then routing_files_ok=false; break; fi
    done < <(jq -c '.files[]' "$routing_bundle")
    if [ "$routing_files_ok" != true ] || ! jq -j '.config' "$routing_bundle" > "$routing_candidate"; then
      rm -f "$routing_bundle"
      sleep 2
      continue
    fi
    rm -f "$routing_bundle"
    if ! cmp -s "$routing_candidate" "$routing_active"; then
      routing_digest=$(sed -n '1s/^# routing-digest: //p' "$routing_candidate")
      if [[ "$routing_digest" =~ ^[a-f0-9]{64}$ ]]; then
        sed "s@/var/lib/aurora-routing/active-domain-routing.conf@$routing_candidate@" /etc/nginx/nginx.conf > "$routing_test"
        if timeout 15s /opt/nginx/usr/sbin/nginx -t -c "$routing_test" > "$routing_dir/routing-validation.log" 2>&1; then
          if ! cp "$routing_active" "$routing_previous" || ! mv "$routing_candidate" "$routing_active"; then
            printf '[Routing] failed to stage candidate; retrying\n' >&2
            sleep 2
            continue
          fi
          if ! sync -f "$routing_active"; then
            mv "$routing_previous" "$routing_active" || true
            printf '[Routing] durability check failed; restored previous configuration\n' >&2
            sleep 2
            continue
          fi
          routing_observed=false
          if /opt/nginx/usr/sbin/nginx -s reload; then
            for routing_attempt in $(seq 1 40); do
              if [ "$(curl --silent --max-time 1 http://127.0.0.1:9082/routing-digest)" = "$routing_digest" ]; then
                routing_observed=true
                break
              fi
              sleep 0.25
            done
          fi
          if [ "$routing_observed" = true ]; then
            printf '[Routing] observed %s\n' "$routing_digest"
            # Keep current and rollback generation credentials; older generations are no longer used.
            for routing_old_pem in "$routing_dir"/certificates/*.pem; do
              [ -f "$routing_old_pem" ] || continue
              if ! grep -Fq "$routing_old_pem" "$routing_active" "$routing_previous"; then
                rm -f "$routing_old_pem"
              fi
            done
          else
            mv "$routing_previous" "$routing_active"
            /opt/nginx/usr/sbin/nginx -s reload || true
            printf '[Routing] failed to observe candidate; restored previous configuration\n' >&2
          fi
        else
          printf '[Routing] candidate validation failed; keeping previous configuration\n' >&2
        fi
      fi
    fi
  fi
  sleep 2
done
