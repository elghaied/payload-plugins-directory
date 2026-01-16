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
