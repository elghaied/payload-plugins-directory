# Payload Directory

A community-driven discovery platform for [Payload CMS](https://payloadcms.com) plugins. Browse, search, filter, compare, and find the right plugins for your Payload projects — all in one place.

**Live site:** [payloadplugins.directory](https://payloadplugins.directory) (replace with your actual URL)

---

## How It Works

The directory automatically discovers plugins from GitHub. **No manual submission is needed.**

1. **Discovery** — Every 6 hours the `worker` searches GitHub for repositories tagged with the `payload-plugin` topic, plus the official plugins in the `payloadcms/payload` monorepo, and queues one `sync-repository` job per repository
2. **Sync** — Each repository's metadata is refreshed; its `package.json`, workspaces and README are re-read only when it was pushed to since the last sync
3. **Daily jobs** — npm downloads and versions are refreshed at 01:00 UTC and trend snapshots are taken at 00:30 UTC
4. **Serving** — Data lives in Postgres (Payload CMS); cached pages are revalidated through `/api/revalidate` whenever their data changes

---

## Features

### Search and Filtering

- **Full-text search** across plugin names, descriptions, topics, authors, and package names
- **Version filter** — Show only plugins compatible with Payload v1, v2, or v3
- **Source filter** — Toggle between official plugins (from the Payload monorepo) and community-contributed plugins
- **License filter** — Filter by specific license types (MIT, ISC, etc.)
- All active filters are encoded in the URL, so you can share filtered views with others

### Sorting

Eight sort options to help you find what you need:

| Sort | Description |
|------|-------------|
| **Featured** (default) | Smart ranking that balances official and community plugins — official plugins are capped at the community top-10 median to prevent them from dominating |
| **Most Stars** | GitHub stars, descending |
| **Most Downloads** | Weekly npm downloads, descending |
| **Health Score** | Composite health metric, descending |
| **Most Forks** | GitHub forks, descending |
| **Recently Updated** | Last update date, descending |
| **Recently Created** | Creation date, descending |
| **Name (A-Z)** | Alphabetical |

### Plugin Cards

Each plugin card shows at a glance:

- Owner avatar and name
- Plugin name with link to detail page
- Official badge (if applicable)
- Health score indicator (color-coded: Excellent, Good, Fair, Poor, or Archived)
- Payload version badges (v1, v2, v3)
- npm version, package size, and license badges
- Truncated description
- **Copy install command** button (`npm i package-name`) with clipboard feedback
- Stats: stars, forks, open issues, weekly downloads, and last updated time
- Topic tags (up to 4 visible, with overflow count)
- Links to GitHub and a report button for community plugins

### Plugin Detail Pages

Every plugin has a dedicated page (`/plugins/[id]`) with:

- Full description and README preview
- Installation command
- Stats cards: stars, forks, open issues, last updated, weekly downloads, npm version, unpacked size, dependency count
- Health score visualization with label (Excellent/Good/Fair/Poor)
- Creation and update dates
- Topic tags (clickable to search)
- Direct links to GitHub and npm

### Plugin Comparison

Compare up to 3 plugins side by side:

1. Click the **Compare** button in the toolbar to enter comparison mode
2. Select plugins by clicking the checkbox on each card
3. Click **Compare** in the floating bottom bar

The comparison view shows a table with 11 metrics — stars, forks, open issues, version, license, last updated, created date, weekly downloads, npm version, package size, and health score — with the best value in each row highlighted.

### Recently Added Section

When no filters are active, the homepage shows a "Recently Added" section with the 4 newest plugins from the last 90 days, so you can keep up with the ecosystem.

### Ecosystem Stats Page (`/stats`)

A dashboard showing the health and trends of the Payload plugin ecosystem:

- **Quick stats** — Total plugins, weekly/monthly downloads, average health score, official vs. community split, plugins on npm, average stars
- **Most downloaded plugins** — Top 10 by weekly downloads
- **Version adoption** — Bar chart of v1/v2/v3 distribution
- **Health score distribution** — How many plugins fall into each health tier
- **Package size distribution** — Breakdown by size bucket
- **License breakdown** — Top 8 licenses used
- **Top contributors** — Authors with the most plugins
- **Growth chart** — New plugins created per month over the last 12 months
- **Aggregate stats** — Total stars, total forks, median stars, unique license count

### About Page (`/about`)

Explains how the directory works, how to get your plugin listed, and how to build a Payload plugin from scratch.

### RSS Feed (`/feed.xml`)

An RSS 2.0 feed of the 50 most recently created plugins. Add it to your feed reader to stay updated.

### Dark Mode

Full light/dark/system theme support via the toggle in the header. Respects your OS preference when set to "System."

### SEO and Structured Data

- Open Graph and Twitter Card meta tags on every page
- JSON-LD structured data (CollectionPage on home, SoftwareApplication on detail pages)
- Auto-generated sitemap (`/sitemap.xml`) and robots.txt
- Canonical URLs

### Performance

- **No runtime API calls** — data is pre-fetched and served from a static JSON file
- **Virtual scrolling** (via TanStack React Virtual) — renders 160+ plugin cards efficiently
- **Code splitting** — server components for static content, client components only where interactivity is needed
- **Vercel Speed Insights** — Core Web Vitals monitoring

### Accessibility

- Semantic HTML with proper heading hierarchy
- ARIA labels on interactive elements
- Screen reader support
- Keyboard navigation
- Proper alt text and role attributes

### Responsive Design

Fully responsive across devices:

- **Desktop** (1024px+) — 3-column plugin grid
- **Tablet** (640–1024px) — 2-column grid
- **Mobile** (<640px) — single-column layout with stacked filters

### Plugin Reporting and Blocklist

Community members can report plugins directly from the plugin card or detail page. Admins hide inappropriate or broken plugins by setting their Visibility to "hidden" in the admin panel.

---

## Get Your Plugin Listed

Getting listed is automatic. Just follow these two steps:

1. **Add the `payload-plugin` topic** to your GitHub repository (Settings → Topics)
2. **Wait up to 6 hours** — discovery runs every 6 hours and will pick up your plugin automatically

That's it. No forms, no PRs, no manual submissions.

For best results, make sure your repo has:
- A clear `description` on GitHub
- A `package.json` with Payload as a dependency (so version detection works)
- The package published to npm (for download stats, version, and size data)

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| [Next.js](https://nextjs.org) | 16 | React framework (App Router) |
| [React](https://react.dev) | 19 | UI library |
| [TypeScript](https://typescriptlang.org) | 5.9 | Type safety |
| [Tailwind CSS](https://tailwindcss.com) | 4 | Utility-first styling |
| [shadcn/ui](https://ui.shadcn.com) | new-york style | Component library (Radix + Tailwind) |
| [TanStack Virtual](https://tanstack.com/virtual) | 3 | Virtual scrolling |
| [next-themes](https://github.com/pacocoursey/next-themes) | 0.4 | Theme management |
| [Lucide React](https://lucide.dev) | 0.563 | Icons |
| [Vercel Speed Insights](https://vercel.com/docs/speed-insights) | 1.3 | Performance monitoring |

---

## Project Structure

```
├── .github/workflows/
│   ├── ci.yml                   # Typecheck, lint, tests, build on pull requests
│   └── image.yml                # Builds and pushes the Docker image
├── docker/
│   ├── compose.yml              # web + worker services (Coolify)
│   └── entrypoint.sh            # web | worker | any command
├── scripts/
│   ├── db/                      # db:pull / db:push
│   └── parity.ts                # slug/sitemap parity check
├── src/sync/                    # Sync jobs: GitHub/npm clients, discover, sync-repository, npm-stats, snapshot
├── src/
│   ├── app/
│   │   ├── about/page.tsx       # About page
│   │   ├── feed.xml/route.ts    # RSS feed endpoint
│   │   ├── plugins/[id]/page.tsx# Plugin detail pages (statically generated)
│   │   ├── stats/page.tsx       # Ecosystem stats dashboard
│   │   ├── layout.tsx           # Root layout with metadata, fonts, providers
│   │   ├── page.tsx             # Homepage (server component)
│   │   ├── robots.ts            # Robots.txt generation
│   │   ├── sitemap.xml/         # Sitemap generation
│   │   └── globals.css          # Global styles and CSS variables
│   ├── components/
│   │   ├── PluginDirectory/
│   │   │   └── index.tsx        # Main client component (search, filter, cards)
│   │   ├── ComparisonView/
│   │   │   └── index.tsx        # Side-by-side plugin comparison modal
│   │   ├── ui/                  # shadcn/ui components (badge, button, card, etc.)
│   │   ├── mode-toggler.tsx     # Light/dark/system theme toggle
│   │   ├── PayloadIcon.tsx      # Payload CMS logo
│   │   └── theme-provider.tsx   # next-themes provider wrapper
│   ├── lib/
│   │   ├── directory/           # Cached Payload queries (queries.ts), mappers, stats helpers
│   │   └── utils.ts             # cn() class merge utility
│   └── types.ts                 # Shared TypeScript interfaces
├── components.json              # shadcn/ui configuration
├── next.config.ts               # Next.js configuration
├── postcss.config.mjs           # PostCSS + Tailwind 4
├── tsconfig.json                # TypeScript configuration (@ path alias)
└── package.json
```

---

## Development

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/payload-plugins-directory.git
cd payload-plugins-directory

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

The app runs at `http://localhost:3000` by default.

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the development server |
| `pnpm build` | Create a production build |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm worker` | Run the sync worker locally (queues due schedules and runs jobs every minute) |

### Production Deployment (web + worker)

`docker/compose.yml` defines two services from the same image: `web` (site, admin, API; runs migrations) and `worker` (`payload worker --cron "* * * * *"`: queues due schedules and runs the sync jobs).

- **Run exactly ONE worker.** Payload's `handleSchedules` is not locked across processes, so a second worker would queue every scheduled job twice. Do not scale `worker` above 1.
- **Never enable `jobs.autoRun` on the web process** for the same reason; the worker is the only scheduler.
- **Before deploying this branch's replacement of the old pipeline, disable `.github/workflows/fetch-plugins.yml` on `main`.** The twice-daily Action commits `data/plugins.json`, which nothing reads any more; leaving it enabled only creates noise commits (and conflicts when `main` is merged). Import existing data once with `payload seed --file <path>` (see "One-time Import of the Legacy Data").
- The worker shuts down gracefully on SIGTERM (it finishes its current batch, up to 45s), so redeploys do not leave jobs stuck in `processing`.
- At startup both processes log warnings (never secret values) for production misconfigurations: `SERVER_URL` unset or not `https://payloaddirectory.dev` (the site is served with `noindex`), `REVALIDATE_SECRET` unset or shorter than 32 characters, and, for the worker, `GITHUB_TOKEN` or `INTERNAL_WEB_URL` unset (plus `ANTHROPIC_API_KEY` unset, which skips AI enrichment). The web process also warns when `SESSION_SECRET` is unset or shorter than 32 characters (maintainer sign-in fails closed) and when `GITHUB_OAUTH_CLIENT_ID` or `GITHUB_OAUTH_CLIENT_SECRET` is unset (GitHub sign-in is unavailable), and logs an info note when `GITHUB_WEB_TOKEN` is unset (claim ownership checks share the 60-requests-per-hour unauthenticated quota).
- `GITHUB_WEB_TOKEN` (web only, optional): a fine-grained PAT with public-repositories read-only access and no other permissions. It raises claim ownership checks from 60 to 5,000 GitHub requests per hour. The web client never falls back to the worker's `GITHUB_TOKEN`.

### Running the Sync Worker Locally

1. Put `GITHUB_TOKEN`, `REVALIDATE_SECRET` and `INTERNAL_WEB_URL=http://localhost:3000` in `.env` (see `.env.example`).
2. Start the site with `pnpm dev`, then run `pnpm worker` in a second terminal.

The worker queues the scheduled jobs (discover every 6 hours, npm stats at 01:00 UTC, snapshots at 00:30 UTC) and runs queued jobs every minute. Job health is shown on the admin dashboard.

### Taxonomy and AI Enrichment

- **Categories and tags** are curated in the admin (Taxonomy group). The starter tree, alias tags and the admin
  presets are created once by the `20261019_050500_seed_taxonomy` migration. Afterwards `pnpm payload seed-taxonomy`
  only adds missing starter items, applies alias tags to all plugins and lists common GitHub topics no alias covers.
- **Enrichment** runs in the worker:
  - `enrich-all` runs hourly (at minute 20). It finds plugins whose content, category tree, admin instructions or model
    changed. Below 20 stale plugins it queues direct `enrich` jobs (the `enrich` queue runs 2 at a time); at 20 or more
    it submits one Message Batch (50% cost). One pass takes at most 500 plugins (`ENRICH_MAX_PER_PASS` overrides); the
    rest follow on the next pass. While a batch is in flight, `enrich-all` skips entirely and submits nothing.
  - The 30-minute debounce: `enrich-all` waits until 30 minutes after the last edit, so a burst of edits costs one
    re-pass. The clock restarts on any save of the Directory settings (any field, not only AI), and on every category
    create, edit or delete. Tag edits do not restart it (tags are not part of the prompt fingerprint).
  - `sync-repository` re-enriches previously enriched plugins whose README/package.json/description changed.
- **Model and settings:** Directory settings (System group) → AI. `enabled` is the kill switch; `model` (default
  `claude-sonnet-5-5`), `instructions` (appended to the cached system prompt) and `maxNewTagsPerPlugin` (default 2, max 5)
  tune it.
- **Locks:** when an admin edits an AI field (category, tags, tagline, summary, features, use cases) on a plugin, that
  field is locked and enrichment never overwrites it. Untick the lock to hand it back.
- **Admin views:** the "AI enrichment" dashboard widget, and the plugin list presets "Low confidence", "Uncategorized"
  and "Enrichment failed".
- **Key:** `ANTHROPIC_API_KEY` is set on the worker only. Without it, enrichment is skipped and plugins keep their author
  description.
- **Local workers never spend money by default:** the real client is only created when `NODE_ENV=production` (the
  production worker must run with it) or `ENRICH_ALLOW_LOCAL=1`. A local `pnpm worker` loads the real key from `.env`
  and, after `db:pull`, inherits production's pending jobs; without the opt-in it logs once that enrichment is off and
  skips every request. Tests never call the API: they use `tests/helpers/fakeEnrichClient.ts`, and `vitest.setup.ts` removes the
  key and stubs `fetch`.
- **Manual commands:**
  - `pnpm payload enrich --mode preview --limit 5` (also `pnpm enrich:preview`) sizes the requests and estimates token use
    and cost. It makes no API call and writes nothing. `--slugs a,b` picks plugins; `--limit` defaults to 5 (max 50) and
    is ignored when `--slugs` is given.
  - `pnpm payload enrich --mode queue --slugs a,b` queues `enrich` jobs for those plugins.
  - `pnpm payload enrich --mode all` queues `enrich-all` now, ignoring the edit debounce. It does nothing when an
    `enrich-all` job is already pending.

### One-time Import of the Legacy Data

The JSON files the old GitHub Action produced are no longer in the repository. To import them once (slugs preserved, blocklisted plugins hidden), recover them from git history and pass their paths:

```bash
rev=$(git log -1 --format=%h --diff-filter=D -- data/blocklist.json)
git show "$rev^:data/plugins.json" > /tmp/plugins.json
git show "$rev^:data/blocklist.json" > /tmp/blocklist.json
pnpm payload seed --file /tmp/plugins.json --blocklist /tmp/blocklist.json
```

The seed queues a discover run, so the worker then refreshes every imported repository. In a container, copy the files in with `docker cp` and run `npx payload seed --file <path>` from `/app/cli`.

### Database Copies (`db:pull` / `db:push`)

`pnpm db:pull` replaces the local database with a copy of production. `pnpm db:push` does the reverse after a typed `production` confirmation and a fresh backup of the target: it requires `DB_REMOTE_PRODUCTION_CONTAINER`, `DB_REMOTE_PRODUCTION_WEB_CONTAINER` and `DB_REMOTE_PRODUCTION_WORKER_CONTAINER`, always stops the worker during the restore, migrates, and revalidates every page through `/api/revalidate` (falling back to clearing the Next data cache and restarting web if that call fails). Run both from the main checkout, not from a worktree: the local dump runs in the `docker-compose.dev.yml` compose project of the current directory.

### Path Aliases

`@/*` maps to `./src/*` — so `import { cn } from "@/lib/utils"` resolves to `src/lib/utils.ts`.

---

## Contributing

Contributions are welcome! Here's how to help:

1. **Fork** the repository
2. **Create a branch** for your feature or fix (`git checkout -b my-feature`)
3. **Make your changes** and test locally
4. **Submit a pull request** with a clear description of what you changed and why

### Ideas for Contributions

- Improve the health score algorithm
- Add new filtering or sorting options
- Enhance the stats page with new visualizations
- Improve mobile UX
- Add internationalization

---

## How Plugin Data Is Collected

The `worker` process (`payload worker --cron "* * * * *"`) runs these jobs, defined in `src/sync/`:

1. **discover** (every 6 hours) — Searches GitHub for repos with the `payload-plugin` topic (including archived ones) and fetches the official plugins from the `payloadcms/payload` monorepo (`packages/plugin-*`); queues a `sync-repository` job per repository and moves plugins to Trash when their repository stays missing across runs
2. **sync-repository** — Refreshes repository metadata; when the repo was pushed to since the last sync, re-reads `package.json` (single package or monorepo workspaces), detects the Payload version and npm package name, and stores the full README. Rate limits re-queue the job; invalid inputs fail without retrying
3. **npm-stats** (daily, 01:00 UTC) — Fetches weekly/monthly downloads, latest version, unpacked size and dependency count from the npm registry, and recomputes the health score (0–100) from GitHub activity, stars, downloads, publish recency, dependency count and package size
4. **snapshot** (daily, 00:30 UTC) — Records daily trend snapshots
5. **revalidate** — Asks the web process (`/api/revalidate`, constant-time secret check) to refresh cached pages after data changes

Nothing is fetched at request time. The legacy `data/plugins.json` is only used for the one-time `payload seed --file` import described above.

## Operations: edge rules and deploy checklist

The first-deploy checklist (Coolify resources, environment variables, first admin, legacy data load, Cloudflare DNS/TLS/HSTS,
cache and rate-limit rules per Cloudflare plan, and the post-deploy smoke test) is one numbered list at the top of
[`docker/compose.yml`](docker/compose.yml). Merging to `main` publishes `:latest` and deploys. Agents can connect
to the public MCP endpoint described on `/about#mcp`.

Templates run on their own queue jobs: `discover-templates` finds candidate repositories and the official `templates/*`
folders, `sync-template` refreshes one template from GitHub, and `enrich-template` writes its AI summary and category.
When the directory has no templates yet, the worker queues `discover-templates` on boot instead of waiting for the schedule.
The hourly `enrich-all` job queues stale templates after its plugin pass. Hidden or trashed templates are excluded
from the sitemap, search, MCP and `/badge/templates/<slug>.svg`.

---

## License

This project is open source. See the repository for license details.
