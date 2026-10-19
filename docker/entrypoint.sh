#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    exec node /app/server.js
    ;;
  worker)
    # Sync jobs (src/cli/worker.ts): queue due schedules and run jobs every minute.
    # Migrations are run by the web container; compose starts the worker once web is healthy.
    # Run exactly ONE worker: handleSchedules is not locked across processes.
    # exec + direct bin (no npx wrapper) so SIGTERM reaches the worker, which then shuts down gracefully.
    cd /app/cli
    export DIRECTORY_ROLE=worker
    exec ./node_modules/.bin/payload worker --cron "* * * * *"
    ;;
  *)
    exec "$@"
    ;;
esac
