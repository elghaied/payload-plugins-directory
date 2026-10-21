import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, versionColors } from "@/lib/formatters";
import { stackLabel } from "@/lib/templates/stack";
import type { TemplateDetail } from "@/lib/templates/types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/**
 * Template facts (spec goal 3): category, Payload version, stack (framework only), stars, last update, license,
 * author, tags and the GitHub link. `categoryHref` is set only when the category resolves in the current tree.
 */
export function TemplateSidePanel({ template, categoryHref }: { template: TemplateDetail; categoryHref: string | null }) {
  return (
    <aside aria-label="Template details" className="rounded-xl border bg-card p-4 text-sm">
      <dl className="divide-y">
        {template.category && (
          <Row label="Category">
            {categoryHref ? (
              <Link href={categoryHref} className="hover:underline">{template.category.title}</Link>
            ) : (
              template.category.title
            )}
          </Row>
        )}
        <Row label="Payload">
          <span className="inline-flex flex-wrap justify-end gap-1">
            {template.payloadMajors.map((m) => (
              <Badge key={m} variant="secondary" className={versionColors[m] ?? versionColors.unknown}>
                {m === "unknown" ? "v?" : `v${m}`}
              </Badge>
            ))}
          </span>
        </Row>
        <Row label="Stack">{stackLabel(template.stack)}</Row>
        {!template.isOfficial && template.stars !== null && (
          <Row label="Stars">
            <span aria-hidden="true">★ </span>
            {template.stars.toLocaleString("en-US")}
          </Row>
        )}
        {template.lastUpdate && <Row label="Updated">{formatRelativeTime(template.lastUpdate)}</Row>}
        {template.license && <Row label="License">{template.license}</Row>}
        <Row label="Author">
          {template.isOfficial ? (
            "Payload"
          ) : (
            <a href={`https://github.com/${encodeURIComponent(template.owner)}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {template.owner}
            </a>
          )}
        </Row>
      </dl>
      {template.tagList.length > 0 && (
        <div className="border-t pt-3">
          <p className="mb-2 text-muted-foreground">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {template.tagList.map((tag) => (
              <Link
                key={tag.slug}
                href={`/?type=templates&q=${encodeURIComponent(tag.slug)}`}
                className="rounded-full border px-2.5 py-0.5 text-xs hover:ring-1 hover:ring-primary/30"
              >
                {tag.title}
              </Link>
            ))}
          </div>
        </div>
      )}
      <a
        href={template.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 font-medium hover:bg-accent"
      >
        View on GitHub
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </aside>
  );
}
