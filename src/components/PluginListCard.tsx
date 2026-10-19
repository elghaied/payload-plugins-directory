import Link from "next/link";
import { Download, HeartPulse, Star } from "lucide-react";
import { formatDownloads, formatNumber } from "@/lib/formatters";
import type { PluginSummary } from "@/lib/directory/types";

/** Compact card for category pages. `plugin.description` is the display tagline (plain text). */
export function PluginListCard({ plugin }: { plugin: PluginSummary }) {
  return (
    <Link
      href={`/plugins/${plugin.slug}`}
      className="group flex gap-3 rounded-lg border bg-card p-4 hover:shadow-md hover:border-primary/20 transition-all"
    >
      <img src={plugin.ownerAvatar} alt="" className="h-10 w-10 shrink-0 rounded-full" loading="lazy" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold capitalize truncate group-hover:text-primary transition-colors">{plugin.name}</p>
        <p className="text-sm text-muted-foreground line-clamp-2">{plugin.description}</p>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><HeartPulse className="h-3 w-3" aria-hidden="true" />{plugin.healthScore ?? 0}</span>
          {plugin.weeklyDownloads != null && (
            <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" aria-hidden="true" />{formatDownloads(plugin.weeklyDownloads)}/wk</span>
          )}
          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" aria-hidden="true" />{formatNumber(plugin.stars)}</span>
          <span>{plugin.payloadMajors.map((m) => (m === "unknown" ? "v?" : `v${m}`)).join(" ")}</span>
        </p>
      </div>
    </Link>
  );
}
