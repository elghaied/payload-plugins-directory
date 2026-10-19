"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNCATEGORIZED, visibleCategoryOptions, type CategoryOption, type TagOption } from "@/lib/directory/filters";

type Props = {
  categories: CategoryOption[];
  tags: TagOption[];
  category: string;
  tag: string;
  uncategorizedCount: number;
  onCategoryChange: (value: string) => void;
  onTagChange: (value: string) => void;
  /** `inline`: desktop toolbar (hidden on mobile); `drawer`: labelled blocks in the mobile filter drawer. */
  variant: "inline" | "drawer";
};

/** Category (subtree) and tag filters. "all" is the no-filter value: updateParams strips it from the URL. */
export function TaxonomyFilters({ categories, tags, category, tag, uncategorizedCount, onCategoryChange, onTagChange, variant }: Props) {
  const inline = variant === "inline";
  const usedCategories = visibleCategoryOptions(categories);

  const categorySelect = (
    <Select value={category} onValueChange={onCategoryChange}>
      <SelectTrigger className={inline ? "hidden sm:flex w-48" : undefined} aria-label="Filter by category">
        <SelectValue placeholder="All Categories">
          {category === "all" ? "All Categories" : category === UNCATEGORIZED ? "Uncategorized" : usedCategories.find((c) => c.slug === category)?.title}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Categories</SelectItem>
        {usedCategories.map((c) => (
          <SelectItem key={c.slug} value={c.slug}>
            <span style={{ paddingLeft: `${c.depth * 0.75}rem` }}>{c.title}</span>{" "}
            <span className="text-muted-foreground">({c.count})</span>
          </SelectItem>
        ))}
        {uncategorizedCount > 0 && (
          <SelectItem value={UNCATEGORIZED}>
            Uncategorized <span className="text-muted-foreground">({uncategorizedCount})</span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );

  const tagSelect = (
    <Select value={tag} onValueChange={onTagChange}>
      <SelectTrigger className={inline ? "hidden sm:flex w-40" : undefined} aria-label="Filter by tag">
        <SelectValue placeholder="All Tags">
          {tag === "all" ? "All Tags" : tags.find((t) => t.slug === tag)?.title}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Tags</SelectItem>
        {tags.map((t) => (
          <SelectItem key={t.slug} value={t.slug}>
            {t.title} <span className="text-muted-foreground">({t.count})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (inline) {
    return (
      <>
        {categorySelect}
        {tags.length > 0 && tagSelect}
      </>
    );
  }
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        {categorySelect}
      </div>
      {tags.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Tag</label>
          {tagSelect}
        </div>
      )}
    </>
  );
}
