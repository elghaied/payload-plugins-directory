import { getPluginStats, getPluginsMetadata } from "@/lib/getPlugins";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ecosystem Stats — Payload CMS Plugin Directory",
  description:
    "Statistics and insights about the Payload CMS plugin ecosystem: version adoption, top contributors, license distribution, and growth trends.",
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
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-20 shrink-0 text-right">
        {label}
      </span>
      <div className="flex-1 bg-secondary rounded-full h-6 overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="text-sm font-medium w-10 text-right">{count}</span>
    </div>
  );
}

function formatDownloads(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

export default function StatsPage() {
  const stats = getPluginStats();
  const meta = getPluginsMetadata();

  const maxVersion = Math.max(
    stats.versions.v1,
    stats.versions.v2,
    stats.versions.v3,
    stats.versions.unknown
  );
  const maxLicense = stats.licenseDistribution[0]?.[1] || 1;
  const maxMonth = Math.max(...stats.months.map((m) => m.count), 1);

  const maxSizeBucket = Math.max(...Object.values(stats.sizeDistribution), 1);
  const maxHealthBucket = Math.max(...Object.values(stats.healthDistribution), 1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Ecosystem Stats
          </h1>
          <p className="text-muted-foreground mt-1">
            Last updated: {new Date(meta.lastUpdated).toLocaleDateString()}
          </p>
        </div>

        {/* Quick numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Plugins", value: stats.total.toLocaleString() },
            { label: "Weekly Downloads", value: formatDownloads(stats.totalDownloadsWeekly) },
            { label: "Monthly Downloads", value: formatDownloads(stats.totalDownloadsMonthly) },
            { label: "Avg Health Score", value: stats.avgHealth.toString() },
            { label: "Official", value: stats.official.toLocaleString() },
            { label: "Community", value: stats.community.toLocaleString() },
            { label: "On npm", value: stats.pluginsWithNpmCount.toLocaleString() },
            { label: "Avg Stars", value: stats.avgStars.toLocaleString() },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-card border rounded-lg p-4 text-center"
            >
              <p className="text-2xl font-bold">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Most downloaded */}
          {stats.mostDownloaded.length > 0 && (
            <section className="bg-card border rounded-lg p-5">
              <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
                Most Downloaded (Weekly)
              </h2>
              <div className="space-y-3">
                {stats.mostDownloaded.map((plugin, i) => (
                  <div key={plugin.packageName} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">
                      {i + 1}.
                    </span>
                    <img
                      src={plugin.avatar}
                      alt={plugin.owner}
                      className="w-7 h-7 rounded-full"
                    />
                    <span className="text-sm flex-1 truncate capitalize">{plugin.name}</span>
                    <span className="text-sm font-medium font-mono">
                      {formatDownloads(plugin.weeklyDownloads)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Most downloaded community plugins */}
          {stats.mostDownloadedCommunity.length > 0 && (
            <section className="bg-card border rounded-lg p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-bl-lg">
                Community
              </div>
              <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
                Top Community Plugins (Weekly)
              </h2>
              <div className="space-y-3">
                {stats.mostDownloadedCommunity.map((plugin, i) => (
                  <div key={plugin.packageName} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">
                      {i + 1}.
                    </span>
                    <img
                      src={plugin.avatar}
                      alt={plugin.owner}
                      className="w-7 h-7 rounded-full ring-2 ring-emerald-500/20"
                    />
                    <span className="text-sm flex-1 truncate capitalize">{plugin.name}</span>
                    <span className="text-sm font-medium font-mono">
                      {formatDownloads(plugin.weeklyDownloads)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Version adoption */}
          <section className="bg-card border rounded-lg p-5">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              Version Adoption
            </h2>
            <div className="space-y-3">
              <Bar
                label="v3"
                value={stats.versions.v3}
                max={maxVersion}
                count={stats.versions.v3}
                color="bg-emerald-500"
              />
              <Bar
                label="v2"
                value={stats.versions.v2}
                max={maxVersion}
                count={stats.versions.v2}
                color="bg-blue-500"
              />
              <Bar
                label="v1"
                value={stats.versions.v1}
                max={maxVersion}
                count={stats.versions.v1}
                color="bg-amber-500"
              />
              <Bar
                label="Unknown"
                value={stats.versions.unknown}
                max={maxVersion}
                count={stats.versions.unknown}
                color="bg-gray-400"
              />
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
                <div key={author.name} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right">
                    {i + 1}.
                  </span>
                  <img
                    src={author.avatar}
                    alt={author.name}
                    className="w-7 h-7 rounded-full"
                  />
                  <span className="text-sm flex-1 truncate">{author.name}</span>
                  <span className="text-sm font-medium">
                    {author.count} plugin{author.count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Growth over time */}
          <section className="bg-card border rounded-lg p-5 md:col-span-2">
            <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
              New Plugins (Last 12 Months)
            </h2>
            <div className="flex items-end gap-1.5 h-40">
              {stats.months.map((month) => (
                <div
                  key={month.label}
                  className="flex-1 flex flex-col items-center justify-end h-full"
                >
                  <span className="text-[10px] text-muted-foreground mb-1">
                    {month.count > 0 ? month.count : ""}
                  </span>
                  <div
                    className="w-full bg-primary/60 rounded-t transition-all"
                    style={{
                      height: `${Math.max((month.count / maxMonth) * 100, month.count > 0 ? 4 : 0)}%`,
                    }}
                  />
                  <span className="text-[9px] text-muted-foreground mt-1.5 rotate-[-45deg] origin-top-left whitespace-nowrap">
                    {month.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Additional quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
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
              className="bg-card border rounded-lg p-4 text-center"
            >
              <p className="text-2xl font-bold">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
