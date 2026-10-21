import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Star,
  GitFork,
  Clock,
  AlertCircle,
  ExternalLink,
  ArrowLeft,
  Package,
  Scale,
  Calendar,
  Download,
  Tag,
  Box,
  Layers,
  Flag,
  BadgeCheck,
} from "lucide-react";
import { getPluginDetail, getSimilarPlugins } from "@/lib/directory/queries";
import { capReadme } from "@/lib/directory/readme";
import { getServerURL } from "@/lib/serverUrl";
import { BadgeEmbed } from "@/components/BadgeEmbed";
import { getPluginTrends } from "@/lib/trends/queries";
import { HISTORY_DAYS } from "@/lib/trends/growth";
import { daysBetween, formatDay, utcToday } from "@/lib/trends/days";
import type { PluginTrends } from "@/lib/trends/types";
import { TrendChart } from "@/components/trends/TrendChart";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PayloadIcon } from "@/components/PayloadIcon";
import { CategoryBreadcrumbs } from "@/components/CategoryBreadcrumbs";
import { SimilarPlugins } from "@/components/SimilarPlugins";
import { PluginAiOverview } from "@/components/PluginAiOverview";
import { getCategoryNodes } from "@/lib/directory/taxonomy";
import { categoryHref, tagHref } from "@/lib/taxonomy/links";
import { trailFor } from "@/taxonomy/tree";
import {
  versionColors,
  formatRelativeTime,
  formatDate,
  formatNumber,
  formatDownloads,
  formatSize,
  getHealthDisplayFromScore,
} from "@/lib/formatters";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const plugin = await getPluginDetail(slug);
  if (!plugin) notFound();

  const title = `${plugin.name} — Payload Plugin Directory`;
  const description = (plugin.ai?.summary || plugin.description).slice(0, 160);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

