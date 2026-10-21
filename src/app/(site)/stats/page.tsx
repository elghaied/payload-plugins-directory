import { computeStats, versionAdoption } from "@/lib/directory/stats";
import { OG_IMAGES } from "@/lib/siteOg";
import { getDirectoryMeta, getPluginSummaries } from "@/lib/directory/queries";
import { Metadata } from "next";
import { TrendChart } from "@/components/trends/TrendChart";
import { daysBetween, formatDay, utcToday } from "@/lib/trends/days";
import { HISTORY_DAYS } from "@/lib/trends/growth";
import { getEcosystemGrowth } from "@/lib/trends/queries";
import type { EcosystemGrowth } from "@/lib/trends/types";

export const metadata: Metadata = {
  title: "Ecosystem Stats — Payload Directory",
  description:
    "Statistics about the Payload CMS plugin ecosystem: growth over time, Payload version adoption, top contributors, licenses and downloads.",
  alternates: { canonical: "/stats" },
  openGraph: {
    url: "/stats",
    images: OG_IMAGES,
    title: "Ecosystem Stats — Payload Directory",
    description:
      "Statistics about the Payload CMS plugin ecosystem: growth over time, Payload version adoption, top contributors, licenses and downloads.",
  },
};

function Bar({
  value,
  max,
  color,
  label,
  count,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  count: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="text-xs sm:text-sm text-muted-foreground w-16 sm:w-20 shrink-0 text-right truncate">
        {label}
      </span>
      <div className="flex-1 bg-secondary rounded-full h-5 sm:h-6 overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="text-xs sm:text-sm font-medium w-8 sm:w-10 text-right">{count}</span>
    </div>
  );
}

