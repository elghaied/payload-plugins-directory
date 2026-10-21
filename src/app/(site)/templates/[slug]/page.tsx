import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/siteOg";
import { getServerURL } from "@/lib/serverUrl";
import { getSimilarTemplates, getTemplateCategoryNodes, getTemplateDetail } from "@/lib/templates/queries";
import { capReadme, truncateAtWord } from "@/lib/directory/readme";
import { README_MARKDOWN_MAX } from "@/lib/directory/readmeLimits";
import { getCleanReadmeHtml } from "@/lib/directory/readmeClean";
import { TEMPLATES_HOME_HREF, templateCategoryHref } from "@/lib/taxonomy/links";
import { trailFor } from "@/taxonomy/tree";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryBreadcrumbs } from "@/components/CategoryBreadcrumbs";
import { PluginAiOverview } from "@/components/PluginAiOverview";
import { ReadmeHtml, ReadmePlain } from "@/components/ReadmeBody";
import { TemplateCard } from "@/components/templates/TemplateCard";
import { TemplateGallery } from "@/components/templates/TemplateGallery";
import { GetStarted } from "@/components/templates/GetStarted";
import { TemplateSidePanel } from "@/components/templates/TemplateSidePanel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** One lookup per request for generateMetadata and the page. */
const load = cache(async (slug: string) => getTemplateDetail(slug));

const TEMPLATES_ROOT = [{ title: "Templates", href: TEMPLATES_HOME_HREF }];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const template = await load(slug);
  if (!template) notFound();
  const title = `${template.name} — Payload template — Payload Directory`;
  const description = truncateAtWord(template.tagline || `${template.name}, a starter template for Payload CMS.`, 160);
  return {
    title,
    description,
    alternates: { canonical: `/templates/${encodeURIComponent(template.slug)}` },
    openGraph: { title, description, type: "website", images: OG_IMAGES },
    twitter: { card: "summary_large_image", title, description, images: TWITTER_IMAGES },
  };
}

const primaryButton =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90";
const secondaryButton = "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:bg-accent";

export default async function TemplatePage({ params }: Props) {
  const { slug } = await params;
  const [template, similar, nodes] = await Promise.all([load(slug), getSimilarTemplates(slug, 3), getTemplateCategoryNodes()]);
  if (!template) notFound();

  const trail = template.category ? trailFor(nodes, template.category.path) : [];
  const categoryLink = template.category && trail.length > 0 ? templateCategoryHref(template.category.path) : null;
  const readmeFull = template.readmeFull ? capReadme(template.readmeFull) : null;
  // The cache key is namespaced so a template never shares an entry with a plugin of the same slug.
  const readmeHtml = template.readmeHtml
    ? await getCleanReadmeHtml(`template-${template.slug}`, template.readmeHtml, template.readmeRenderVersion ?? null)
    : null;
  const showFullReadme = !readmeHtml && Boolean(readmeFull && template.readme && readmeFull.text.length > template.readme.length);
  const readmeCut = (template.readmeFull?.length ?? 0) > README_MARKDOWN_MAX && readmeHtml !== null;

  const useLink = template.getStarted.kind === "link";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: template.name,
    description: template.tagline,
    url: `${getServerURL()}/templates/${template.slug}`,
    codeRepository: template.url,
    programmingLanguage: "TypeScript",
    ...(template.license ? { license: template.license } : {}),
    author: template.isOfficial ? { "@type": "Organization", name: "Payload" } : { "@type": "Person", name: template.owner },
    ...(template.lastUpdate ? { dateModified: template.lastUpdate } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
        <div className="container mx-auto max-w-6xl px-4 py-8">
          <CategoryBreadcrumbs trail={trail} current={template.name} root={TEMPLATES_ROOT} hrefFor={templateCategoryHref} />

          <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{template.name}</h1>
                {template.isOfficial && (
                  <Badge variant="outline" className="border-[var(--brand-amber)] text-[var(--brand-amber)]">
                    Official
                  </Badge>
                )}
              </div>
              {template.tagline && <p className="mt-2 max-w-2xl text-muted-foreground">{template.tagline}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {template.demoUrl && (
                <a href={template.demoUrl} target="_blank" rel="nofollow ugc noopener noreferrer" className={primaryButton}>
                  Live demo ↗
                </a>
              )}
              {useLink ? (
                <a
                  href={template.getStarted.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={template.demoUrl ? secondaryButton : primaryButton}
                >
                  Use this template
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <a href="#get-started" className={template.demoUrl ? secondaryButton : primaryButton}>
                  Use this template
                </a>
              )}
            </div>
          </header>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <TemplateGallery name={template.name} screenshots={template.screenshots} video={template.video} fallback={template.image} />

              {template.ai && (
                <PluginAiOverview
                  summary={template.ai.summary}
                  features={template.ai.features}
                  useCases={template.ai.goodFor}
                  generated={template.ai.generated}
                  labels={{ useCases: "Good for" }}
                />
              )}
              {template.authorDescription && (
                <section className="mb-8">
                  <h2 className="mb-2 text-xs font-medium text-muted-foreground">From the author</h2>
                  <p className="leading-relaxed text-muted-foreground">{template.authorDescription}</p>
                </section>
              )}

              <GetStarted getStarted={template.getStarted} />

              {template.readme && (
                <Card className="mb-8">
                  <CardContent className="p-6">
                    <h2 className="mb-3 text-xs font-medium text-muted-foreground">README</h2>
                    {readmeHtml ? <ReadmeHtml cleanHtml={readmeHtml} /> : <ReadmePlain source={template.readme} />}
                    {showFullReadme && readmeFull && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Full README</summary>
                        <div className="mt-3">
                          <ReadmePlain source={readmeFull.text} />
                        </div>
                      </details>
                    )}
                    {(template.readmeTruncated || readmeFull?.truncated || readmeCut) && (
                      <a
                        href={template.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        README truncated — read the full version on GitHub
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="lg:sticky lg:top-20 lg:self-start">
              <TemplateSidePanel template={template} categoryHref={categoryLink} />
              {!template.isOfficial && (
                <Link
                  href={`/claim/templates/${encodeURIComponent(template.slug)}`}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  Claim this template
                </Link>
              )}
            </div>
          </div>

          {similar.length > 0 && (
            <section aria-labelledby="similar-templates" className="mt-12">
              <h2 id="similar-templates" className="mb-4 text-lg font-semibold">
                {template.category && categoryLink ? `More ${template.category.title} templates` : "More templates"}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {similar.map((t) => (
                  <TemplateCard key={t.slug} template={t} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
