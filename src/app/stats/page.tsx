import { getPluginStats, getPluginsMetadata } from "@/lib/getPlugins";
import Link from "next/link";
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            &larr; Back to directory
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-4">
            Ecosystem Stats
          </h1>
          <p className="text-muted-foreground mt-1">
            Last updated: {new Date(meta.lastUpdated).toLocaleDateString()}
          </p>
        </div>

        {/* Quick numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Plugins", value: stats.total },
            { label: "Official", value: stats.official },
            { label: "Community", value: stats.community },
            { label: "Avg Stars", value: stats.avgStars },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-card border rounded-lg p-4 text-center"
            >
              <p className="text-2xl font-bold">{item.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-8 md:grid-cols-2">
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
          <section className="bg-card border rounded-lg p-5">
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
