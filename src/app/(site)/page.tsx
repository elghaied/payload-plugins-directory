import { Suspense } from "react";
import { PluginDirectory } from "@/components/PluginDirectory";
import { getHomeFilterOptions } from "@/lib/directory/taxonomy";
import { getDirectoryMeta, getPluginSummaries } from "@/lib/directory/queries";
import { getServerURL } from "@/lib/serverUrl";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [plugins, metadata, filters] = await Promise.all([getPluginSummaries(), getDirectoryMeta(), getHomeFilterOptions()]);

  const base = getServerURL();
  const topPlugins = [...plugins]
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 20);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Payload Directory",
    description: `Browse and discover ${metadata.totalCount}+ Payload CMS plugins.`,
    url: base,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: metadata.totalCount,
      itemListElement: topPlugins.map((plugin, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "SoftwareApplication",
          name: plugin.name,
          description: plugin.description,
          url: `${base}/plugins/${plugin.slug}`,
          applicationCategory: "Plugin",
          operatingSystem: "Node.js",
          author: {
            "@type": "Person",
            name: plugin.owner,
          },
          ...(plugin.license ? { license: plugin.license } : {}),
        },
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading plugins...</p></div>}>
        <PluginDirectory plugins={plugins} metadata={metadata} categories={filters.categories} tags={filters.tags} />
      </Suspense>
    </>
  );
}
