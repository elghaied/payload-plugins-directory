import { Suspense } from "react";
import type { Metadata } from "next";
import { DirectoryHome } from "@/components/templates/DirectoryHome";
import { getTemplateCategoryIndex, getTemplateSummaries } from "@/lib/templates/queries";
import { getHomeFilterOptions } from "@/lib/directory/taxonomy";
import { getDirectoryMeta, getPluginSummaries } from "@/lib/directory/queries";
import { getServerURL } from "@/lib/serverUrl";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { type } = await searchParams;
  return type === "templates" ? { title: "Payload templates — Payload Directory" } : {};
}

export default async function Page() {
  const [plugins, metadata, filters, templates, templateCategories] = await Promise.all([
    getPluginSummaries(),
    getDirectoryMeta(),
    getHomeFilterOptions(),
    getTemplateSummaries(),
    getTemplateCategoryIndex(),
  ]);

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
        <DirectoryHome
          plugins={plugins}
          metadata={metadata}
          categories={filters.categories}
          tags={filters.tags}
          templates={templates}
          templateCategories={templateCategories}
        />
      </Suspense>
    </>
  );
}
