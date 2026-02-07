import type { MetadataRoute } from "next";
import { getPlugins } from "@/lib/getPlugins";

export default function sitemap(): MetadataRoute.Sitemap {
  const plugins = getPlugins();

  const pluginUrls: MetadataRoute.Sitemap = plugins.map((plugin) => ({
    url: `https://payload-plugins-directory.vercel.app/plugins/${plugin.id}`,
    lastModified: new Date(plugin.lastUpdate),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    {
      url: "https://payload-plugins-directory.vercel.app",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://payload-plugins-directory.vercel.app/stats",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    ...pluginUrls,
  ];
}
