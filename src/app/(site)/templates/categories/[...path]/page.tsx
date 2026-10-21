import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/siteOg";
import { CategoryBreadcrumbs } from "@/components/CategoryBreadcrumbs";
import { TemplateCard } from "@/components/templates/TemplateCard";
import { truncateAtWord } from "@/lib/directory/readme";
import { getServerURL } from "@/lib/serverUrl";
import { segmentsOf } from "@/lib/taxonomy/segments";
import { getTemplateCategoryPage } from "@/lib/templates/queries";
import { TEMPLATES_HOME_HREF, templateCategoryHref } from "@/lib/taxonomy/links";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ path: string[] }> };

const TEMPLATES_ROOT = [{ title: "Templates", href: TEMPLATES_HOME_HREF }];

/** One lookup per request for generateMetadata and the page (React.cache keys on the joined path). */
const loadPath = cache(async (path: string) => getTemplateCategoryPage(path));

async function load(params: Props["params"]) {
  const segments = segmentsOf((await params).path);
  if (!segments) notFound();
  const data = await loadPath(segments.join("/"));
  if (!data) notFound();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { node } = await load(params);
  const title = `${node.title} templates for Payload CMS — Payload Directory`;
  const description = truncateAtWord(node.intro ?? `Payload CMS starter templates in ${node.title}.`, 160);
  return {
    title,
    description,
    alternates: { canonical: templateCategoryHref(node.path) },
    openGraph: { title, description, type: "website", images: OG_IMAGES },
    twitter: { card: "summary_large_image", title, description, images: TWITTER_IMAGES },
  };
}

export default async function TemplateCategoryPage({ params }: Props) {
  const { node, trail, children, templates } = await load(params);
  const base = getServerURL();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Templates", item: `${base}${TEMPLATES_HOME_HREF}` },
        ...trail.map((n, i) => ({ "@type": "ListItem", position: i + 2, name: n.title, item: `${base}${templateCategoryHref(n.path)}` })),
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${node.title} templates for Payload CMS`,
      description: node.intro ?? undefined,
      url: `${base}${templateCategoryHref(node.path)}`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: templates.length,
        itemListElement: templates.slice(0, 20).map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}/templates/${t.slug}`,
          name: t.name,
        })),
      },
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <CategoryBreadcrumbs trail={trail} root={TEMPLATES_ROOT} hrefFor={templateCategoryHref} />
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{node.title}</h1>
          {node.intro && <p className="mt-2 max-w-3xl leading-relaxed text-muted-foreground">{node.intro}</p>}
          <p className="mt-2 text-sm text-muted-foreground">
            {templates.length} {templates.length === 1 ? "template" : "templates"}
          </p>
        </header>

        {children.length > 0 && (
          <nav aria-label="Subcategories" className="mb-8 flex flex-wrap gap-2">
            {children.map((child) => (
              <Link
                key={child.slug}
                href={templateCategoryHref(child.path)}
                className="rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-all hover:ring-1 hover:ring-primary/30"
              >
                {child.title} <span className="text-muted-foreground">({child.count})</span>
              </Link>
            ))}
          </nav>
        )}

        {templates.length === 0 ? (
          <p className="text-muted-foreground" role="status">No listed templates in this category yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => <TemplateCard key={t.slug} template={t} />)}
          </div>
        )}
      </div>
    </>
  );
}
