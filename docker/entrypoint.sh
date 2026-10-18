#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    exec node /app/server.js
    ;;
  refresh)
    # Stopgap data refresh: GitHub/npm -> data/plugins.json -> Postgres. Needs GITHUB_TOKEN.
    if [ -z "${GITHUB_TOKEN:-}" ]; then
      echo "refresh: GITHUB_TOKEN is not set; refusing to run (would seed stale data)" >&2
      exit 1
    fi
    cd /app/cli
    started=$(date +%s)
    npx tsx scripts/fetch-plugins.ts
    # Abort unless the fetch really rewrote data/plugins.json after we started.
    node -e '
      const t = Date.parse(JSON.parse(require("fs").readFileSync("data/plugins.json", "utf8")).lastUpdated);
      if (!(t >= Number(process.argv[1]) * 1000)) { console.error("refresh: data/plugins.json was not updated by the fetch; aborting before seed"); process.exit(1); }
    ' "$started"
    npx payload seed
    ;;
  *)
    exec "$@"
    ;;
esac
