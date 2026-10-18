import type { MetadataRoute } from "next";
import { getPluginSummaries } from "@/lib/directory/queries";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const plugins = await getPluginSummaries();

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
    ...pluginUrls,
  ];
}
