import type { MetadataRoute } from "next";
import { getPluginSummaries } from "@/lib/directory/queries";
import { getCategoryIndex } from "@/lib/directory/taxonomy";
import { getTemplateCategoryIndex, getTemplateSummaries } from "@/lib/templates/queries";
import { categoryHref, templateCategoryHref } from "@/lib/taxonomy/links";
import { getServerURL } from "@/lib/serverUrl";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getServerURL();
  const [plugins, categories, templates, templateCategories] = await Promise.all([
    getPluginSummaries(),
    getCategoryIndex(),
    getTemplateSummaries(),
    getTemplateCategoryIndex(),
  ]);

  // Empty categories are thin pages: only categories with at least one listed plugin are submitted.
  const categoryUrls: MetadataRoute.Sitemap = categories
    .filter((c) => c.count > 0)
    .map((c) => ({
      url: `${base}${categoryHref(c.path)}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    }));

  const pluginUrls: MetadataRoute.Sitemap = plugins.map((plugin) => ({
    url: `${base}/plugins/${plugin.slug}`,
    lastModified: plugin.lastUpdate ? new Date(plugin.lastUpdate) : undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // /templates redirects, so it is not listed. Summaries only hold listed (not hidden/trashed) templates.
  const templateUrls: MetadataRoute.Sitemap = templates.map((t) => ({
    url: `${base}/templates/${t.slug}`,
    lastModified: t.lastUpdate ? new Date(t.lastUpdate) : undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
  const templateCategoryUrls: MetadataRoute.Sitemap = templateCategories
    .filter((c) => c.count > 0)
    .map((c) => ({
      url: `${base}${templateCategoryHref(c.path)}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    }));

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${base}/trending`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    {
      url: `${base}/stats`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    {
      url: `${base}/mcp`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${base}/categories`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...categoryUrls,
    ...pluginUrls,
    ...templateCategoryUrls,
    ...templateUrls,
  ];
}
