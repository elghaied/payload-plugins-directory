"use client";

import React, { useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  GitFork,
  Star,
  Clock,
  Github,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Package,
  Scale,
  AlertCircle,
  SortAsc,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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

const ITEMS_PER_PAGE = 24;

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

function PluginCard({ plugin }: { plugin: Plugin }) {
  return (
    <Card className="group h-full flex flex-col hover:shadow-lg hover:border-primary/20 transition-all duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <img
            src={plugin.ownerAvatar}
            alt={plugin.owner}
            className="w-10 h-10 rounded-full ring-2 ring-background"
            loading="lazy"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/plugins/${plugin.id}`}
                className="font-semibold text-lg hover:text-primary transition-colors capitalize truncate"
              >
                {plugin.name}
              </Link>
              {plugin.isOfficial && (
                <Badge className="bg-blue-500 text-white hover:bg-blue-600 text-xs">
                  Official
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
              <span className="truncate">by {plugin.owner}</span>
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
                <span
                  key={topic}
                  className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full text-xs"
                >
                  {topic}
                </span>
              ))}
            {plugin.topics.filter((t) => t !== "payload-plugin").length > 4 && (
              <span className="px-2 py-0.5 text-muted-foreground text-xs">
                +{plugin.topics.filter((t) => t !== "payload-plugin").length - 4}
              </span>
            )}
          </div>
        )}

        <a
          href={plugin.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md transition-colors text-sm font-medium cursor-pointer hover:bg-primary hover:text-primary-foreground"
        >
          View on GitHub
          <ExternalLink className="h-4 w-4" />
        </a>
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
  const currentPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === "all" || value === "featured" || (key === "page" && value === "1")) {
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

        return matchesSearch && matchesVersion && matchesSource;
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
          case "name":
            return a.name.localeCompare(b.name);
          default:
            return 0;
        }
      });
  }, [plugins, searchTerm, sortBy, versionFilter, sourceFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedPlugins.length / ITEMS_PER_PAGE);
  const paginatedPlugins = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedPlugins.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedPlugins, currentPage]);

  // Reset to page 1 when filters change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ q: e.target.value, page: null });
    },
    [updateParams]
  );

  const handleVersionChange = useCallback((value: VersionFilter) => {
    updateParams({ version: value, page: null });
  }, [updateParams]);

  const handleSortChange = useCallback((value: SortOption) => {
    updateParams({ sort: value, page: null });
  }, [updateParams]);

  const handleSourceChange = useCallback((value: SourceFilter) => {
    updateParams({ source: value, page: null });
  }, [updateParams]);

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
              <ModeToggle />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mt-6 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <Badge
                variant="outline"
                className={`${versionColors[3]} border-0 cursor-pointer hover:opacity-80`}
                onClick={() =>
                  handleVersionChange(versionFilter === "3" ? "all" : "3")
                }
              >
                v3: {stats.v3}
              </Badge>
              <Badge
                variant="outline"
                className={`${versionColors[2]} border-0 cursor-pointer hover:opacity-80`}
                onClick={() =>
                  handleVersionChange(versionFilter === "2" ? "all" : "2")
                }
              >
                v2: {stats.v2}
              </Badge>
              <Badge
                variant="outline"
                className={`${versionColors[1]} border-0 cursor-pointer hover:opacity-80`}
                onClick={() =>
                  handleVersionChange(versionFilter === "1" ? "all" : "1")
                }
              >
                v1: {stats.v1}
              </Badge>
              <Badge
                variant="outline"
                className={`${versionColors[0]} border-0 cursor-pointer hover:opacity-80`}
                onClick={() =>
                  handleVersionChange(versionFilter === "0" ? "all" : "0")
                }
              >
                v?: {stats.unknown}
              </Badge>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2 text-sm">
              <Badge
                variant="outline"
                className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0 cursor-pointer hover:opacity-80"
                onClick={() =>
                  handleSourceChange(sourceFilter === "official" ? "all" : "official")
                }
              >
                Official: {stats.official}
              </Badge>
              <Badge
                variant="outline"
                className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-0 cursor-pointer hover:opacity-80"
                onClick={() =>
                  handleSourceChange(sourceFilter === "community" ? "all" : "community")
                }
              >
                Community: {stats.community}
              </Badge>
            </div>
          </div>
        </header>

        {/* Filters */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-4 -mx-4 px-4 border-b mb-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plugins by name, description, topic, or author..."
                className="pl-10"
                value={searchTerm}
                onChange={handleSearchChange}
              />
            </div>

            <Select value={versionFilter} onValueChange={handleVersionChange}>
              <SelectTrigger className="w-full sm:w-40">
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
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="official">Official</SelectItem>
                <SelectItem value="community">Community</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-44">
                <SortAsc className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="stars">Most Stars</SelectItem>
                <SelectItem value="forks">Most Forks</SelectItem>
                <SelectItem value="recent">Recently Updated</SelectItem>
                <SelectItem value="created">Recently Created</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            Showing {paginatedPlugins.length} of {filteredAndSortedPlugins.length}{" "}
            plugins
            {searchTerm && (
              <span>
                {" "}
                matching &ldquo;<span className="font-medium">{searchTerm}</span>
                &rdquo;
              </span>
            )}
          </p>
          {totalPages > 1 && (
            <p className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </p>
          )}
        </div>

        {/* Plugin grid */}
        {paginatedPlugins.length === 0 ? (
          <div className="text-center py-16">
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
                updateParams({ q: null, version: null, source: null, sort: null, page: null });
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <>
            <main className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedPlugins.map((plugin) => (
                <PluginCard key={plugin.id} plugin={plugin} />
              ))}
            </main>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => updateParams({ page: String(Math.max(1, currentPage - 1)) })}
                  disabled={currentPage === 1}
                  className="cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((page) => {
                      // Show first, last, current, and pages around current
                      return (
                        page === 1 ||
                        page === totalPages ||
                        Math.abs(page - currentPage) <= 1
                      );
                    })
                    .map((page, index, array) => {
                      // Add ellipsis if there's a gap
                      const prevPage = array[index - 1];
                      const showEllipsis = prevPage && page - prevPage > 1;

                      return (
                        <React.Fragment key={page}>
                          {showEllipsis && (
                            <span className="px-2 text-muted-foreground">
                              ...
                            </span>
                          )}
                          <Button
                            variant={
                              currentPage === page ? "default" : "outline"
                            }
                            size="icon"
                            onClick={() => updateParams({ page: String(page) })}
                            className="w-10 cursor-pointer"
                          >
                            {page}
                          </Button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    updateParams({ page: String(Math.min(totalPages, currentPage + 1)) })
                  }
                  disabled={currentPage === totalPages}
                  className="cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </nav>
            )}
          </>
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
    </div>
  );
};
