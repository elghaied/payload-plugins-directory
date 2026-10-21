"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CategoryOption } from "@/lib/directory/filters";
import { filterTemplates, resolveTemplateParams, sortTemplates, type TemplateSort } from "@/lib/templates/filters";
import { stackLabel, type StackValue } from "@/lib/templates/stack";
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

  // Debounce search: every URL change re-renders the force-dynamic home page on the server.
  const setParamRef = useRef(setParam);
  useEffect(() => {
    setParamRef.current = setParam;
  }, [setParam]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);
  const onSearch = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setParamRef.current("q", value.trim() ? value : undefined), 300);
  };

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

  /**
   * The trigger always shows its label as explicit SelectValue children: Radix otherwise fills it from the selected
   * item only after the (portalled) content mounts, so the server HTML had blank triggers, and a URL value no option
   * matches (a major or stack no template has yet) stayed blank for good. Such a value is kept as its own option.
   */
  const sel = (key: string, value: string | undefined, placeholder: string, options: { value: string; label: string }[], labelOf: (v: string) => string) => {
    const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: labelOf(value) }] : options;
    const current = value ? (all.find((o) => o.value === value)?.label ?? value) : placeholder;
    return (
      <Select value={value ?? ANY} onValueChange={(v) => setParam(key, v === ANY ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-[180px]" aria-label={placeholder}>
          <SelectValue placeholder={placeholder}>{current}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{placeholder}</SelectItem>
          {all.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };
  const majorLabel = (m: string) => (m === "unknown" ? "Unknown" : `v${m}`);
  const categoryLabel = (path: string) => {
    const c = categories.find((x) => x.path === path);
    return c ? c.title : path;
  };

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
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {(visibleCategories.length > 0 || params.category) &&
            sel("category", params.category, "All categories", visibleCategories.map((c) => ({ value: c.path, label: `${c.title} (${c.count})` })), categoryLabel)}
          {(stacks.length > 0 || params.stack) &&
            sel("stack", params.stack, "Any stack", stacks.map((s) => ({ value: s, label: stackLabel(s) })), (v) => stackLabel(v as StackValue))}
          {sel("major", params.major, "Any version", majors.map((m) => ({ value: m, label: majorLabel(m) })), majorLabel)}
          {sel("source", params.source, "Any source", [
            { value: "official", label: "Official" },
            { value: "community", label: "Community" },
          ], (v) => v)}
          <Select value={params.sort ?? "default"} onValueChange={(v) => setParam("sort", v === "default" ? undefined : v)}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Sort templates">
              <SelectValue>{SORT_LABELS[params.sort ?? "default"]}</SelectValue>
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
