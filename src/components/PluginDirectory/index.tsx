"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  GitFork,
  Star,
  Clock,
  Github,
  ExternalLink,
  Package,
  Scale,
  AlertCircle,
  SortAsc,
  Copy,
  Check,
  Sparkles,
  Rss,
  BarChart3,
  Download,
  Box,
  Info,
  Flag,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plugin, SortOption, VersionFilter } from "../../types";
import { PayloadIcon } from "../PayloadIcon";
import { ModeToggle } from "../mode-toggler";
import { ComparisonView } from "../ComparisonView";

const ROW_HEIGHT_ESTIMATE = 420;

interface PluginDirectoryProps {
  plugins: Plugin[];
  metadata: {
    lastUpdated: string;
    totalCount: number;
  };
}

const versionColors: Record<number, string> = {
  0: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300", // Unknown version
  1: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

type SourceFilter = "all" | "official" | "community";

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
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return num.toString();
}

function getHealthDisplay(plugin: Plugin): { color: string; label: string; score: number } {
  const score = plugin.healthScore ?? 0;
  if (plugin.isArchived) return { color: "bg-red-500", label: "Archived", score: 0 };
  if (score >= 75) return { color: "bg-emerald-500", label: "Excellent", score };
  if (score >= 50) return { color: "bg-green-500", label: "Good", score };
  if (score >= 25) return { color: "bg-yellow-500", label: "Fair", score };
  return { color: "bg-orange-500", label: "Poor", score };
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDownloads(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function CopyInstallButton({ packageName }: { packageName: string }) {
  const [copied, setCopied] = useState(false);
  const command = `npm i ${packageName}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  return (
    <div className="flex items-center gap-1.5 mt-3 px-2.5 py-1.5 bg-secondary/50 rounded-md">
      <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
        {command}
      </code>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded hover:bg-secondary transition-colors cursor-pointer"
        title="Copy install command"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

function PluginCard({ plugin, onTopicClick, onOwnerClick, compareMode, isSelected, onToggleSelect }: { plugin: Plugin; onTopicClick?: (topic: string) => void; onOwnerClick?: (owner: string) => void; compareMode?: boolean; isSelected?: boolean; onToggleSelect?: (id: string) => void }) {
  const health = getHealthDisplay(plugin);

  return (
    <Card className={`group h-full flex flex-col hover:shadow-lg transition-all duration-200 ${isSelected ? "ring-2 ring-primary border-primary/40" : "hover:border-primary/20"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {compareMode && (
            <button
              onClick={() => onToggleSelect?.(plugin.id)}
              className={`shrink-0 mt-1 h-5 w-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"}`}
            >
              {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
            </button>
          )}
          <button onClick={() => onOwnerClick?.(plugin.owner)} className="shrink-0 cursor-pointer" title={`View all plugins by ${plugin.owner}`}>
            <img
              src={plugin.ownerAvatar}
              alt={plugin.owner}
              className="w-10 h-10 rounded-full ring-2 ring-background hover:ring-primary transition-all"
              loading="lazy"
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-lg capitalize truncate">
                {plugin.readme ? (
                  <HoverCard>
                    <HoverCardTrigger asChild>
                      <Link
                        href={`/plugins/${plugin.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {plugin.name}
                      </Link>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80">
                      <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-[8] font-normal">
                        {plugin.readme}
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                ) : (
                  <Link
                    href={`/plugins/${plugin.id}`}
                    className="hover:text-primary transition-colors"
                  >
                    {plugin.name}
                  </Link>
                )}
              </h3>
              {plugin.isOfficial && (
                <Badge className="bg-blue-500 text-white hover:bg-blue-600 text-xs">
                  Official
                </Badge>
              )}
              <HoverCard>
                <HoverCardTrigger asChild>
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 cursor-default ${health.color}`}
                    title={health.label}
                  />
                </HoverCardTrigger>
                <HoverCardContent className="w-56">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Health Score</span>
                      <span className="text-xs font-bold">{health.score}/100</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${health.color}`}
                        style={{ width: `${health.score}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{health.label}</p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
              <button
                onClick={() => onOwnerClick?.(plugin.owner)}
                className="truncate hover:text-primary hover:underline transition-colors cursor-pointer"
              >
                by {plugin.owner}
              </button>
              {plugin.collection && (
                <Badge
                  variant="outline"
                  className="text-xs font-normal"
                  title={`Part of ${plugin.collection} collection`}
                >
                  <Package className="h-3 w-3 mr-1" />
                  {plugin.collection}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
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
          {plugin.npm?.latestVersion && (
            <Badge variant="outline" className="text-xs font-normal font-mono">
              v{plugin.npm.latestVersion}
            </Badge>
          )}
          {plugin.npm?.unpackedSize != null && (
            <Badge variant="outline" className="text-xs font-normal">
              <Box className="h-3 w-3 mr-1" />
              {formatSize(plugin.npm.unpackedSize)}
            </Badge>
          )}
          {plugin.license && (
            <Badge variant="outline" className="text-xs font-normal">
              <Scale className="h-3 w-3 mr-1" />
              {plugin.license}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col pt-0">
        <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
          {plugin.description}
        </p>

        {plugin.packageName && (
          <CopyInstallButton packageName={plugin.packageName} />
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <span
              className="flex items-center gap-1"
              title={`${plugin.stars} stars`}
            >
              <Star className="h-4 w-4 text-amber-500" />
              {formatNumber(plugin.stars)}
            </span>
            <span
              className="flex items-center gap-1"
              title={`${plugin.forks} forks`}
            >
              <GitFork className="h-4 w-4" />
              {formatNumber(plugin.forks)}
            </span>
            {plugin.openIssues > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${plugin.openIssues} open issues`}
              >
                <AlertCircle className="h-4 w-4" />
                {plugin.openIssues}
              </span>
            )}
            {plugin.npm?.weeklyDownloads != null && plugin.npm.weeklyDownloads > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${plugin.npm.weeklyDownloads.toLocaleString()} weekly downloads`}
              >
                <Download className="h-4 w-4 text-violet-500" />
                {formatDownloads(plugin.npm.weeklyDownloads)}/wk
              </span>
            )}
          </div>
          <span
            className="flex items-center gap-1 text-xs"
            title={formatDate(plugin.lastUpdate)}
          >
            <Clock className="h-3.5 w-3.5" />
            {formatRelativeTime(plugin.lastUpdate)}
          </span>
        </div>

        {plugin.topics.filter((t) => t !== "payload-plugin").length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {plugin.topics
              .filter((t) => t !== "payload-plugin")
              .slice(0, 4)
              .map((topic) => (
                <button
                  key={topic}
                  onClick={() => onTopicClick?.(topic)}
                  className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full text-xs cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
                >
                  {topic}
                </button>
              ))}
            {plugin.topics.filter((t) => t !== "payload-plugin").length > 4 && (
              <span className="px-2 py-0.5 text-muted-foreground text-xs">
                +{plugin.topics.filter((t) => t !== "payload-plugin").length - 4}
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <a
            href={plugin.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md transition-colors text-sm font-medium cursor-pointer hover:bg-primary hover:text-primary-foreground"
          >
            View on GitHub
            <ExternalLink className="h-4 w-4" />
          </a>
          {!plugin.isOfficial && (
            <a
              href={`https://github.com/elghaied/payload-plugins-directory/issues/new?title=${encodeURIComponent(`Report: ${plugin.name}`)}&body=${encodeURIComponent(`**Plugin ID:** ${plugin.id}\n**Name:** ${plugin.name}\n**Owner:** ${plugin.owner}\n**URL:** ${plugin.url}\n\n**Reason for report:**\n`)}&labels=report`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-md bg-secondary text-muted-foreground transition-colors cursor-pointer hover:bg-destructive/10 hover:text-destructive"
              title="Report this plugin"
            >
              <Flag className="h-4 w-4" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export const PluginDirectory: React.FC<PluginDirectoryProps> = ({
  plugins,
  metadata,
}) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  const searchTerm = searchParams.get("q") || "";
  const sortBy = (searchParams.get("sort") as SortOption) || "featured";
  const versionFilter = (searchParams.get("version") as VersionFilter) || "all";
  const sourceFilter = (searchParams.get("source") as SourceFilter) || "all";
  const licenseFilter = searchParams.get("license") || "all";

  const licenses = useMemo(() => {
    const set = new Set(plugins.map((p) => p.license).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [plugins]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === "all" || value === "featured") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "/", { scroll: false });
    },
    [searchParams, router]
  );

  // Memoize filtered and sorted plugins
  const filteredAndSortedPlugins = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();

    // For "featured" sort: official plugins inherit the payload monorepo's
    // stars (~40k), which vastly inflates their ranking. Compute a fair
    // score by using the median of the top 10 community plugins' stars,
    // so official plugins rank among popular community ones, not above all.
    const communityByStars = plugins
      .filter((p) => !p.isOfficial)
      .map((p) => p.stars)
      .sort((a, b) => b - a);
    const top10 = communityByStars.slice(0, 10);
    const officialEffectiveStars =
      top10.length > 0
        ? top10[Math.floor(top10.length / 2)]
        : 0;

    return plugins
      .filter((plugin) => {
        const matchesSearch =
          !searchTerm ||
          plugin.name.toLowerCase().includes(searchLower) ||
          plugin.description.toLowerCase().includes(searchLower) ||
          plugin.topics.some((topic) =>
            topic.toLowerCase().includes(searchLower)
          ) ||
          plugin.owner.toLowerCase().includes(searchLower) ||
          (plugin.packageName?.toLowerCase().includes(searchLower) ?? false);

        const matchesVersion =
          versionFilter === "all" ||
          plugin.payloadVersionMajor.includes(parseInt(versionFilter));

        const matchesSource =
          sourceFilter === "all" ||
          (sourceFilter === "official" && plugin.isOfficial) ||
          (sourceFilter === "community" && !plugin.isOfficial);

        const matchesLicense =
          licenseFilter === "all" || plugin.license === licenseFilter;

        return matchesSearch && matchesVersion && matchesSource && matchesLicense;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "featured": {
            // Official plugins inherit the payload repo's stars (~40k),
            // which isn't representative of the individual plugin's popularity.
            // Cap official plugin stars to the max community plugin stars
            // so they appear near the top but don't dominate the list.
            const aStars = a.isOfficial ? officialEffectiveStars : a.stars;
            const bStars = b.isOfficial ? officialEffectiveStars : b.stars;
            if (bStars !== aStars) return bStars - aStars;
            return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
          }
          case "stars":
            return b.stars - a.stars;
          case "forks":
            return b.forks - a.forks;
          case "recent":
            return (
              new Date(b.lastUpdate).getTime() -
              new Date(a.lastUpdate).getTime()
            );
          case "created":
            return (
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          case "downloads":
            return (b.npm?.weeklyDownloads ?? 0) - (a.npm?.weeklyDownloads ?? 0);
          case "health":
            return (b.healthScore ?? 0) - (a.healthScore ?? 0);
          case "name":
            return a.name.localeCompare(b.name);
          default:
            return 0;
        }
      });
  }, [plugins, searchTerm, sortBy, versionFilter, sourceFilter, licenseFilter]);

  // Responsive column count
  const [columnCount, setColumnCount] = useState(3);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setColumnCount(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const rowCount = Math.ceil(filteredAndSortedPlugins.length / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 3,
  });

  // Scroll to top when filters change
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [searchTerm, sortBy, versionFilter, sourceFilter, licenseFilter]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ q: e.target.value });
    },
    [updateParams]
  );

  const handleVersionChange = useCallback((value: VersionFilter) => {
    updateParams({ version: value });
  }, [updateParams]);

  const handleSortChange = useCallback((value: SortOption) => {
    updateParams({ sort: value });
  }, [updateParams]);

  const handleSourceChange = useCallback((value: SourceFilter) => {
    updateParams({ source: value });
  }, [updateParams]);

  const handleLicenseChange = useCallback((value: string) => {
    updateParams({ license: value });
  }, [updateParams]);

  const handleTopicClick = useCallback((topic: string) => {
    updateParams({ q: topic });
  }, [updateParams]);

  const handleOwnerClick = useCallback((owner: string) => {
    updateParams({ q: owner });
  }, [updateParams]);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const selectedPlugins = useMemo(
    () => plugins.filter((p) => selectedIds.has(p.id)),
    [plugins, selectedIds]
  );

  const handleRemoveFromComparison = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Stats
  const stats = useMemo(() => {
    const result = { v1: 0, v2: 0, v3: 0, unknown: 0, official: 0, community: 0 };
    plugins.forEach((p) => {
      if (p.payloadVersionMajor.includes(0)) result.unknown++;
      if (p.payloadVersionMajor.includes(1)) result.v1++;
      if (p.payloadVersionMajor.includes(2)) result.v2++;
      if (p.payloadVersionMajor.includes(3)) result.v3++;
      if (p.isOfficial) result.official++;
      else result.community++;
    });
    return result;
  }, [plugins]);

  // Recently added plugins (last 90 days), shown only on unfiltered view
  const recentlyAdded = useMemo(() => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return [...plugins]
      .filter((p) => new Date(p.createdAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 4);
  }, [plugins]);

  const showRecentlyAdded =
    recentlyAdded.length > 0 &&
    !searchTerm &&
    versionFilter === "all" &&
    sourceFilter === "all" &&
    licenseFilter === "all" &&
    sortBy === "featured";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Payload CMS Plugin Directory
              </h1>
              <p className="text-muted-foreground mt-2">
                Discover {metadata.totalCount} community-made plugins for
                Payload CMS
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Last updated: {formatRelativeTime(metadata.lastUpdated)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/payloadcms/payload"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full h-9 w-9 bg-background border flex items-center justify-center hover:bg-secondary transition-colors"
                aria-label="Payload CMS GitHub"
              >
                <PayloadIcon className="h-4 w-4" />
              </a>
              <a
                href="https://github.com/elghaied/payload-plugins-directory"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full h-9 w-9 bg-background border flex items-center justify-center hover:bg-secondary transition-colors"
                aria-label="Directory GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
              <Link
                href="/stats"
                className="rounded-full h-9 w-9 bg-background border flex items-center justify-center hover:bg-secondary transition-colors"
                aria-label="Ecosystem Stats"
              >
                <BarChart3 className="h-4 w-4" />
              </Link>
              <Link
                href="/about"
                className="rounded-full h-9 w-9 bg-background border flex items-center justify-center hover:bg-secondary transition-colors"
                aria-label="About"
              >
                <Info className="h-4 w-4" />
              </Link>
              <a
                href="/feed.xml"
                className="rounded-full h-9 w-9 bg-background border flex items-center justify-center hover:bg-secondary transition-colors"
                aria-label="RSS Feed"
              >
                <Rss className="h-4 w-4" />
              </a>
              <ModeToggle />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mt-6 flex-wrap" role="group" aria-label="Quick filters">
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => handleVersionChange(versionFilter === "3" ? "all" : "3")}
                aria-pressed={versionFilter === "3"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className={`${versionColors[3]} border-0 hover:opacity-80`}>
                  v3: {stats.v3}
                </Badge>
              </button>
              <button
                onClick={() => handleVersionChange(versionFilter === "2" ? "all" : "2")}
                aria-pressed={versionFilter === "2"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className={`${versionColors[2]} border-0 hover:opacity-80`}>
                  v2: {stats.v2}
                </Badge>
              </button>
              <button
                onClick={() => handleVersionChange(versionFilter === "1" ? "all" : "1")}
                aria-pressed={versionFilter === "1"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className={`${versionColors[1]} border-0 hover:opacity-80`}>
                  v1: {stats.v1}
                </Badge>
              </button>
              <button
                onClick={() => handleVersionChange(versionFilter === "0" ? "all" : "0")}
                aria-pressed={versionFilter === "0"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className={`${versionColors[0]} border-0 hover:opacity-80`}>
                  v?: {stats.unknown}
                </Badge>
              </button>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => handleSourceChange(sourceFilter === "official" ? "all" : "official")}
                aria-pressed={sourceFilter === "official"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0 hover:opacity-80">
                  Official: {stats.official}
                </Badge>
              </button>
              <button
                onClick={() => handleSourceChange(sourceFilter === "community" ? "all" : "community")}
                aria-pressed={sourceFilter === "community"}
                className="cursor-pointer"
              >
                <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-0 hover:opacity-80">
                  Community: {stats.community}
                </Badge>
              </button>
            </div>
          </div>
        </header>

        {/* Filters */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-4 -mx-4 px-4 border-b mb-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <label htmlFor="plugin-search" className="sr-only">Search plugins</label>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="plugin-search"
                placeholder="Search plugins by name, description, topic, or author..."
                className="pl-10"
                value={searchTerm}
                onChange={handleSearchChange}
              />
            </div>

            <Select value={versionFilter} onValueChange={handleVersionChange}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by version">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Versions</SelectItem>
                <SelectItem value="3">Payload v3</SelectItem>
                <SelectItem value="2">Payload v2</SelectItem>
                <SelectItem value="1">Payload v1</SelectItem>
                <SelectItem value="0">Unknown (v?)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={handleSourceChange}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="official">Official</SelectItem>
                <SelectItem value="community">Community</SelectItem>
              </SelectContent>
            </Select>

            <Select value={licenseFilter} onValueChange={handleLicenseChange}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by license">
                <SelectValue placeholder="License" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Licenses</SelectItem>
                {licenses.map((lic) => (
                  <SelectItem key={lic} value={lic}>
                    {lic}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Sort plugins">
                <SortAsc className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="stars">Most Stars</SelectItem>
                <SelectItem value="downloads">Most Downloads</SelectItem>
                <SelectItem value="health">Health Score</SelectItem>
                <SelectItem value="forks">Most Forks</SelectItem>
                <SelectItem value="recent">Recently Updated</SelectItem>
                <SelectItem value="created">Recently Created</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={compareMode ? "default" : "outline"}
              size="default"
              onClick={handleToggleCompareMode}
              className="w-full sm:w-auto cursor-pointer"
            >
              {compareMode ? "Exit Compare" : "Compare"}
            </Button>
          </div>
        </div>

        {/* Recently Added */}
        {showRecentlyAdded && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              Recently Added
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recentlyAdded.map((plugin) => (
                <Link
                  key={plugin.id}
                  href={`/plugins/${plugin.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:shadow-md hover:border-primary/20 transition-all"
                >
                  <img
                    src={plugin.ownerAvatar}
                    alt={plugin.owner}
                    className="w-8 h-8 rounded-full"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize truncate">{plugin.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {formatRelativeTime(plugin.createdAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            {filteredAndSortedPlugins.length} plugins
            {searchTerm && (
              <span>
                {" "}
                matching &ldquo;<span className="font-medium">{searchTerm}</span>
                &rdquo;
              </span>
            )}
          </p>
        </div>

        {/* Plugin grid */}
        {filteredAndSortedPlugins.length === 0 ? (
          <div className="text-center py-16" role="status">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-secondary mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No plugins found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Try adjusting your search or filter criteria to find what
              you&apos;re looking for.
            </p>
            <Button
              variant="outline"
              className="mt-4 cursor-pointer"
              onClick={() => {
                updateParams({ q: null, version: null, source: null, license: null, sort: null });
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ height: "calc(100vh - 200px)" }}
          >
            <main
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const startIndex = virtualRow.index * columnCount;
                const rowPlugins = filteredAndSortedPlugins.slice(
                  startIndex,
                  startIndex + columnCount
                );
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 w-full grid gap-6"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    }}
                  >
                    {rowPlugins.map((plugin) => (
                      <PluginCard
                        key={plugin.id}
                        plugin={plugin}
                        onTopicClick={handleTopicClick}
                        onOwnerClick={handleOwnerClick}
                        compareMode={compareMode}
                        isSelected={selectedIds.has(plugin.id)}
                        onToggleSelect={handleToggleSelect}
                      />
                    ))}
                  </div>
                );
              })}
            </main>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>
            Want to add your plugin? Add the{" "}
            <code className="px-1.5 py-0.5 bg-secondary rounded">
              payload-plugin
            </code>{" "}
            topic to your GitHub repository.
          </p>
          <p className="mt-2">
            Data is automatically refreshed twice daily via GitHub Actions.
          </p>
        </footer>
      </div>

      {/* Floating compare bar */}
      {compareMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-background border shadow-lg rounded-full px-5 py-2.5 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            disabled={selectedIds.size < 2}
            className="cursor-pointer rounded-full"
            onClick={() => {/* ComparisonView will show */}}
          >
            Compare
          </Button>
        </div>
      )}

      {/* Comparison view */}
      {compareMode && selectedIds.size >= 2 && (
        <ComparisonView
          plugins={selectedPlugins}
          onRemove={handleRemoveFromComparison}
          onClose={() => {
            setCompareMode(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
};
