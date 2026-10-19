import type { MetadataRoute } from "next";
import { getPluginSummaries } from "@/lib/directory/queries";
import { getCategoryIndex } from "@/lib/directory/taxonomy";
import { categoryHref } from "@/lib/taxonomy/links";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [plugins, categories] = await Promise.all([getPluginSummaries(), getCategoryIndex()]);

  // Empty categories are thin pages: only categories with at least one listed plugin are submitted.
  const categoryUrls: MetadataRoute.Sitemap = categories
    .filter((c) => c.count > 0)
    .map((c) => ({
      url: `https://payloaddirectory.dev${categoryHref(c.path)}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    }));

  const pluginUrls: MetadataRoute.Sitemap = plugins.map((plugin) => ({
    url: `https://payloaddirectory.dev/plugins/${plugin.slug}`,
    lastModified: plugin.lastUpdate ? new Date(plugin.lastUpdate) : undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    {
      url: "https://payloaddirectory.dev",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://payloaddirectory.dev/stats",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    {
      url: "https://payloaddirectory.dev/about",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: "https://payloaddirectory.dev/categories",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...categoryUrls,
    ...pluginUrls,
  ];
}
