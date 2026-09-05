#!/usr/bin/env bash
# Owner: local NGINX module build. Pinned verified source + static Rust runtime.
set -euo pipefail
aurora_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
aurora_source="$aurora_root/build/nginx-source"
aurora_archive="$aurora_source/nginx-1.30.4.tar.gz"
mkdir -p "$aurora_source" "$aurora_root/build/modules"
if [[ ! -f "$aurora_archive" ]]; then
    curl --fail --location --silent --show-error https://nginx.org/download/nginx-1.30.4.tar.gz -o "$aurora_archive"
fi
# Hash established from the upstream tarball after validating Roman Arutyunyan's signature.
printf '%s  %s\n' 4261dc90e9e47c1c4041276e9aaa3d48ebe2e664f728e14fa95ae6c67d57a08b "$aurora_archive" | sha256sum --check
if [[ ! -f "$aurora_source/nginx-1.30.4/configure" ]]; then
    tar -xzf "$aurora_archive" -C "$aurora_source"
fi
cd "$aurora_root"
cargo build --locked --release -p aurora-ffi
aurora_cc_flags=""
aurora_ld_flags=""
if [[ ! -f /usr/include/pcre2.h ]]; then
    # Ubuntu 26.04 user-local headers; apt verifies the package against its signed index.
    mkdir -p "$aurora_root/build/nginx-deps/root"
    cd "$aurora_root/build/nginx-deps"
    if [[ ! -f root/usr/include/pcre2.h ]]; then
        apt-get download libpcre2-dev=10.46-1build1
        dpkg-deb --extract libpcre2-dev_10.46-1build1_amd64.deb root
    fi
    aurora_cc_flags="-I$aurora_root/build/nginx-deps/root/usr/include"
    aurora_ld_flags="-L$aurora_root/build/nginx-deps/root/usr/lib/x86_64-linux-gnu"
fi
cd "$aurora_source/nginx-1.30.4"
./configure --with-compat --with-http_stub_status_module --without-http_gzip_module --with-cc-opt="$aurora_cc_flags" --with-ld-opt="$aurora_ld_flags" --add-dynamic-module="$aurora_root/adapters/nginx" > "$aurora_source/configure.log" 2>&1 || {
    tail -60 "$aurora_source/configure.log"
    exit 1
}
make modules
# Do not truncate an inode potentially mapped by a running NGINX worker.
aurora_module_tmp=$(mktemp "$aurora_root/build/modules/.aurora-module-XXXXXX")
install -m 755 objs/ngx_http_aurora_waf_module.so "$aurora_module_tmp"
mv -f "$aurora_module_tmp" "$aurora_root/build/modules/ngx_http_aurora_waf_module.so"
printf 'Built %s\n' "$aurora_root/build/modules/ngx_http_aurora_waf_module.so"
