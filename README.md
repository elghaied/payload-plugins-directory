# Payload CMS Plugin Directory

A community-driven discovery platform for [Payload CMS](https://payloadcms.com) plugins. Browse, search, filter, compare, and find the right plugins for your Payload projects — all in one place.

**Live site:** [payloadplugins.directory](https://payloadplugins.directory) (replace with your actual URL)

---

## How It Works

The directory automatically discovers plugins from GitHub. **No manual submission is needed.**

1. **Discovery** — A script searches GitHub for repositories tagged with the `payload-plugin` topic, plus official plugins from the `payloadcms/payload` monorepo
2. **Data Collection** — For each plugin, metadata is pulled: description, stars, forks, Payload version compatibility, npm downloads, license, health score, and more
3. **Automatic Updates** — A GitHub Actions workflow runs twice daily (6 AM and 6 PM UTC), refreshes the data, and auto-commits any changes
4. **Static Serving** — Plugin data is stored in a static JSON file (`data/plugins.json`), so the site loads fast with no runtime API calls

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

Community members can report plugins directly from the plugin card or detail page. A blocklist system (`data/blocklist.json`) allows admins to hide inappropriate or broken plugins.

---

## Get Your Plugin Listed

Getting listed is automatic. Just follow these two steps:

1. **Add the `payload-plugin` topic** to your GitHub repository (Settings → Topics)
2. **Wait up to 24 hours** — the directory refreshes twice daily and will pick up your plugin automatically

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
│   └── fetch-plugins.yml        # Twice-daily cron job to refresh plugin data
├── data/
│   ├── plugins.json             # Static plugin data (auto-updated by CI)
│   └── blocklist.json           # Plugin IDs to exclude from the directory
├── scripts/
│   └── fetch-plugins.ts         # Fetches plugins from GitHub API + npm
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
│   │   ├── getPlugins.ts        # Reads plugins.json, exports getPlugins(), stats helpers
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
| `pnpm fetch-plugins` | Manually refresh plugin data from the GitHub API |

### Refreshing Plugin Data Locally

To fetch fresh plugin data on your machine:

1. Set a GitHub token as an environment variable:
   ```bash
   export GITHUB_TOKEN=your_github_token
   # or
   export FINE_GRAINED_PERSONAL_ACCESS_TOKEN=your_token
   ```
2. Run the fetch script:
   ```bash
   pnpm fetch-plugins
   ```

This updates `data/plugins.json` with the latest data from GitHub and npm. In production, this happens automatically via the GitHub Actions workflow.

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

The `scripts/fetch-plugins.ts` script handles all data collection:

1. **GitHub Search** — Queries the GitHub API for repos with the `payload-plugin` topic (paginated, up to 1000 results)
2. **Official Plugins** — Separately fetches plugins from the `payloadcms/payload` monorepo (`packages/plugin-*`)
3. **Package.json Parsing** — For each repo, fetches `package.json` to detect the Payload version dependency and npm package name
4. **npm Stats** — Fetches weekly/monthly downloads, latest version, unpacked size, and dependency count from the npm registry
5. **Health Score** — Calculates a composite score (0–100) based on GitHub activity recency, stars, npm downloads, publish recency, dependency count, and package size
6. **README** — Fetches and truncates each plugin's README for the preview on detail pages
7. **Rate Limit Handling** — Retries up to 3 times with exponential backoff; pauses when hitting GitHub API rate limits

The output is written to `data/plugins.json` and committed by CI.

---

## License

This project is open source. See the repository for license details.
