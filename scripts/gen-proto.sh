#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROTO_DIR="${ROOT_DIR}/proto"
OUT_DIR="${ROOT_DIR}/control-plane/internal/transport/grpc/pb"

mkdir -p "${OUT_DIR}"

export PATH="${HOME}/.local/bin:${HOME}/go/bin:${PATH}"

protoc \
  --proto_path="${PROTO_DIR}" \
  --go_out="${ROOT_DIR}/control-plane" \
  --go_opt=module=aurora-waf.local/control-plane \
  --go-grpc_out="${ROOT_DIR}/control-plane" \
  --go-grpc_opt=module=aurora-waf.local/control-plane \
  "${PROTO_DIR}/sync/v1"/*.proto

echo "Generated protobuf code for Go in ${OUT_DIR}"
echo "Rust Agent will automatically compile protobuf via build.rs upon cargo build."
