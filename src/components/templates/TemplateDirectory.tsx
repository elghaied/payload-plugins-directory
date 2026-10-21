"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CategoryOption } from "@/lib/directory/filters";
import { filterTemplates, resolveTemplateParams, sortTemplates, type TemplateSort } from "@/lib/templates/filters";
import { stackLabel } from "@/lib/templates/stack";
import type { TemplateSummary } from "@/lib/templates/types";
import { TemplateCard } from "./TemplateCard";

/** UI-only sentinel for "no filter"; it never reaches the URL. */
const ANY = "__any__";

const SORT_LABELS: Record<TemplateSort, string> = {
  default: "Default",
  stars: "Stars",
  recent: "Recently updated",
  name: "Name",
};

export function TemplateDirectory({
  templates,
  categories,
}: {
  templates: TemplateSummary[];
  categories: CategoryOption[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useMemo(() => resolveTemplateParams(searchParams), [searchParams]);

  /** Own helper (not updateParams): deletes a key only when the value is undefined, and always keeps type=templates. */
  const setParam = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("type", "templates");
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const visibleCategories = useMemo(() => categories.filter((c) => c.count > 0), [categories]);
  const stacks = useMemo(() => [...new Set(templates.map((t) => t.stack))].sort(), [templates]);
  const majors = useMemo(() => {
    const set = new Set(templates.flatMap((t) => t.payloadMajors));
    return (["4", "3", "2", "1", "unknown"] as const).filter((m) => set.has(m));
  }, [templates]);

  const results = useMemo(
    () => sortTemplates(filterTemplates(templates, params, categories), params.sort ?? "default"),
    [templates, params, categories],
  );

  const sel = (key: string, value: string | undefined, placeholder: string, options: { value: string; label: string }[]) => (
    <Select value={value ?? ANY} onValueChange={(v) => setParam(key, v === ANY ? undefined : v)}>
      <SelectTrigger className="w-full sm:w-[180px]" aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div data-testid="template-directory" className="mx-auto w-full max-w-7xl px-4 pb-12 pt-4 sm:px-6">
      <div className="mb-6 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search templates"
            placeholder="Search templates..."
            className="pl-9"
            defaultValue={params.q ?? ""}
            onChange={(e) => setParam("q", e.target.value.trim() ? e.target.value : undefined)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {visibleCategories.length > 0 &&
            sel("category", params.category, "All categories", visibleCategories.map((c) => ({ value: c.path, label: `${c.title} (${c.count})` })))}
          {stacks.length > 0 && sel("stack", params.stack, "Any stack", stacks.map((s) => ({ value: s, label: stackLabel(s) })))}
          {sel("major", params.major, "Any version", majors.map((m) => ({ value: m, label: m === "unknown" ? "Unknown" : `v${m}` })))}
          {sel("source", params.source, "Any source", [
            { value: "official", label: "Official" },
            { value: "community", label: "Community" },
          ])}
          <Select value={params.sort ?? "default"} onValueChange={(v) => setParam("sort", v === "default" ? undefined : v)}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Sort templates">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as TemplateSort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {results.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No templates match.{" "}
          <Link href="/?type=templates" className="underline underline-offset-4">
            Clear filters
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((t) => (
            <TemplateCard key={t.slug} template={t} />
          ))}
        </div>
      )}
    </div>
  );
}
