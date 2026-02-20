import type { MetadataRoute } from "next";
import { getPlugins } from "@/lib/getPlugins";

export default function sitemap(): MetadataRoute.Sitemap {
  const plugins = getPlugins();

  const pluginUrls: MetadataRoute.Sitemap = plugins.map((plugin) => ({
    url: `https://payloaddirectory.dev/plugins/${plugin.id}`,
    lastModified: new Date(plugin.lastUpdate),
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
    ...pluginUrls,
  ];
}
