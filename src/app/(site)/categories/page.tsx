import type { Metadata } from "next";
import Link from "next/link";
import { getCategoryIndex } from "@/lib/directory/taxonomy";
import { UNCATEGORIZED } from "@/lib/directory/filters";
import { categoryFilterHref, categoryHref } from "@/lib/taxonomy/links";
import { CategoryBreadcrumbs } from "@/components/CategoryBreadcrumbs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Categories — Payload Directory",
  description:
    "Browse Payload CMS plugins by category: storage, authentication, SEO, ecommerce, forms, search, localization, admin UI, AI and more.",
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  const options = await getCategoryIndex();
  const topLevel = options.filter((o) => o.depth === 0);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <CategoryBreadcrumbs trail={[]} />
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Categories</h1>
      <p className="text-muted-foreground mb-8">Every listed plugin, grouped by what it does.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {topLevel.map((cat) => {
          const children = options.filter((o) => o.depth === 1 && o.path.startsWith(`${cat.path}/`));
          return (
            <section key={cat.slug} className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold">
                <Link href={categoryHref(cat.path)} className="hover:text-primary transition-colors">{cat.title}</Link>{" "}
                <span className="text-xs font-normal text-muted-foreground">{cat.count}</span>
              </h2>
              {children.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {children.map((child) => (
                    <li key={child.slug}>
                      <Link href={categoryHref(child.path)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {child.title}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">({child.count})</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Plugins not categorised yet are listed under{" "}
        <Link href={categoryFilterHref(UNCATEGORIZED)} className="underline hover:text-foreground">Uncategorized</Link>.
      </p>
    </div>
  );
}
