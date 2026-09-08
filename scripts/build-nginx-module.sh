#!/usr/bin/env bash
# Owner: NGINX module build. Supports multiple NGINX versions via nginx-versions.txt.
# Usage:
#   ./build-nginx-module.sh              # Build for all supported versions
#   ./build-nginx-module.sh 1.30.4       # Build for a specific version
#   NGINX_VERSION=1.30.4 ./build-nginx-module.sh  # Same, via env var
set -euo pipefail
aurora_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
aurora_source="$aurora_root/build/nginx-source"
aurora_versions="$aurora_root/scripts/nginx-versions.txt"
mkdir -p "$aurora_source" "$aurora_root/build/modules"

# Build Rust FFI library once (shared across all NGINX versions).
cd "$aurora_root"
cargo build --locked --release -p aurora-ffi

# Resolve PCRE2 headers if not in system include path.
aurora_cc_flags=""
aurora_ld_flags=""
if [[ ! -f /usr/include/pcre2.h ]]; then
    mkdir -p "$aurora_root/build/nginx-deps/root"
    cd "$aurora_root/build/nginx-deps"
    if [[ ! -f root/usr/include/pcre2.h ]]; then
        apt-get download libpcre2-dev
        dpkg-deb --extract libpcre2-dev_*.deb root
    fi
    aurora_cc_flags="-I$aurora_root/build/nginx-deps/root/usr/include"
    aurora_ld_flags="-L$aurora_root/build/nginx-deps/root/usr/lib/x86_64-linux-gnu"
    cd "$aurora_root"
fi

build_module_for_version() {
    local ver="$1"
    local sha="$2"
    local archive="$aurora_source/nginx-${ver}.tar.gz"

    echo "==> Building module for NGINX ${ver}..."

    if [[ ! -f "$archive" ]]; then
        curl --fail --location --silent --show-error \
            "https://nginx.org/download/nginx-${ver}.tar.gz" -o "$archive"
    fi

    printf '%s  %s\n' "$sha" "$archive" | sha256sum --check

    if [[ ! -f "$aurora_source/nginx-${ver}/configure" ]]; then
        tar -xzf "$archive" -C "$aurora_source"
    fi

    cd "$aurora_source/nginx-${ver}"
    ./configure --with-compat --with-http_stub_status_module --without-http_gzip_module \
        --with-cc-opt="$aurora_cc_flags" --with-ld-opt="$aurora_ld_flags" \
        --add-dynamic-module="$aurora_root/adapters/nginx" \
        > "$aurora_source/configure-${ver}.log" 2>&1 || {
        tail -60 "$aurora_source/configure-${ver}.log"
        echo "FATAL: configure failed for NGINX ${ver}" >&2
        return 1
    }
    make modules

    # Output: version-tagged .so file. Do not truncate inodes mapped by running workers.
    local out="$aurora_root/build/modules/ngx_http_aurora_waf_module-${ver}.so"
    local tmp
    tmp=$(mktemp "$aurora_root/build/modules/.aurora-module-XXXXXX")
    install -m 755 objs/ngx_http_aurora_waf_module.so "$tmp"
    mv -f "$tmp" "$out"
    printf 'Built %s\n' "$out"
}

# Determine which versions to build.
requested_version="${1:-${NGINX_VERSION:-}}"

if [ -n "$requested_version" ]; then
    # Build for a single requested version.
    sha=$(grep "^${requested_version} " "$aurora_versions" | awk '{print $2}')
    if [ -z "$sha" ]; then
        echo "Error: NGINX ${requested_version} not found in $(basename "$aurora_versions")." >&2
        echo "Supported versions:" >&2
        awk '{print "  " $1}' "$aurora_versions" >&2
        exit 1
    fi
    build_module_for_version "$requested_version" "$sha"

    # Symlink the default module name for backward compatibility.
    ln -sf "ngx_http_aurora_waf_module-${requested_version}.so" \
        "$aurora_root/build/modules/ngx_http_aurora_waf_module.so"
else
    # Build for all supported versions.
    while IFS=' ' read -r ver sha; do
        [[ "$ver" =~ ^#.*$ || -z "$ver" ]] && continue
        build_module_for_version "$ver" "$sha"
    done < "$aurora_versions"

    # Symlink the latest version as the default.
    latest=$(tail -1 "$aurora_versions" | awk '{print $1}')
    ln -sf "ngx_http_aurora_waf_module-${latest}.so" \
        "$aurora_root/build/modules/ngx_http_aurora_waf_module.so"
fi

echo "==> All module builds complete."
ls -lh "$aurora_root/build/modules/"*.so
