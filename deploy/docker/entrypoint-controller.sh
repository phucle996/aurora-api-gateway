#!/usr/bin/env bash
set -e

mkdir -p /data
if [ ! -f /data/admin.token ]; then
  echo -n "${AURORA_DEFAULT_ADMIN_TOKEN:-71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994}" > /data/admin.token
  chmod 600 /data/admin.token
fi

exec /app/aurora-controller
