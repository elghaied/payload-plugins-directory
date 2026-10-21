"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PluginDirectory } from "@/components/PluginDirectory";
import type { CategoryOption } from "@/lib/directory/filters";
import type { TemplateSummary } from "@/lib/templates/types";
import { cn } from "@/lib/utils";
import { TemplateDirectory } from "./TemplateDirectory";

type PluginProps = ComponentProps<typeof PluginDirectory>;

type Props = PluginProps & {
  templates: TemplateSummary[];
  templateCategories: CategoryOption[];
};

export function DirectoryHome({ plugins, metadata, categories, tags, templates, templateCategories }: Props) {
  const showTemplates = useSearchParams().get("type") === "templates";
  const tab = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-4 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none",
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl px-4 pt-4 sm:px-6">
        <nav aria-label="Directory type" className="flex w-full rounded-lg bg-muted p-1 sm:w-auto">
          {/* Real links; switching drops every other parameter. */}
          <Link href="/" aria-current={showTemplates ? undefined : "page"} className={tab(!showTemplates)}>
            Plugins ({metadata.totalCount})
          </Link>
          <Link href="/?type=templates" aria-current={showTemplates ? "page" : undefined} className={tab(showTemplates)}>
            Templates ({templates.length})
          </Link>
        </nav>
      </div>
      {showTemplates ? (
        <TemplateDirectory templates={templates} categories={templateCategories} />
      ) : (
        <PluginDirectory plugins={plugins} metadata={metadata} categories={categories} tags={tags} />
      )}
    </>
  );
}
