import Link from "next/link";
import { Fragment } from "react";
import { categoryHref } from "@/lib/taxonomy/links";

type Crumb = { title: string; path: string };
type RootLink = { title: string; href: string };

const DEFAULT_ROOT: RootLink[] = [
  { title: "Directory", href: "/" },
  { title: "Categories", href: "/categories" },
];

/**
 * Breadcrumbs from Payload's `_h_slugPath` trail (spec §7): Directory / Categories / …trail / current.
 * Templates pass their own `root` (Templates) and `hrefFor` (template category URLs).
 */
export function CategoryBreadcrumbs({
  trail,
  current,
  root = DEFAULT_ROOT,
  hrefFor = categoryHref,
}: {
  trail: Crumb[];
  current?: string;
  root?: RootLink[];
  hrefFor?: (path: string) => string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6">
      <ol className="flex flex-wrap items-center gap-1.5">
        {root.map((link, i) => (
          <Fragment key={link.href}>
            {i > 0 && <li aria-hidden="true">/</li>}
            <li>
              <Link href={link.href} className="hover:text-foreground transition-colors">{link.title}</Link>
            </li>
          </Fragment>
        ))}
        {trail.map((crumb, i) => {
          const isCurrent = !current && i === trail.length - 1;
          return (
            <Fragment key={crumb.path}>
              <li aria-hidden="true">/</li>
              <li>
                {isCurrent ? (
                  <span aria-current="page" className="text-foreground">{crumb.title}</span>
                ) : (
                  <Link href={hrefFor(crumb.path)} className="hover:text-foreground transition-colors">{crumb.title}</Link>
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
