import { Suspense } from "react";
import { PluginDirectory } from "@/components/PluginDirectory";
import { getPlugins, getPluginsMetadata } from "@/lib/getPlugins";

export default function Page() {
  const plugins = getPlugins();
  const metadata = getPluginsMetadata();

  const topPlugins = [...plugins]
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 20);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Payload CMS Plugin Directory",
    description: `Browse and discover ${metadata.totalCount}+ Payload CMS plugins.`,
    url: "https://payload-plugins-directory.gshell.fr",
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
          url: `https://payload-plugins-directory.gshell.fr/plugins/${plugin.id}`,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Suspense>
        <PluginDirectory plugins={plugins} metadata={metadata} />
      </Suspense>
    </>
  );
}
