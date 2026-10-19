import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type PluginAiOverviewProps = { summary?: string; features: string[]; useCases: string[]; generated: boolean };

/**
 * AI summary, features and use cases (spec §5.4). Text nodes only: never dangerouslySetInnerHTML, markdown or
 * links (spec §5.3) — the strings were already cleaned server-side, this is the second wall.
 */
export function PluginAiOverview({ summary, features, useCases, generated }: PluginAiOverviewProps) {
  if (!summary && features.length === 0 && useCases.length === 0) return null;
  return (
    <Card className="mb-8">
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold">Overview</h2>
          {generated && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Summary generated from the README
            </span>
          )}
        </div>
        {summary && <p className="leading-relaxed">{summary}</p>}
        {features.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Features</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
        {useCases.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Use cases</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {useCases.map((u, i) => <li key={i}>{u}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
