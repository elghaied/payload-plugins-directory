import type { PluginSummary } from "@/lib/directory/types";
import { PluginListCard } from "./PluginListCard";

export function SimilarPlugins({ plugins }: { plugins: PluginSummary[] }) {
  if (!plugins.length) return null;
  return (
    <section className="mb-8" aria-labelledby="similar-plugins">
      <h2 id="similar-plugins" className="mb-3 text-xs font-medium text-muted-foreground">Similar plugins</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plugins.map((p) => (
          <PluginListCard key={p.slug} plugin={p} />
        ))}
      </div>
    </section>
  );
}
