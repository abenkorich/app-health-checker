#!/bin/sh
set -e

mkdir -p /usr/src/app/.status

if [ "$(id -u)" = "0" ]; then
  chown -R nextjs:nodejs /usr/src/app/.status
  exec su-exec nextjs:nodejs "$@"
fi

exec "$@"
