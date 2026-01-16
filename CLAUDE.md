# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev      # Start development server
pnpm build    # Production build
pnpm start    # Start production server
pnpm lint     # Run ESLint
```

## Architecture

This is a Next.js 16 app (App Router) that displays a directory of Payload CMS plugins fetched from GitHub.

### Data Flow

1. **Server-side**: `src/app/page.tsx` calls `fetchPlugins()` to get plugin data
2. **Client-side**: `PluginDirectory` component handles filtering, sorting, and display

### Key Files

- `src/lib/getPlugins.ts` - GitHub API integration with 6-hour cache. Searches for repos with `payload-plugin` topic, extracts Payload version from package.json (supports both single-package and monorepo structures)
- `src/types.ts` - TypeScript interfaces for Plugin, GitHubRepo, PackageJson
- `src/components/PluginDirectory/index.tsx` - Client component with search, version filtering (v1/v2/v3), and sorting (stars/forks/recent)

### UI Components

Uses shadcn/ui (new-york style) with Radix primitives. Components are in `src/components/ui/`. The `cn()` utility in `src/lib/utils.ts` merges Tailwind classes.

### Path Aliases

`@/*` maps to `./src/*`
