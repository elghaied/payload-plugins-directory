import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RankedList, type RankedRow } from "@/components/trends/RankedList";
import { TrendEmpty } from "@/components/trends/TrendEmpty";
import { formatRelativeTime } from "@/lib/formatters";
import { insufficientMessage, signed } from "@/lib/trends/chartModel";
import { addDays, daysBetween, formatDay } from "@/lib/trends/days";
import { TREND_WINDOW_DAYS, type Coverage } from "@/lib/trends/growth";
import { getTrendingData } from "@/lib/trends/queries";
import type { DownloadMover, NewPlugin, RecentRepo, StarMover, TrendingData } from "@/lib/trends/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trending Payload Plugins — Payload CMS Plugin Directory",
  description:
    "The fastest-growing Payload CMS plugins this week by GitHub stars and npm downloads, plus new and recently updated plugins.",
  alternates: { canonical: "/trending" },
  openGraph: {
    url: "/trending",
    title: "Trending Payload Plugins — Payload CMS Plugin Directory",
    description:
      "The fastest-growing Payload CMS plugins this week by GitHub stars and npm downloads, plus new and recently updated plugins.",
  },
};

const percent = (p: number | null) =>
  p === null ? undefined : `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)}%`;

function starRow(m: StarMover): RankedRow {
  const single = m.plugins.length === 1;
  return {
    key: m.fullName,
    href: `/plugins/${m.plugins[0].slug}`,
    avatar: m.ownerAvatar,
    title: single ? m.plugins[0].name : m.fullName,
    subtitle: single ? `by ${m.owner}` : `${m.plugins.length} plugins · by ${m.owner}`,
    value: `${signed(m.growth.delta)} ★`,
    valueLabel: `${m.growth.delta.toLocaleString("en-US")} new stars`,
    detail: percent(m.growth.pct),
  };
}

function downloadRow(m: DownloadMover): RankedRow {
  return {
    key: m.slug,
    href: `/plugins/${m.slug}`,
    avatar: m.ownerAvatar,
    title: m.name,
    subtitle: `by ${m.owner}`,
    value: signed(m.growth.delta),
    valueLabel: `${m.growth.delta.toLocaleString("en-US")} more weekly downloads`,
    detail: percent(m.growth.pct),
  };
}

function newRow(n: NewPlugin, today: string): RankedRow {
  return {
    key: n.slug,
    href: `/plugins/${n.slug}`,
    avatar: n.ownerAvatar,
    title: n.name,
    subtitle: `by ${n.owner} · ${n.reason === "new-repository" ? "new repository" : "newly listed"}`,
    value: formatDay(n.addedOn, n.addedOn.slice(0, 4) !== today.slice(0, 4)),
    valueLabel: `added ${formatDay(n.addedOn, true)}`,
  };
}

function recentRow(r: RecentRepo): RankedRow {
  const single = r.plugins.length === 1;
  return {
    key: r.fullName,
    href: `/plugins/${r.plugins[0].slug}`,
    avatar: r.ownerAvatar,
    title: single ? r.plugins[0].name : r.fullName,
    subtitle: single ? `by ${r.owner}` : `${r.plugins.length} plugins · by ${r.owner}`,
    value: formatRelativeTime(r.pushedAt),
    valueLabel: `last pushed ${formatRelativeTime(r.pushedAt)}`,
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 bg-card border rounded-lg p-4 sm:p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function windowText(cov: Coverage) {
  if (!cov.lastDay) return undefined;
  return `${formatDay(addDays(cov.lastDay, -TREND_WINDOW_DAYS))} – ${formatDay(cov.lastDay, true)} (UTC snapshots)`;
}

export default async function TrendingPage() {
  let data: TrendingData;
  try {
    data = await getTrendingData();
  } catch (error) {
    console.error("[trending] getTrendingData failed", error);
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Trending</h1>
          <p className="text-muted-foreground mt-4">Trending data is unavailable right now.</p>
        </div>
      </div>
    );
  }
  const stale = data.lastSnapshotDay !== null && daysBetween(data.lastSnapshotDay, data.today) > 2;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Trending</h1>
          <p className="text-muted-foreground mt-1">
            What is growing in the Payload plugin ecosystem this week.
          </p>
          {stale && data.lastSnapshotDay && (
            <p className="mt-1 text-xs text-muted-foreground">Data as of {formatDay(data.lastSnapshotDay, true)}</p>
          )}
        </div>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <Section
            title="Fastest-growing · stars"
            description={
              data.starsCoverage.ready
                ? `${windowText(data.starsCoverage)}. A repository with several plugins is counted once.`
                : undefined
            }
          >
            {data.starsCoverage.ready ? (
              <RankedList rows={data.stars.map(starRow)} empty="No repository gained stars this week." />
            ) : (
              <TrendEmpty message={insufficientMessage(data.starsCoverage)} />
            )}
          </Section>

          <Section
            title="Fastest-growing · downloads"
            description={
              data.downloadsCoverage.ready
                ? `${windowText(data.downloadsCoverage)}. Change in npm weekly downloads.`
                : undefined
            }
          >
            {data.downloadsCoverage.ready ? (
              <RankedList rows={data.downloads.map(downloadRow)} empty="No plugin gained weekly downloads this week." />
            ) : (
              <TrendEmpty message={insufficientMessage(data.downloadsCoverage)} />
            )}
          </Section>

          <Section title="New in the last 30 days" description="New repositories and newly listed plugins.">
            <RankedList rows={data.newThisMonth.map((n) => newRow(n, data.today))} empty="No new plugins in the last 30 days." />
          </Section>

          <Section title="Recently updated" description="Latest pushes to plugin repositories.">
            <RankedList rows={data.recentlyUpdated.map(recentRow)} empty="No update information yet." />
          </Section>
        </div>
      </div>
    </div>
  );
}
