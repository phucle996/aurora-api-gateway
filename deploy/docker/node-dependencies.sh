#!/usr/bin/env bash
# Backward-compatibility wrapper delegating to node-modules.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/node-modules.sh" ]; then
  exec "${SCRIPT_DIR}/node-modules.sh" "$@"
elif [ -f "/node-modules.sh" ]; then
  exec /node-modules.sh "$@"
else
  exec bash "${BASH_SOURCE[0]%/*}/node-modules.sh" "$@"
fi