// A trends failure must not take the detail page down; the rest of the page does not depend on it.
async function loadTrends(slug: string): Promise<PluginTrends | null> {
  try {
    return await getPluginTrends(slug);
  } catch (error) {
    console.error(`[trends] failed to load trends for ${slug}`, error);
    return null;
  }
}

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [plugin, trends, similar] = await Promise.all([getPluginDetail(slug), loadTrends(slug), getSimilarPlugins(slug)]);
  if (!plugin) notFound();
  // PluginTrends carries no lastSnapshotDay; derive it from the newest point of either series.
  const lastSnapshotDay = trends
    ? [trends.stars.at(-1)?.date, trends.downloads.at(-1)?.date].filter((d): d is string => !!d).sort().at(-1) ?? null
    : null;
  const today = utcToday();
  const staleTrends = lastSnapshotDay !== null && daysBetween(lastSnapshotDay, today) > 2;

  const filteredTopics = plugin.topics.filter((t) => t !== "payload-plugin");
  const trail = plugin.category ? trailFor(await getCategoryNodes(), plugin.category.path) : [];
  const readmeFull = plugin.readmeFull ? capReadme(plugin.readmeFull) : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: plugin.name,
    description: plugin.description,
    url: `${getServerURL()}/plugins/${plugin.slug}`,
    applicationCategory: "Plugin",
    operatingSystem: "Node.js",
    ...(plugin.category ? { applicationSubCategory: plugin.category.title } : {}),
    author: {
      "@type": "Person",
      name: plugin.owner,
    },
    dateModified: plugin.lastUpdate,
    dateCreated: plugin.createdAt,
    ...(plugin.license ? { license: plugin.license } : {}),
    ...(plugin.packageName
      ? { offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }
      : {}),
    ...(plugin.npm?.latestVersion ? { softwareVersion: plugin.npm.latestVersion } : {}),
    ...(plugin.npm?.unpackedSize != null ? { fileSize: formatSize(plugin.npm.unpackedSize) } : {}),
  };

  const healthScore = plugin.healthScore ?? 0;
  const health = plugin.isArchived
    ? { color: "bg-red-500", label: "Archived" }
    : getHealthDisplayFromScore(healthScore);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Breadcrumbs (categorised) or back navigation */}
        {trail.length > 0 ? (
          <CategoryBreadcrumbs trail={trail} current={plugin.name} />
        ) : (
          <Link
            href="/"
            replace
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to directory
          </Link>
        )}

        {/* Plugin header */}
        <header className="mb-8">
          <div className="flex items-start gap-4">
            <img
              src={plugin.logoUrl ?? plugin.ownerAvatar}
              alt={plugin.logoUrl ? `${plugin.name} logo` : plugin.owner}
              className={`w-14 h-14 ring-2 ring-border ${plugin.logoUrl ? 'rounded-lg object-contain bg-background' : 'rounded-full'}`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight capitalize">
                  {plugin.name}
                </h1>
                {plugin.isOfficial && (
                  <Badge className="bg-blue-500 text-white hover:bg-blue-600 text-xs">
                    Official
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <span>by {plugin.owner}</span>
                {plugin.collection && (
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                  >
                    <Package className="h-3 w-3 mr-1" />
                    {plugin.collection}
                  </Badge>
                )}
              </div>
              {plugin.customTagline && (
                <p className="mt-2 text-muted-foreground">{plugin.customTagline}</p>
              )}
              {/* Only a category that resolves in the current tree (its trail) gets a badge: no link to a 404. */}
              {plugin.category && trail.length > 0 && (
                <Link
                  href={categoryHref(plugin.category.path)}
                  className="inline-flex mt-2 text-xs px-2 py-0.5 rounded-full border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                >
                  {plugin.category.title}
                </Link>
              )}
            </div>
          </div>

          {/* Version & license badges */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {plugin.payloadMajors.map((v) => (
              <Badge
                key={v}
                variant="secondary"
                className={`${versionColors[v] || "bg-gray-100"} text-xs font-medium`}
              >
                <PayloadIcon className="h-3 w-3 mr-1" />
                {v === "unknown" ? "v?" : `v${v}`}
              </Badge>
            ))}
            {plugin.payloadVersionRange && (
              <Badge variant="outline" className="text-xs font-normal font-mono">
                {plugin.payloadVersionRange}
              </Badge>
            )}
            {plugin.license && (
              <Badge variant="outline" className="text-xs font-normal">
                <Scale className="h-3 w-3 mr-1" />
                {plugin.license}
              </Badge>
            )}
          </div>
        </header>

        {/* AI overview (labelled), then the author's own words */}
        {plugin.ai && <PluginAiOverview {...plugin.ai} />}
        {plugin.authorDescription && (
          <section className="mb-8">
            <h2 className="text-xs font-medium text-muted-foreground mb-2">From the author</h2>
            <p className="text-muted-foreground leading-relaxed">{plugin.authorDescription}</p>
          </section>
        )}

        {/* Install command */}
        {plugin.packageName && (
          <Card className="mb-8">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Installation</p>
              <code className="block px-4 py-3 bg-secondary/50 rounded-lg text-sm font-mono">
                npm i {plugin.packageName}
              </code>
            </CardContent>
          </Card>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Star className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-lg font-semibold">{formatNumber(plugin.stars)}</p>
                <p className="text-xs text-muted-foreground">Stars</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <GitFork className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-lg font-semibold">{formatNumber(plugin.forks)}</p>
                <p className="text-xs text-muted-foreground">Forks</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-lg font-semibold">{plugin.openIssues}</p>
                <p className="text-xs text-muted-foreground">Open Issues</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-semibold">{formatRelativeTime(plugin.lastUpdate)}</p>
                <p className="text-xs text-muted-foreground">Last Updated</p>
              </div>
            </CardContent>
          </Card>
          {plugin.npm && (
            <>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <Download className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{formatDownloads(plugin.npm.weeklyDownloads ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">Weekly Downloads</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center">
                    <Tag className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold font-mono">v{plugin.npm.latestVersion}</p>
                    <p className="text-xs text-muted-foreground">npm Version</p>
                  </div>
                </CardContent>
              </Card>
              {plugin.npm.unpackedSize != null && (
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                      <Box className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{formatSize(plugin.npm.unpackedSize)}</p>
                      <p className="text-xs text-muted-foreground">Unpacked Size</p>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                    <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{plugin.npm.dependencyCount}</p>
                    <p className="text-xs text-muted-foreground">Dependencies</p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Trends */}
        {trends && (
          <section aria-labelledby="trends-heading" className="mb-8">
            <h2 id="trends-heading" className="text-xs font-medium text-muted-foreground mb-3">
              Trends (last {HISTORY_DAYS} days)
            </h2>
            <div className={`grid gap-4 ${plugin.npm ? "sm:grid-cols-2" : ""}`}>
              <Card>
                <CardContent className="p-4">
                  <TrendChart
                    title={trends.sharedRepository ? "Repository stars" : "GitHub stars"}
                    metric="Stars"
                    tone="stars"
                    series={trends.stars}
                    outdated={trends.outdated?.stars}
                    footnote={
                      trends.sharedRepository
                        ? `Shared by ${trends.sharedRepository.pluginCount} plugins in ${trends.sharedRepository.fullName}.`
                        : undefined
                    }
                  />
                </CardContent>
              </Card>
              {/* Same condition as the stats grid: snapshots only store non-NULL downloads, so a package without npm data never gets any. */}
              {plugin.npm && (
                <Card>
                  <CardContent className="p-4">
                    <TrendChart
                      title="npm weekly downloads"
                      metric="Weekly downloads"
                      tone="downloads"
                      series={trends.downloads}
                      outdated={trends.outdated?.downloads}
                      footnote="Each point is npm's rolling 7-day download count."
                    />
                  </CardContent>
                </Card>
              )}
            </div>
            {staleTrends && lastSnapshotDay && (
              <p className="mt-2 text-xs text-muted-foreground">Data as of {formatDay(lastSnapshotDay, true)}</p>
            )}
          </section>
        )}

        {/* Health Score */}
        {plugin.healthScore != null && (
          <Card className="mb-8">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">Health Score</p>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${health.color}`} />
                  <span className="text-sm font-semibold">{healthScore}/100</span>
                  <span className="text-xs text-muted-foreground">{health.label}</span>
                </div>
              </div>
              <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${health.color}`}
                  style={{ width: `${healthScore}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Composite score based on GitHub activity, stars, npm downloads, publish recency, dependency count, and package size.
              </p>
            </CardContent>
          </Card>
        )}

        {/* README badge: needs a configured public origin, never a guessed host */}
        {getServerURL() && <BadgeEmbed slug={plugin.slug} origin={getServerURL()} />}

        {/* Dates */}
        <div className="flex items-center gap-6 text-sm text-muted-foreground mb-8 flex-wrap">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            Updated {formatDate(plugin.lastUpdate)}
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            Created {formatDate(plugin.createdAt)}
          </span>
          {plugin.npm?.lastPublish && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Published {formatDate(plugin.npm.lastPublish)}
            </span>
          )}
        </div>

        {/* README: preview, full text on demand (author content, plain text) */}
        {plugin.readme && (
          <Card className="mb-8">
            <CardContent className="p-6">
              <p className="text-xs font-medium text-muted-foreground mb-3">README</p>
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans leading-relaxed bg-transparent p-0 m-0 border-0">
                {plugin.readme}
              </pre>
              {readmeFull && readmeFull.text.length > plugin.readme.length && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Full README</summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground font-sans leading-relaxed bg-transparent p-0 m-0 border-0">
                    {readmeFull.text}
                  </pre>
                  {readmeFull.truncated && (
                    <a
                      href={plugin.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      View full README on GitHub
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {/* Topics */}
        {filteredTopics.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-medium text-muted-foreground mb-3">Topics</p>
            <div className="flex flex-wrap gap-2">
              {filteredTopics.map((topic) => (
                <Link
                  key={topic}
                  href={`/?q=${encodeURIComponent(topic)}`}
                  className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-sm hover:ring-1 hover:ring-primary/30 transition-all"
                >
                  {topic}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {plugin.tagList.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-medium text-muted-foreground mb-3">Tags</p>
            <div className="flex flex-wrap gap-2">
              {plugin.tagList.map((tag) => (
                <Link
                  key={tag.slug}
                  href={tagHref(tag.slug)}
                  className="px-3 py-1 border rounded-full text-sm hover:ring-1 hover:ring-primary/30 transition-all"
                >
                  {tag.title}
                </Link>
              ))}
            </div>
          </div>
        )}

        <SimilarPlugins plugins={similar} />

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={plugin.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 py-3 px-6 bg-primary text-primary-foreground rounded-lg transition-colors text-sm font-medium hover:bg-primary/90"
          >
            View on GitHub
            <ExternalLink className="h-4 w-4" />
          </a>
          {plugin.packageName && (
            <a
              href={`https://www.npmjs.com/package/${plugin.packageName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 py-3 px-6 bg-secondary text-secondary-foreground rounded-lg transition-colors text-sm font-medium hover:bg-secondary/80"
            >
              View on npm
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {plugin.isOfficial ? (
            <span className="inline-flex items-center gap-2 py-3 px-2 text-sm text-muted-foreground">
              <BadgeCheck className="h-4 w-4" />
              Official Payload plugin
            </span>
          ) : (
            <Link
              href={`/claim/${encodeURIComponent(plugin.slug)}`}
              className="inline-flex items-center justify-center gap-2 py-3 px-6 border rounded-lg transition-colors text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <BadgeCheck className="h-4 w-4" />
              Claim this plugin
            </Link>
          )}
          {!plugin.isOfficial && (
            <a
              href={`https://github.com/elghaied/payload-plugins-directory/issues/new?title=${encodeURIComponent(`Report: ${plugin.name}`)}&body=${encodeURIComponent(`**Plugin ID:** ${plugin.slug}\n**Name:** ${plugin.name}\n**Owner:** ${plugin.owner}\n**URL:** ${plugin.url}\n\n**Reason for report:**\n`)}&labels=report`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 py-3 px-6 border rounded-lg transition-colors text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5"
            >
              <Flag className="h-4 w-4" />
              Report
            </a>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
