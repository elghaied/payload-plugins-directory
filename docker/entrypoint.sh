#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    exec node /app/server.js
    ;;
  *)
    exec "$@"
    ;;
esac
