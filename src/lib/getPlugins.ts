import { Plugin, PluginsData } from "../types";
import pluginsData from "../../data/plugins.json";

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
  return (pluginsData as PluginsData).plugins;
}

/**
 * Get metadata about the plugins data
 */
export function getPluginsMetadata(): { lastUpdated: string; totalCount: number } {
  const data = pluginsData as PluginsData;
  return {
    lastUpdated: data.lastUpdated,
    totalCount: data.totalCount,
  };
}

/**
 * Get a single plugin by its ID
 */
export function getPluginById(id: string): Plugin | undefined {
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

  // Quick numbers
  const totalStars = plugins.reduce((s, p) => s + p.stars, 0);
  const totalForks = plugins.reduce((s, p) => s + p.forks, 0);
  const starValues = plugins.map((p) => p.stars).sort((a, b) => a - b);
  const medianStars = starValues[Math.floor(starValues.length / 2)] || 0;
  const avgStars = total > 0 ? Math.round(totalStars / total) : 0;
  const official = plugins.filter((p) => p.isOfficial).length;
  const community = total - official;

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
