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
} from "lucide-react";
import { getPlugins, getPluginById } from "@/lib/getPlugins";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PayloadIcon } from "@/components/PayloadIcon";

const versionColors: Record<number, string> = {
  0: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
  1: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNumber(num: number): string {
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function formatDownloads(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getHealthDisplay(score: number): { color: string; label: string } {
  if (score >= 75) return { color: "bg-emerald-500", label: "Excellent" };
  if (score >= 50) return { color: "bg-green-500", label: "Good" };
  if (score >= 25) return { color: "bg-yellow-500", label: "Fair" };
  return { color: "bg-orange-500", label: "Poor" };
}

export function generateStaticParams() {
  return getPlugins().map((plugin) => ({ id: plugin.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const plugin = getPluginById(id);
  if (!plugin) return { title: "Plugin Not Found" };

  const title = `${plugin.name} — Payload Plugin Directory`;
  const description = plugin.description.slice(0, 160);

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

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plugin = getPluginById(id);
  if (!plugin) notFound();

  const filteredTopics = plugin.topics.filter((t) => t !== "payload-plugin");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: plugin.name,
    description: plugin.description,
    url: `https://payloaddirectory.dev/plugins/${plugin.id}`,
    applicationCategory: "Plugin",
    operatingSystem: "Node.js",
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
    : getHealthDisplay(healthScore);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back navigation */}
        <Link
          href="/"
          replace
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to directory
        </Link>

        {/* Plugin header */}
        <header className="mb-8">
          <div className="flex items-start gap-4">
            <img
              src={plugin.ownerAvatar}
              alt={plugin.owner}
              className="w-14 h-14 rounded-full ring-2 ring-border"
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
            </div>
          </div>

          {/* Version & license badges */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {plugin.payloadVersionMajor.map((v) => (
              <Badge
                key={v}
                variant="secondary"
                className={`${versionColors[v] || "bg-gray-100"} text-xs font-medium`}
              >
                <PayloadIcon className="h-3 w-3 mr-1" />
                {v === 0 ? "v?" : `v${v}`}
              </Badge>
            ))}
            {plugin.payloadVersion && (
              <Badge variant="outline" className="text-xs font-normal font-mono">
                {plugin.payloadVersion}
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

        {/* Description */}
        <p className="text-muted-foreground leading-relaxed mb-8">
          {plugin.description}
        </p>

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
                    <p className="text-lg font-semibold">{formatDownloads(plugin.npm.weeklyDownloads)}</p>
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

        {/* Readme preview */}
        {plugin.readme && (
          <Card className="mb-8">
            <CardContent className="p-6">
              <p className="text-xs font-medium text-muted-foreground mb-3">About</p>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed bg-transparent p-0 m-0 border-0">
                  {plugin.readme}
                </pre>
              </div>
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
          {!plugin.isOfficial && (
            <a
              href={`https://github.com/elghaied/payload-plugins-directory/issues/new?title=${encodeURIComponent(`Report: ${plugin.name}`)}&body=${encodeURIComponent(`**Plugin ID:** ${plugin.id}\n**Name:** ${plugin.name}\n**Owner:** ${plugin.owner}\n**URL:** ${plugin.url}\n\n**Reason for report:**\n`)}&labels=report`}
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
