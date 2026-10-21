import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SiteTemplateResult } from "@/lib/search/present";
import { stackLabel } from "@/lib/templates/stack";

/** Compact card for template search hits: name, display tagline (plain text), Official badge and stack. No image. */
export function TemplateMiniCard({ template }: { template: SiteTemplateResult }) {
  return (
    <Link
      href={`/templates/${template.slug}`}
      className="group flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 truncate font-semibold transition-colors group-hover:text-primary">{template.name}</p>
        {template.isOfficial && (
          <Badge variant="outline" className="shrink-0 border-[var(--brand-amber)] text-[var(--brand-amber)]">
            Official
          </Badge>
        )}
      </div>
      {template.tagline && <p className="line-clamp-2 text-sm text-muted-foreground">{template.tagline}</p>}
      <div className="mt-auto pt-1">
        <Badge variant="outline">{stackLabel(template.stack)}</Badge>
      </div>
    </Link>
  );
}
