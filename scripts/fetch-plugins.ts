/**
 * Plugin Fetcher Script
 *
 * This script fetches all Payload CMS plugins from GitHub with proper pagination,
 * authentication, and rate limit handling. It saves the results to a static JSON file.
 *
 * Run with: npx tsx scripts/fetch-plugins.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.FINE_GRAINED_PERSONAL_ACCESS_TOKEN;
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'plugins.json');

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  pushed_at: string;
  created_at: string;
  html_url: string;
  topics: string[];
  owner: {
    login: string;
    avatar_url: string;
  };
  default_branch: string;
  license: {
    spdx_id: string;
    name: string;
  } | null;
  open_issues_count: number;
  archived: boolean;
}

interface PackageJson {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Plugin {
  id: string;
  name: string;
  packageName?: string;
  collection?: string;
  description: string;
  stars: number;
  forks: number;
  lastUpdate: string;
  createdAt: string;
  owner: string;
  ownerAvatar: string;
  url: string;
  topics: string[];
  isOfficial: boolean;
  payloadVersion: string | null;
  payloadVersionMajor: number[];
  license: string | null;
  openIssues: number;
  isArchived: boolean;
  readme?: string;
}

interface PluginsData {
  lastUpdated: string;
  totalCount: number;
  plugins: Plugin[];
}

const headers: HeadersInit = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

if (GITHUB_TOKEN) {
  headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  console.log('Using authenticated GitHub API requests');
} else {
  console.warn('No GITHUB_TOKEN found - using unauthenticated requests (lower rate limits)');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, { headers });

    if (response.ok) {
      return response;
    }

    // Check rate limit
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetTime = response.headers.get('x-ratelimit-reset');

    if (response.status === 403 && remaining === '0' && resetTime) {
      const waitTime = (parseInt(resetTime) * 1000) - Date.now() + 1000;
      console.log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s until reset...`);
      await sleep(Math.max(waitTime, 0));
      continue;
    }

    if (response.status === 404) {
      return response; // Don't retry 404s
    }

    console.warn(`Request failed (${response.status}), retrying in ${(i + 1) * 2}s...`);
    await sleep((i + 1) * 2000);
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

async function searchRepositories(): Promise<GitHubRepo[]> {
  const allRepos: GitHubRepo[] = [];
  const perPage = 100;
  let page = 1;
  let totalCount = 0;

  console.log('Searching for repositories with payload-plugin topic...');

  // GitHub Search API returns max 1000 results, so we paginate
  while (true) {
    const url = `https://api.github.com/search/repositories?q=topic:payload-plugin+fork:true&sort=updated&order=desc&per_page=${perPage}&page=${page}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    if (page === 1) {
      totalCount = data.total_count;
      console.log(`Found ${totalCount} repositories total`);
    }

    if (!data.items || data.items.length === 0) {
      break;
    }

    // Filter out archived repos
    const activeRepos = data.items.filter((repo: GitHubRepo) => !repo.archived);
    allRepos.push(...activeRepos);

    console.log(`Fetched page ${page} (${allRepos.length}/${Math.min(totalCount, 1000)} repos)`);

    // GitHub only returns up to 1000 results
    if (allRepos.length >= 1000 || data.items.length < perPage) {
      break;
    }

    page++;
    await sleep(100); // Small delay between requests
  }

  return allRepos;
}

function extractMajorVersions(version: string): number[] {
  if (version.toLowerCase().includes('beta')) {
    return [3];
  }

  const versionRanges = version.split('||').map(v => v.trim());
  const majorVersions = new Set<number>();

  versionRanges.forEach(range => {
    const cleanVersion = range.replace(/[\^~>=<]/g, '').trim();

    // Match beta versions
    const betaMatch = cleanVersion.match(/^(\d+)\.0\.0(?:-beta|$)/);
    if (betaMatch) {
      majorVersions.add(parseInt(betaMatch[1]));
      return;
    }

    // Match regular versions
    const match = cleanVersion.match(/^(\d+)/);
    if (match) {
      majorVersions.add(parseInt(match[1]));
    }
  });

  return Array.from(majorVersions).sort((a, b) => a - b);
}

function getPayloadVersion(packageJson: PackageJson): string | null {
  return (
    packageJson.peerDependencies?.payload ||
    packageJson.dependencies?.payload ||
    packageJson.devDependencies?.payload ||
    null
  );
}

async function fetchPackageJson(repo: GitHubRepo, subPath = ''): Promise<PackageJson | null> {
  const pathPart = subPath ? `${subPath}/` : '';
  const url = `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${repo.default_branch}/${pathPart}package.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchReadmePreview(repo: GitHubRepo): Promise<string | undefined> {
  const readmeFiles = ['README.md', 'readme.md', 'Readme.md'];

  for (const filename of readmeFiles) {
    const url = `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${repo.default_branch}/${filename}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const content = await response.text();
        // Get first 500 characters, try to break at a sentence or paragraph
        let preview = content.slice(0, 500);
        const lastPeriod = preview.lastIndexOf('. ');
        const lastNewline = preview.lastIndexOf('\n\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);
        if (breakPoint > 200) {
          preview = preview.slice(0, breakPoint + 1);
        }
        return preview.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

async function fetchPackagesDirectory(repo: GitHubRepo): Promise<{ name: string; path: string; packageJson: PackageJson }[]> {
  const url = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/packages?ref=${repo.default_branch}`;

  try {
    const response = await fetchWithRetry(url);
    if (!response.ok) return [];

    const contents = await response.json();
    const packages: { name: string; path: string; packageJson: PackageJson }[] = [];

    const directories = contents.filter((item: { type: string }) => item.type === 'dir');

    // Fetch package.json for each directory in parallel (batched)
    const batchSize = 5;
    for (let i = 0; i < directories.length; i += batchSize) {
      const batch = directories.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (dir: { name: string }) => {
          const packageJson = await fetchPackageJson(repo, `packages/${dir.name}`);
          if (packageJson) {
            return { name: dir.name, path: `packages/${dir.name}`, packageJson };
          }
          return null;
        })
      );
      packages.push(...results.filter((p): p is NonNullable<typeof p> => p !== null));
    }

    return packages;
  } catch {
    return [];
  }
}

async function processRepository(repo: GitHubRepo): Promise<Plugin[]> {
  const plugins: Plugin[] = [];

  try {
    const rootPackageJson = await fetchPackageJson(repo);

    if (rootPackageJson) {
      const payloadVersion = getPayloadVersion(rootPackageJson);

      if (payloadVersion) {
        // Single package repo with detected payload version
        const readme = await fetchReadmePreview(repo);

        plugins.push({
          id: `${repo.id}-root`,
          name: repo.name.replace(/-/g, ' '),
          packageName: rootPackageJson.name,
          description: rootPackageJson.description || repo.description || 'No description available',
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          lastUpdate: repo.pushed_at,
          createdAt: repo.created_at,
          owner: repo.owner.login,
          ownerAvatar: repo.owner.avatar_url,
          url: repo.html_url,
          topics: repo.topics || [],
          isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
          payloadVersion,
          payloadVersionMajor: extractMajorVersions(payloadVersion),
          license: repo.license?.spdx_id || null,
          openIssues: repo.open_issues_count,
          isArchived: repo.archived,
          readme,
        });
      } else {
        // Check for monorepo structure
        const packagePlugins = await fetchPackagesDirectory(repo);

        if (packagePlugins.length > 0) {
          // It's a monorepo
          for (const pkg of packagePlugins) {
            const pkgPayloadVersion = getPayloadVersion(pkg.packageJson);
            plugins.push({
              id: `${repo.id}-${pkg.name}`,
              name: pkg.name.replace(/-/g, ' '),
              packageName: pkg.packageJson.name,
              collection: repo.name,
              description: pkg.packageJson.description || 'No description available',
              stars: repo.stargazers_count,
              forks: repo.forks_count,
              lastUpdate: repo.pushed_at,
              createdAt: repo.created_at,
              owner: repo.owner.login,
              ownerAvatar: repo.owner.avatar_url,
              url: `${repo.html_url}/tree/${repo.default_branch}/${pkg.path}`,
              topics: repo.topics || [],
              isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
              payloadVersion: pkgPayloadVersion,
              payloadVersionMajor: pkgPayloadVersion ? extractMajorVersions(pkgPayloadVersion) : [0],
              license: repo.license?.spdx_id || null,
              openIssues: repo.open_issues_count,
              isArchived: repo.archived,
            });
          }
        } else {
          // Single package repo without detected payload version - include as unknown
          const readme = await fetchReadmePreview(repo);

          plugins.push({
            id: `${repo.id}-root`,
            name: repo.name.replace(/-/g, ' '),
            packageName: rootPackageJson.name,
            description: rootPackageJson.description || repo.description || 'No description available',
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            lastUpdate: repo.pushed_at,
            createdAt: repo.created_at,
            owner: repo.owner.login,
            ownerAvatar: repo.owner.avatar_url,
            url: repo.html_url,
            topics: repo.topics || [],
            isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
            payloadVersion: null,
            payloadVersionMajor: [0], // 0 represents unknown version
            license: repo.license?.spdx_id || null,
            openIssues: repo.open_issues_count,
            isArchived: repo.archived,
            readme,
          });
        }
      }
    } else {
      // No package.json found - still include the plugin as unknown version
      const readme = await fetchReadmePreview(repo);

      plugins.push({
        id: `${repo.id}-root`,
        name: repo.name.replace(/-/g, ' '),
        description: repo.description || 'No description available',
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        lastUpdate: repo.pushed_at,
        createdAt: repo.created_at,
        owner: repo.owner.login,
        ownerAvatar: repo.owner.avatar_url,
        url: repo.html_url,
        topics: repo.topics || [],
        isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
        payloadVersion: null,
        payloadVersionMajor: [0], // 0 represents unknown version
        license: repo.license?.spdx_id || null,
        openIssues: repo.open_issues_count,
        isArchived: repo.archived,
        readme,
      });
    }
  } catch (error) {
    console.error(`Error processing ${repo.full_name}:`, error);
  }

  return plugins;
}

async function fetchOfficialPayloadPlugins(): Promise<Plugin[]> {
  console.log('Fetching official Payload plugins from payloadcms/payload...');
  const plugins: Plugin[] = [];

  try {
    // Fetch the main payload repo info for metadata
    const repoUrl = 'https://api.github.com/repos/payloadcms/payload';
    const repoResponse = await fetchWithRetry(repoUrl);
    const payloadRepo: GitHubRepo = await repoResponse.json();

    // Fetch packages directory
    const packagesUrl = 'https://api.github.com/repos/payloadcms/payload/contents/packages?ref=main';
    const packagesResponse = await fetchWithRetry(packagesUrl);

    if (!packagesResponse.ok) {
      console.warn('Failed to fetch packages directory from payload repo');
      return plugins;
    }

    const contents = await packagesResponse.json();

    // Filter for directories starting with 'plugin-'
    const pluginDirs = contents.filter((item: { type: string; name: string }) =>
      item.type === 'dir' && item.name.startsWith('plugin-')
    );

    console.log(`Found ${pluginDirs.length} official plugins`);

    // Fetch package.json for each plugin
    for (const dir of pluginDirs) {
      try {
        const packageJsonUrl = `https://raw.githubusercontent.com/payloadcms/payload/main/packages/${dir.name}/package.json`;
        const response = await fetch(packageJsonUrl);

        if (response.ok) {
          const packageJson: PackageJson = await response.json();
          const payloadVersion = getPayloadVersion(packageJson);

          // Create a readable name from the directory (e.g., "plugin-seo" -> "seo")
          const displayName = dir.name.replace('plugin-', '').replace(/-/g, ' ');

          plugins.push({
            id: `official-${dir.name}`,
            name: displayName,
            packageName: packageJson.name || `@payloadcms/${dir.name}`,
            collection: 'payload',
            description: packageJson.description || `Official Payload CMS ${displayName} plugin`,
            stars: payloadRepo.stargazers_count,
            forks: payloadRepo.forks_count,
            lastUpdate: payloadRepo.pushed_at,
            createdAt: payloadRepo.created_at,
            owner: 'payloadcms',
            ownerAvatar: payloadRepo.owner.avatar_url,
            url: `https://github.com/payloadcms/payload/tree/main/packages/${dir.name}`,
            topics: ['payload-plugin', 'official'],
            isOfficial: true,
            payloadVersion: payloadVersion,
            payloadVersionMajor: payloadVersion ? extractMajorVersions(payloadVersion) : [3], // Official plugins default to v3
            license: payloadRepo.license?.spdx_id || 'MIT',
            openIssues: 0, // Individual plugins don't have separate issue counts
            isArchived: false,
          });
        }
      } catch (error) {
        console.error(`Error fetching ${dir.name}:`, error);
      }

      // Small delay to avoid rate limiting
      await sleep(50);
    }
  } catch (error) {
    console.error('Error fetching official Payload plugins:', error);
  }

  return plugins;
}

async function main() {
  console.log('Starting plugin fetch...\n');
  const startTime = Date.now();

  // Fetch official Payload plugins from the main repo
  const officialPlugins = await fetchOfficialPayloadPlugins();
  console.log(`Found ${officialPlugins.length} official plugins from payload monorepo\n`);

  // Fetch all repositories with payload-plugin topic
  const repos = await searchRepositories();
  console.log(`\nProcessing ${repos.length} repositories...`);

  // Process repositories in batches
  const communityPlugins: Plugin[] = [];
  const batchSize = 10;

  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(processRepository));
    communityPlugins.push(...results.flat());

    const progress = Math.min(i + batchSize, repos.length);
    console.log(`Processed ${progress}/${repos.length} repositories (${communityPlugins.length} plugins found)`);

    // Small delay between batches to be nice to GitHub
    if (i + batchSize < repos.length) {
      await sleep(200);
    }
  }

  // Merge official and community plugins, avoiding duplicates
  // Official plugins from monorepo take precedence
  const officialPackageNames = new Set(officialPlugins.map(p => p.packageName?.toLowerCase()));
  const filteredCommunityPlugins = communityPlugins.filter(p => {
    // Skip if it's a duplicate of an official plugin by package name
    if (p.packageName && officialPackageNames.has(p.packageName.toLowerCase())) {
      return false;
    }
    return true;
  });

  const allPlugins = [...officialPlugins, ...filteredCommunityPlugins];

  // Sort by stars descending
  allPlugins.sort((a, b) => b.stars - a.stars);

  // Prepare output data
  const outputData: PluginsData = {
    lastUpdated: new Date().toISOString(),
    totalCount: allPlugins.length,
    plugins: allPlugins,
  };

  // Ensure data directory exists
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write to file
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone! Found ${allPlugins.length} plugins (${officialPlugins.length} official, ${filteredCommunityPlugins.length} community) in ${elapsed}s`);
  console.log(`Output saved to ${OUTPUT_PATH}`);
}

main().catch(console.error);
