import Link from "next/link";
import { Fragment } from "react";
import { categoryHref } from "@/lib/taxonomy/links";

type Crumb = { title: string; path: string };

/** Breadcrumbs from Payload's `_h_slugPath` trail (spec §7): Directory / Categories / …trail / current. */
export function CategoryBreadcrumbs({ trail, current }: { trail: Crumb[]; current?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="hover:text-foreground transition-colors">Directory</Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link href="/categories" className="hover:text-foreground transition-colors">Categories</Link>
        </li>
        {trail.map((crumb, i) => {
          const isCurrent = !current && i === trail.length - 1;
          return (
            <Fragment key={crumb.path}>
              <li aria-hidden="true">/</li>
              <li>
                {isCurrent ? (
                  <span aria-current="page" className="text-foreground">{crumb.title}</span>
                ) : (
                  <Link href={categoryHref(crumb.path)} className="hover:text-foreground transition-colors">{crumb.title}</Link>
                )}
              </li>
            </Fragment>
          );
        })}
        {current && (
          <>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground truncate max-w-[16rem] capitalize">{current}</li>
          </>
        )}
      </ol>
    </nav>
  );
}
