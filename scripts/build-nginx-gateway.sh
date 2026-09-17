#!/usr/bin/env bash
# Build static aurora-gateway binary (NGINX 1.30.4 + in-tree static C adapter + Rust FFI Engine).
# Usage:
#   ./scripts/build-nginx-gateway.sh
#   NGINX_VERSION=1.30.4 ./scripts/build-nginx-gateway.sh
set -euo pipefail

aurora_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
aurora_source="$aurora_root/build/nginx-source"
aurora_versions="$aurora_root/scripts/nginx-versions.txt"
aurora_bin="$aurora_root/build/bin"
mkdir -p "$aurora_source" "$aurora_bin"

echo "==> Building Rust FFI engine (libaurora_ffi.a)..."
cd "$aurora_root"
cargo build --locked --release -p aurora-ffi

# Resolve dependencies (PCRE2 and OpenSSL headers)
aurora_cc_flags=""
aurora_ld_flags=""

need_pcre=0
need_ssl=0
need_zlib=0
[[ ! -f /usr/include/pcre2.h ]] && need_pcre=1
[[ ! -f /usr/include/openssl/ssl.h ]] && need_ssl=1
[[ ! -f /usr/include/zlib.h ]] && need_zlib=1

if [[ $need_pcre -eq 1 || $need_ssl -eq 1 || $need_zlib -eq 1 ]]; then
    mkdir -p "$aurora_root/build/nginx-deps/root"
    cd "$aurora_root/build/nginx-deps"
    if [[ $need_pcre -eq 1 && ! -f root/usr/include/pcre2.h ]]; then
        echo "==> Downloading libpcre2-dev headers..."
        apt-get download libpcre2-dev 2>/dev/null || true
        for deb in libpcre2-dev_*.deb; do
            [[ -f "$deb" ]] && dpkg-deb --extract "$deb" root
        done
    fi
    if [[ $need_ssl -eq 1 && ! -f root/usr/include/openssl/ssl.h ]]; then
        echo "==> Downloading libssl-dev headers..."
        apt-get download libssl-dev 2>/dev/null || true
        for deb in libssl-dev_*.deb; do
            [[ -f "$deb" ]] && dpkg-deb --extract "$deb" root
        done
    fi
    if [[ $need_zlib -eq 1 && ! -f root/usr/include/zlib.h ]]; then
        echo "==> Downloading zlib1g-dev headers..."
        apt-get download zlib1g-dev 2>/dev/null || true
        for deb in zlib1g-dev_*.deb; do
            [[ -f "$deb" ]] && dpkg-deb --extract "$deb" root
        done
    fi

    # Fix symlinks to point to host system libraries and avoid linking against static archives with extra unneeded deps
    rm -f root/usr/lib/x86_64-linux-gnu/*.a 2>/dev/null || true
    for pcre_so in /usr/lib/x86_64-linux-gnu/libpcre2-8.so* /lib/x86_64-linux-gnu/libpcre2-8.so*; do
        if [[ -f "$pcre_so" ]]; then
            ln -sf "$pcre_so" root/usr/lib/x86_64-linux-gnu/libpcre2-8.so
            break
        fi
    done
    for ssl_so in /usr/lib/x86_64-linux-gnu/libssl.so* /lib/x86_64-linux-gnu/libssl.so*; do
        if [[ -f "$ssl_so" ]]; then
            ln -sf "$ssl_so" root/usr/lib/x86_64-linux-gnu/libssl.so
            break
        fi
    done
    for crypto_so in /usr/lib/x86_64-linux-gnu/libcrypto.so* /lib/x86_64-linux-gnu/libcrypto.so*; do
        if [[ -f "$crypto_so" ]]; then
            ln -sf "$crypto_so" root/usr/lib/x86_64-linux-gnu/libcrypto.so
            break
        fi
    done
    for z_so in /usr/lib/x86_64-linux-gnu/libz.so* /lib/x86_64-linux-gnu/libz.so*; do
        if [[ -f "$z_so" ]]; then
            ln -sf "$z_so" root/usr/lib/x86_64-linux-gnu/libz.so
            break
        fi
    done

    aurora_cc_flags="-I$aurora_root/build/nginx-deps/root/usr/include -I$aurora_root/build/nginx-deps/root/usr/include/x86_64-linux-gnu"
    aurora_ld_flags="-L$aurora_root/build/nginx-deps/root/usr/lib/x86_64-linux-gnu"
    cd "$aurora_root"
fi

ver="${NGINX_VERSION:-1.30.4}"
sha=$(awk -v v="$ver" '$1 == v { print $2 }' "$aurora_versions" || true)
if [[ -z "$sha" ]]; then
    # Fallback to known SHA if not found in versions file
    sha="6f4c399a9cfd86bf414c4c23dbd4434224c7f09f057a62b808933b9ccde08465"
fi

archive="$aurora_source/nginx-${ver}.tar.gz"
if [[ ! -f "$archive" ]]; then
    echo "==> Downloading NGINX ${ver}..."
    curl --fail --location --silent --show-error \
        "https://nginx.org/download/nginx-${ver}.tar.gz" -o "$archive"
fi

if [[ -n "$sha" ]]; then
    printf '%s  %s\n' "$sha" "$archive" | sha256sum --check
fi

if [[ ! -f "$aurora_source/nginx-${ver}/configure" ]]; then
    echo "==> Extracting NGINX ${ver}..."
    tar -xzf "$archive" -C "$aurora_source"
fi

echo "==> Configuring and compiling static aurora-gateway (NGINX ${ver} + in-tree module)..."
cd "$aurora_source/nginx-${ver}"

./configure \
    --prefix=/etc/nginx \
    --sbin-path=/usr/local/bin/aurora-gateway \
    --conf-path=/etc/nginx/nginx.conf \
    --pid-path=/run/aurora/nginx.pid \
    --lock-path=/run/aurora/nginx.lock \
    --http-log-path=/var/log/nginx/access.log \
    --error-log-path=/var/log/nginx/error.log \
    --http-client-body-temp-path=/var/lib/aurora/client_temp \
    --http-proxy-temp-path=/var/lib/aurora/proxy_temp \
    --http-fastcgi-temp-path=/var/lib/aurora/fastcgi_temp \
    --http-uwsgi-temp-path=/var/lib/aurora/uwsgi_temp \
    --http-scgi-temp-path=/var/lib/aurora/scgi_temp \
    --with-compat \
    --with-http_ssl_module \
    --with-http_v2_module \
    --with-http_realip_module \
    --with-http_stub_status_module \
    --with-stream \
    --with-stream_ssl_module \
    --with-stream_realip_module \
    --with-cc-opt="$aurora_cc_flags" \
    --with-ld-opt="$aurora_ld_flags" \
    --add-module="$aurora_root/adapters/nginx" \
    > "$aurora_source/configure-${ver}.log" 2>&1 || {
    tail -60 "$aurora_source/configure-${ver}.log"
    echo "FATAL: configure failed for NGINX ${ver}" >&2
    exit 1
}

make -j"$(nproc)" > "$aurora_source/build-${ver}.log" 2>&1 || {
    tail -60 "$aurora_source/build-${ver}.log"
    echo "FATAL: build failed for NGINX ${ver}" >&2
    exit 1
}

cp -f objs/nginx "$aurora_bin/aurora-gateway"
chmod 755 "$aurora_bin/aurora-gateway"

# Also maintain compat path build/nginx-runtime/usr/sbin/nginx if needed by test fixtures
mkdir -p "$aurora_root/build/nginx-runtime/usr/sbin"
cp -f objs/nginx "$aurora_root/build/nginx-runtime/usr/sbin/nginx"

echo "==> Successfully built static aurora-gateway:"
"$aurora_bin/aurora-gateway" -V
