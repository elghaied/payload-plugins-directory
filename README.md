# Payload CMS Plugin Directory

## Overview

A community-driven discovery platform for Payload CMS plugins, allowing developers to explore, filter, and find plugins for their Payload projects.

## Features

- 🔍 Searchable plugin directory
- 🔢 Version filtering (v1, v2, v3)
- 📊 Sorting options (stars, forks, recently updated)
- 🏷️ Topic and collection tagging
- 🌐 Direct links to GitHub repositories

## Technology Stack

- Next.js 15.0.3
- React 19 RC
- TypeScript
- Tailwind CSS
- Shadcn/UI Components
- GitHub API

## Project Structure

```markdown
└── 📁src
    └── 📁app
        └── 📁fonts
            └── GeistMonoVF.woff
            └── GeistVF.woff
        └── favicon.ico
        └── globals.css
        └── layout.tsx
        └── page.tsx
    └── 📁components
        └── 📁PluginDirectory
            └── index.tsx            // Client Component for cards and filters 
        └── 📁ui                    // shadcn components
            └── alert.tsx
            └── badge.tsx
            └── button.tsx
            └── card.tsx
            └── dropdown-menu.tsx
            └── hover-card.tsx
            └── input.tsx
            └── select.tsx
        └── mode-toggler.tsx
        └── PayloadIcon.tsx
        └── theme-provider.tsx
    └── 📁lib
        └── getPlugins.ts           // API and Logic with cache and revalidation each day 
        └── utils.ts
    └── types.ts
```

## Key Functionality

### Plugin Fetching

- Retrieves plugins with `payload-plugin` GitHub topic
- Extracts package information from `package.json`
- Supports monorepo and single-package plugin structures

### Filtering & Sorting

- Search across name, description, topics, and owner
- Filter by Payload version
- Sort by stars, forks, or recent updates

## Installation

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Run development server: `pnpm run dev`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request
