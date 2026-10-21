import type { Metadata } from "next";
import { OG_IMAGES } from "@/lib/siteOg";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { PluginListCard } from "@/components/PluginListCard";
import { TemplateMiniCard } from "@/components/templates/TemplateMiniCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";
import { searchSite } from "@/lib/search/site";
import { categoryHref, tagHref } from "@/lib/taxonomy/links";

export const dynamic = "force-dynamic";

// Result pages are thin, unbounded and query-driven (and a busy/timeout page is transient): never indexed, links still followed.
// The canonical is /search without the query; absolute URLs come from metadataBase (getServerURL() in the layout).
export const metadata: Metadata = {
  title: "Search — Payload Directory",
  description: "Full-text search across Payload CMS plugin names, summaries, categories, tags and READMEs.",
  alternates: { canonical: "/search" },
  openGraph: { url: "/search", title: "Search — Payload Directory", images: OG_IMAGES },
  robots: { index: false, follow: true },
};

const browse = (
  <Link href="/" className="text-primary underline underline-offset-4">
    browse the directory
  </Link>
);

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const first = (Array.isArray(q) ? q[0] : q) ?? "";
  // Untrusted: bounded here too (by code points) before it reaches the input or the search layer. React escapes the text.
  const raw = Array.from(typeof first === "string" ? first : "").slice(0, MAX_QUERY_LENGTH).join("");
  const result = await searchSite(raw);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Search</h1>
        <p className="mb-6 text-muted-foreground">Names, summaries, categories, tags and READMEs.</p>

        <form action="/search" method="get" role="search" className="mb-8 flex gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={raw}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="e.g. s3 storage, seo sitemap, passkeys"
            aria-label="Search plugins"
            className="min-w-0"
            autoFocus={!raw}
          />
          <Button type="submit" className="shrink-0">
            <SearchIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Search
          </Button>
        </form>

        {!result ? (
          <p className="text-sm text-muted-foreground">
            Type a few words to search every listed plugin, or {browse}.
          </p>
        ) : result.status !== "ok" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Search is busy right now, try again in a moment, or {browse}.
          </p>
        ) : result.tooShort ? (
          <p className="text-sm text-muted-foreground">Type at least two characters to search.</p>
        ) : (
          <div className="space-y-8">
            <p className="break-words text-sm text-muted-foreground">
              {result.plugins.length} plugin{result.plugins.length === 1 ? "" : "s"} for{" "}
              <span className="font-medium text-foreground">&ldquo;{result.query}&rdquo;</span>
              {result.truncated && ` (query shortened to ${MAX_QUERY_LENGTH} characters)`}
            </p>

            {(result.categories.length > 0 || result.tags.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {result.categories.map((c) => (
                  <Link
                    key={`c-${c.slug}`}
                    href={categoryHref(c.path)}
                    className="max-w-full truncate rounded-full border px-3 py-1 text-sm hover:ring-1 hover:ring-primary/30"
                  >
                    Category: {c.title}
                  </Link>
                ))}
                {result.tags.map((t) => (
                  <Link
                    key={`t-${t.slug}`}
                    href={tagHref(t.slug)}
                    className="max-w-full truncate rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground hover:ring-1 hover:ring-primary/30"
                  >
                    #{t.title}
                  </Link>
                ))}
              </div>
            )}

            {result.hasMore && (
              <p className="text-sm text-muted-foreground">Showing the top {result.plugins.length} matches — refine your search.</p>
            )}

            {result.plugins.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {result.templates.length > 0 ? (
                  <>No plugins match, but templates do.</>
                ) : (
                  <>No plugins match. Try fewer or different words, or {browse}.</>
                )}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {result.plugins.map((plugin) => (
                  <PluginListCard key={plugin.slug} plugin={plugin} />
                ))}
              </div>
            )}

            {result.templates.length > 0 && (
              <section aria-labelledby="search-templates" className="space-y-3">
                <h2 id="search-templates" className="text-lg font-semibold tracking-tight">
                  Templates
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {result.templates.map((template) => (
                    <TemplateMiniCard key={template.slug} template={template} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
