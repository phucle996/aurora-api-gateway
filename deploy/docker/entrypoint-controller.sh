#!/usr/bin/env bash
set -e

mkdir -p /data
if [ ! -f /data/admin.token ]; then
  if [ -n "$AURORA_ADMIN_TOKEN" ]; then
    echo -n "$AURORA_ADMIN_TOKEN" > /data/admin.token
  elif [ "$AURORA_ENV" = "production" ]; then
    echo "FATAL: In production environment (AURORA_ENV=production), AURORA_ADMIN_TOKEN must be explicitly provided!" >&2
    exit 1
  else
    echo -n "${AURORA_DEFAULT_ADMIN_TOKEN:-71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994}" > /data/admin.token
  fi
  chmod 600 /data/admin.token
fi

exec /app/aurora-controller
