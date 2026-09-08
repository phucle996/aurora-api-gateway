#!/usr/bin/env bash
set -euo pipefail
aurora_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd "$aurora_root"
if [ ! -d build/ngx-brotli-source/.git ]; then
  git clone https://github.com/google/ngx_brotli.git build/ngx-brotli-source
fi
git -C build/ngx-brotli-source checkout --detach a71f9312c2deb28875acc7bacfdd5695a111aa53
git -C build/ngx-brotli-source submodule update --init --recursive
# NGINX source is independently checked in the Dockerfile against its pinned hash.
mkdir -p build/nginx-source
if [ ! -f build/nginx-source/nginx-1.30.4.tar.gz ]; then
  curl --fail --location https://nginx.org/download/nginx-1.30.4.tar.gz -o build/nginx-source/nginx-1.30.4.tar.gz
fi
docker build -f deploy/docker/Dockerfile.brotli --output type=local,dest=build/brotli-package .
