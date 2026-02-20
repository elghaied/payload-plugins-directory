import { Plugin, PluginsData } from "../types";
import pluginsData from "../../data/plugins.json";
import blocklistData from "../../data/blocklist.json";

const blocklist = new Set<string>(blocklistData.ids);

/**
 * Get plugins from the static JSON file.
 * The JSON file is updated via GitHub Actions twice daily.
 * This approach:
 * - Eliminates runtime GitHub API calls
 * - Works perfectly with Vercel's edge caching
 * - Never hits rate limits
 * - Provides instant page loads
 */
export function getPlugins(): Plugin[] {
  return (pluginsData as PluginsData).plugins.filter(
    (p) => !blocklist.has(p.id)
  );
}

/**
 * Get metadata about the plugins data
 */
export function getPluginsMetadata(): { lastUpdated: string; totalCount: number } {
  const data = pluginsData as PluginsData;
  return {
    lastUpdated: data.lastUpdated,
    totalCount: data.totalCount - blocklist.size,
  };
}

/**
 * Get a single plugin by its ID
 */
export function getPluginById(id: string): Plugin | undefined {
  if (blocklist.has(id)) return undefined;
  return (pluginsData as PluginsData).plugins.find((p) => p.id === id);
}

/**
 * Get aggregated stats about the plugin ecosystem
 */
