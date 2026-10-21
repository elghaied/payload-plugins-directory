#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    # A fresh migrate leaves the search index empty (the taxonomy seed skips it) and a failed or crashed build leaves it
    # short: repair it in the background so a long rebuild never delays readiness. A failure is logged loudly; search
    # results are re-read through access control, so a short index only hides results until it is repaired.
    (cd /app/cli && npx payload reindex-search --if-incomplete || echo "WARNING: search reindex failed; run 'npx payload reindex-search' in /app/cli" >&2) &
    exec node /app/server.js
    ;;
  worker)
    # Sync jobs (src/cli/worker.ts): queue due schedules and run jobs every minute.
    # Migrations are run by the web container; compose starts the worker once web is healthy.
    # Run exactly ONE worker: handleSchedules is not locked across processes.
    # exec + direct bin (no npx wrapper) so SIGTERM reaches the worker, which then shuts down gracefully.
    cd /app/cli
    export DIRECTORY_ROLE=worker
    # Render README HTML for plugins whose stored render version is out of date (a no-op when current). Runs in the
    # background in isolated worker threads so it never delays the worker; failures are logged, never fatal.
    (./node_modules/.bin/payload render-readmes || echo "WARNING: render-readmes failed; run 'payload render-readmes' in /app/cli" >&2) &
    exec ./node_modules/.bin/payload worker --cron "* * * * *"
    ;;
  *)
    exec "$@"
    ;;
esac