function formatDownloads(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

// Same per-major hues as the existing version badges; identity is carried by the text label, not colour alone.
const ADOPTION_COLORS: Record<string, string> = {
  "4": "bg-violet-500",
  "3": "bg-emerald-500",
  "2": "bg-blue-500",
  "1": "bg-amber-500",
  unknown: "bg-gray-400",
};

export const dynamic = "force-dynamic";

// A snapshot-query failure must not take down the rest of the stats page.
async function loadGrowth(): Promise<EcosystemGrowth | null> {
  try {
    return await getEcosystemGrowth();
  } catch (error) {
    console.error("[stats] getEcosystemGrowth failed", error);
    return null;
  }
}

export default async function StatsPage() {
  const [plugins, meta, growth] = await Promise.all([getPluginSummaries(), getDirectoryMeta(), loadGrowth()]);
  const stats = computeStats(plugins);
  const adoption = versionAdoption(plugins);
  const staleGrowth = growth?.lastSnapshotDay != null && daysBetween(growth.lastSnapshotDay, utcToday()) > 2;

  const maxLicense = stats.licenseDistribution[0]?.[1] || 1;
  const maxMonth = Math.max(...stats.months.map((m) => m.count), 1);

  const maxSizeBucket = Math.max(...Object.values(stats.sizeDistribution), 1);
  const maxHealthBucket = Math.max(...Object.values(stats.healthDistribution), 1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      {/* A degraded render answers 200: keep it out of the index (React hoists this into <head>). */}
      {!growth && <meta name="robots" content="noindex" />}
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Ecosystem Stats
          </h1>
          <p className="text-muted-foreground mt-1">
            Last updated: {new Date(meta.lastUpdated).toLocaleDateString()}
          </p>
        </div>

        {/* Quick numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
          {[
            { label: "Total Plugins", value: stats.total.toLocaleString() },
            { label: "Weekly Downloads", value: formatDownloads(stats.totalDownloadsWeekly) },
            { label: "Avg Health Score", value: stats.avgHealth.toString() },
            { label: "Official", value: stats.official.toLocaleString() },
            { label: "Community", value: stats.community.toLocaleString() },
            { label: "On npm", value: stats.pluginsWithNpmCount.toLocaleString() },
            { label: "Avg Stars", value: stats.avgStars.toLocaleString() },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-card border rounded-lg p-3 sm:p-4 text-center"
            >
              <p className="text-xl sm:text-2xl font-bold">{item.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>

        {/* Ecosystem growth (snapshots) */}
        <section aria-labelledby="growth-heading" className="bg-card border rounded-lg p-4 sm:p-5 mb-8 sm:mb-10">
          <h2 id="growth-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ecosystem Growth (last {HISTORY_DAYS} days)
          </h2>
          {growth ? (
            <div className="grid gap-6 md:grid-cols-2 mt-4">
              <TrendChart
                title="Total GitHub stars"
                metric="Total stars"
                tone="stars"
                series={growth.stars}
                outdated={growth.outdated?.stars}
                footnote="Across repositories of listed plugins; a monorepo is counted once."
              />
              <TrendChart
                title="Total npm weekly downloads"
                metric="Total weekly downloads"
                tone="downloads"
                series={growth.downloads}
                outdated={growth.outdated?.downloads}
                footnote="Sum of npm weekly downloads across listed plugins."
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Growth data is unavailable right now.</p>
          )}
          {staleGrowth && growth?.lastSnapshotDay && (
            <p className="mt-2 text-xs text-muted-foreground">Data as of {formatDay(growth.lastSnapshotDay, true)}</p>
          )}
        </section>

        <div className="grid gap-4 sm:gap-8 md:grid-cols-2 [&>section]:min-w-0">
          {/* Most downloaded */}
          {stats.mostDownloaded.length > 0 && (
            <section className="bg-card border rounded-lg p-4 sm:p-5">
              <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
                Most Downloaded (Weekly)
              </h2>
              <div className="space-y-3">
                {stats.mostDownloaded.map((plugin, i) => (
                  <div key={plugin.packageName} className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">
                      {i + 1}.
                    </span>
                    <img
                      src={plugin.avatar}
                      alt={plugin.owner}
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-full"
                    />
                    <span className="text-xs sm:text-sm flex-1 truncate capitalize">{plugin.name}</span>
                    <span className="text-xs sm:text-sm font-medium font-mono">
                      {formatDownloads(plugin.weeklyDownloads)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Most downloaded community plugins */}
          {stats.mostDownloadedCommunity.length > 0 && (
            <section className="bg-card border rounded-lg p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-bl-lg">
                Community
              </div>
              <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
                Top Community Plugins (Weekly)
              </h2>
              <div className="space-y-3">
                {stats.mostDownloadedCommunity.map((plugin, i) => (
                  <div key={plugin.packageName} className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">
                      {i + 1}.
                    </span>
                    <img
                      src={plugin.avatar}
                      alt={plugin.owner}
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-full ring-2 ring-emerald-500/20"
                    />
                    <span className="text-xs sm:text-sm flex-1 truncate capitalize">{plugin.name}</span>
                    <span className="text-xs sm:text-sm font-medium font-mono">
                      {formatDownloads(plugin.weeklyDownloads)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Version adoption */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
              Payload Version Adoption
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Share of plugins supporting each major (a plugin can support several), and their share of weekly downloads.
            </p>
            <div className="space-y-3">
              {adoption.map((row) => (
                <div key={row.major}>
                  <div className="flex items-baseline justify-between text-xs sm:text-sm">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums">
                      {row.plugins} plugin{row.plugins !== 1 ? "s" : ""} · {Math.round(row.pluginShare * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${ADOPTION_COLORS[row.major]}`}
                      style={{ width: `${row.plugins > 0 ? Math.max(row.pluginShare * 100, 2) : 0}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] sm:text-xs text-muted-foreground tabular-nums">
                    {Math.round(row.downloadShare * 100)}% of weekly downloads
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Health Score Distribution */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              Health Score Distribution
            </h2>
            <div className="space-y-3">
              <Bar
                label="Excellent"
                value={stats.healthDistribution.excellent}
                max={maxHealthBucket}
                count={stats.healthDistribution.excellent}
                color="bg-emerald-500"
              />
              <Bar
                label="Good"
                value={stats.healthDistribution.good}
                max={maxHealthBucket}
                count={stats.healthDistribution.good}
                color="bg-green-500"
              />
              <Bar
                label="Fair"
                value={stats.healthDistribution.fair}
                max={maxHealthBucket}
                count={stats.healthDistribution.fair}
                color="bg-yellow-500"
              />
              <Bar
                label="Poor"
                value={stats.healthDistribution.poor}
                max={maxHealthBucket}
                count={stats.healthDistribution.poor}
                color="bg-orange-500"
              />
            </div>
          </section>

          {/* Package Size Distribution */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              Package Size Distribution
            </h2>
            <div className="space-y-3">
              {(Object.entries(stats.sizeDistribution) as [string, number][]).map(([bucket, count]) => (
                <Bar
                  key={bucket}
                  label={bucket}
                  value={count}
                  max={maxSizeBucket}
                  count={count}
                  color="bg-violet-500/70"
                />
              ))}
            </div>
          </section>

          {/* License breakdown */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              License Breakdown
            </h2>
            <div className="space-y-2">
              {stats.licenseDistribution.slice(0, 8).map(([license, count]) => (
                <Bar
                  key={license}
                  label={license}
                  value={count}
                  max={maxLicense}
                  count={count}
                  color="bg-primary/70"
                />
              ))}
            </div>
          </section>

          {/* Top contributors */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              Top Contributors
            </h2>
            <div className="space-y-3">
              {stats.topAuthors.map((author, i) => (
                <div key={author.name} className="flex items-center gap-2 sm:gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right">
                    {i + 1}.
                  </span>
                  <img
                    src={author.avatar}
                    alt={author.name}
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full"
                  />
                  <span className="text-xs sm:text-sm flex-1 truncate">{author.name}</span>
                  <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
                    {author.count} plugin{author.count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Growth over time */}
          <section className="bg-card border rounded-lg p-4 sm:p-5 md:col-span-2">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              New Plugins (Last 12 Months)
            </h2>
            <div className="flex items-end gap-1 sm:gap-1.5 h-32 sm:h-40">
              {stats.months.map((month) => (
                <div
                  key={month.label}
                  className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
                >
                  <span className="text-[8px] sm:text-[10px] text-muted-foreground mb-1">
                    {month.count > 0 ? month.count : ""}
                  </span>
                  <div
                    className="w-full bg-primary/60 rounded-t transition-all"
                    style={{
                      height: `${Math.max((month.count / maxMonth) * 100, month.count > 0 ? 4 : 0)}%`,
                    }}
                  />
                  <span className="text-[7px] sm:text-[9px] text-muted-foreground mt-1 sm:mt-1.5 rotate-[-45deg] origin-top-left whitespace-nowrap">
                    {month.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Additional quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 sm:mt-8">
          {[
            { label: "Total Stars", value: stats.totalStars.toLocaleString() },
            { label: "Total Forks", value: stats.totalForks.toLocaleString() },
            { label: "Median Stars", value: stats.medianStars.toLocaleString() },
            {
              label: "Licenses Used",
              value: stats.licenseDistribution.length,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-card border rounded-lg p-3 sm:p-4 text-center"
            >
              <p className="text-xl sm:text-2xl font-bold">{item.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
