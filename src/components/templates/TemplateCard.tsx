import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, versionColors } from "@/lib/formatters";
import { stackLabel } from "@/lib/templates/stack";
import type { TemplateSummary } from "@/lib/templates/types";

export function TemplateCard({ template }: { template: TemplateSummary }) {
  const { image } = template;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.src}
          {...(image.srcSet ? { srcSet: image.srcSet, sizes: "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" } : {})}
          alt={`${template.name} screenshot`}
          loading="lazy"
          decoding="async"
          {...(image.local ? {} : { referrerPolicy: "no-referrer" as const })}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-base font-semibold">{template.name}</h3>
          {template.isOfficial && (
            <Badge
              variant="outline"
              className="shrink-0 border-[var(--brand-amber)] text-[var(--brand-amber)]"
            >
              Official
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{template.tagline}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {!template.isOfficial && template.stars !== null && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true">★</span>
              {template.stars.toLocaleString("en-US")}
            </span>
          )}
          {template.payloadMajors.map((m) => (
            <Badge key={m} variant="secondary" className={versionColors[m] ?? versionColors.unknown}>
              {m === "unknown" ? "v?" : `v${m}`}
            </Badge>
          ))}
          <Badge variant="outline">{stackLabel(template.stack)}</Badge>
          <span>Updated {formatRelativeTime(template.lastUpdate)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.demoUrl && (
            <a
              href={template.demoUrl}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
            >
              Live demo ↗
            </a>
          )}
          <Link
            href={`/templates/${template.slug}`}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Details
          </Link>
        </div>
      </div>
    </article>
  );
}
