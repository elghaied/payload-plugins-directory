import type { Metadata } from "next";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/siteOg";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CategoryBreadcrumbs } from "@/components/CategoryBreadcrumbs";
import { PluginListCard } from "@/components/PluginListCard";
import { truncateAtWord } from "@/lib/directory/readme";
import { getCategoryPage } from "@/lib/directory/taxonomy";
import { getServerURL } from "@/lib/serverUrl";
import { categoryHref } from "@/lib/taxonomy/links";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ path: string[] }> };

/** Decoded segments, or null when one is not a single path segment (a "/" or "%2F" inside it, or bad encoding). */
function segmentsOf(path: string[]): string[] | null {
  const out: string[] = [];
  for (const raw of path) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg.includes("/")) return null;
    out.push(seg);
  }
  return out;
}

/** One lookup per request for generateMetadata and the page (React.cache keys on the joined path). */
const loadPath = cache(async (path: string) => getCategoryPage(path));

async function load(params: Props["params"]) {
  const segments = segmentsOf((await params).path);
  if (!segments) notFound();
  const data = await loadPath(segments.join("/"));
  if (!data) notFound();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { node } = await load(params);
  const title = `${node.title} plugins for Payload CMS — Payload Plugin Directory`;
  const description = truncateAtWord(node.intro ?? `Payload CMS plugins in ${node.title}.`, 160);
  return { title, description, openGraph: { title, description, type: "website", images: OG_IMAGES }, twitter: { card: "summary_large_image", title, description, images: TWITTER_IMAGES } };
}

export default async function CategoryPage({ params }: Props) {
  const { node, trail, children, plugins } = await load(params);
  const base = getServerURL();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Categories", item: `${base}/categories` },
        ...trail.map((n, i) => ({ "@type": "ListItem", position: i + 2, name: n.title, item: `${base}${categoryHref(n.path)}` })),
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${node.title} plugins for Payload CMS`,
      description: node.intro ?? undefined,
      url: `${base}${categoryHref(node.path)}`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: plugins.length,
        itemListElement: plugins.slice(0, 20).map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}/plugins/${p.slug}`,
          name: p.name,
        })),
      },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <CategoryBreadcrumbs trail={trail} />
        <header className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{node.title}</h1>
          {node.intro && <p className="mt-2 text-muted-foreground leading-relaxed max-w-3xl">{node.intro}</p>}
          <p className="mt-2 text-sm text-muted-foreground">{plugins.length} {plugins.length === 1 ? "plugin" : "plugins"}, ranked by health score, then weekly downloads.</p>
        </header>

        {children.length > 0 && (
          <nav aria-label="Subcategories" className="mb-8 flex flex-wrap gap-2">
            {children.map((child) => (
              <Link
                key={child.slug}
                href={categoryHref(child.path)}
                className="px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm hover:ring-1 hover:ring-primary/30 transition-all"
              >
                {child.title} <span className="text-muted-foreground">({child.count})</span>
              </Link>
            ))}
          </nav>
        )}

        {plugins.length === 0 ? (
          <p className="text-muted-foreground" role="status">No listed plugins in this category yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {plugins.map((plugin) => <PluginListCard key={plugin.slug} plugin={plugin} />)}
          </div>
        )}
      </div>
    </>
  );
}