export function getPluginStats() {
  const plugins = getPlugins();
  const total = plugins.length;

  // Version distribution
  const versions = { v1: 0, v2: 0, v3: 0, unknown: 0 };
  plugins.forEach((p) => {
    if (p.payloadVersionMajor.includes(1)) versions.v1++;
    if (p.payloadVersionMajor.includes(2)) versions.v2++;
    if (p.payloadVersionMajor.includes(3)) versions.v3++;
    if (p.payloadVersionMajor.includes(0)) versions.unknown++;
  });

  // License distribution
  const licenseMap: Record<string, number> = {};
  plugins.forEach((p) => {
    const lic = p.license || "None";
    licenseMap[lic] = (licenseMap[lic] || 0) + 1;
  });
  const licenseDistribution = Object.entries(licenseMap)
    .sort((a, b) => b[1] - a[1]);

  // Top authors by plugin count
  const authorMap: Record<string, { count: number; avatar: string }> = {};
  plugins.forEach((p) => {
    if (!authorMap[p.owner]) {
      authorMap[p.owner] = { count: 0, avatar: p.ownerAvatar };
    }
    authorMap[p.owner].count++;
  });
  const topAuthors = Object.entries(authorMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, data]) => ({ name, count: data.count, avatar: data.avatar }));

  // Growth by month (last 12 months)
  const now = new Date();
  const months: { label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const monthStart = d.getTime();
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const count = plugins.filter((p) => {
      const t = new Date(p.createdAt).getTime();
      return t >= monthStart && t < monthEnd;
    }).length;
    months.push({ label, count });
  }

  // Quick numbers — deduplicate by root repo URL so monorepo plugins don't inflate totals
  // Each monorepo package has a unique url like .../tree/main/packages/plugin-foo,
  // so we strip the /tree/... suffix to get the canonical repo key.
  const repoKey = (p: Plugin) => p.url.split("/tree/")[0];

  const uniqueRepos = new Map<string, Plugin>();
  plugins.forEach((p) => {
    const key = repoKey(p);
    if (!uniqueRepos.has(key)) uniqueRepos.set(key, p);
  });
  const totalStars = Array.from(uniqueRepos.values()).reduce((s, p) => s + p.stars, 0);
  const totalForks = Array.from(uniqueRepos.values()).reduce((s, p) => s + p.forks, 0);
  const starValues = plugins.map((p) => p.stars).sort((a, b) => a - b);
  const medianStars = starValues[Math.floor(starValues.length / 2)] || 0;
  const avgStars = total > 0 ? Math.round(totalStars / total) : 0;
  const official = plugins.filter((p) => p.isOfficial).length;
  const community = total - official;

  // npm download aggregates
  const totalDownloadsWeekly = plugins.reduce((s, p) => s + (p.npm?.weeklyDownloads ?? 0), 0);
  const totalDownloadsMonthly = plugins.reduce((s, p) => s + (p.npm?.monthlyDownloads ?? 0), 0);

  // Most downloaded (top 10 by weekly)
  const mostDownloaded = [...plugins]
    .filter((p) => p.npm?.weeklyDownloads)
    .sort((a, b) => (b.npm?.weeklyDownloads ?? 0) - (a.npm?.weeklyDownloads ?? 0))
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      packageName: p.packageName,
      weeklyDownloads: p.npm!.weeklyDownloads,
      owner: p.owner,
      avatar: p.ownerAvatar,
    }));

  // Most downloaded community plugins (top 10 by weekly, excluding official)
  const mostDownloadedCommunity = [...plugins]
    .filter((p) => !p.isOfficial && p.npm?.weeklyDownloads)
    .sort((a, b) => (b.npm?.weeklyDownloads ?? 0) - (a.npm?.weeklyDownloads ?? 0))
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      packageName: p.packageName,
      weeklyDownloads: p.npm!.weeklyDownloads,
      owner: p.owner,
      avatar: p.ownerAvatar,
    }));

  // Size distribution
  const sizeDistribution = { "<50KB": 0, "50-200KB": 0, "200KB-1MB": 0, "1-5MB": 0, ">5MB": 0 };
  plugins.forEach((p) => {
    const size = p.npm?.unpackedSize;
    if (size == null) return;
    if (size < 50 * 1024) sizeDistribution["<50KB"]++;
    else if (size < 200 * 1024) sizeDistribution["50-200KB"]++;
    else if (size < 1024 * 1024) sizeDistribution["200KB-1MB"]++;
    else if (size < 5 * 1024 * 1024) sizeDistribution["1-5MB"]++;
    else sizeDistribution[">5MB"]++;
  });

  // Health distribution
  const healthDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  plugins.forEach((p) => {
    const h = p.healthScore ?? 0;
    if (h >= 75) healthDistribution.excellent++;
    else if (h >= 50) healthDistribution.good++;
    else if (h >= 25) healthDistribution.fair++;
    else healthDistribution.poor++;
  });

  const healthScores = plugins.map((p) => p.healthScore ?? 0);
  const avgHealth = total > 0 ? Math.round(healthScores.reduce((a, b) => a + b, 0) / total) : 0;
  const pluginsWithNpmCount = plugins.filter((p) => p.npm).length;

  return {
    total,
    versions,
    licenseDistribution,
    topAuthors,
    months,
    totalStars,
    totalForks,
    medianStars,
    avgStars,
    official,
    community,
    totalDownloadsWeekly,
    totalDownloadsMonthly,
    mostDownloaded,
    mostDownloadedCommunity,
    sizeDistribution,
    healthDistribution,
    avgHealth,
    pluginsWithNpmCount,
  };
}

/**
 * Extract major versions from a Payload version string.
 * Useful for filtering and display.
 */
export function extractMajorVersions(version: string): number[] {
  if (version.toLowerCase().includes("beta")) {
    return [3];
  }

  const versionRanges = version.split("||").map((v) => v.trim());
  const majorVersions = new Set<number>();

  versionRanges.forEach((range) => {
    const cleanVersion = range.replace(/[\^~>=<]/g, "").trim();

    const betaMatch = cleanVersion.match(/^(\d+)\.0\.0(?:-beta|$)/);
    if (betaMatch) {
      majorVersions.add(parseInt(betaMatch[1]));
      return;
    }

    const match = cleanVersion.match(/^(\d+)/);
    if (match) {
      majorVersions.add(parseInt(match[1]));
    }
  });

  return Array.from(majorVersions).sort((a, b) => a - b);
}
