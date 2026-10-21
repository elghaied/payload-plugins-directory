import { BrandMark } from "@/components/BrandMark";
import { stackLabel, type StackValue } from "@/lib/templates/stack";
import { cn } from "@/lib/utils";

/**
 * The local branded preview for an official template without a screenshot or usable README image (Ruling 11): the
 * template name and stack on the brand colours. Pure markup: no image request of any kind.
 */
export function TemplatePanel({ name, stack, className }: { name: string; stack: StackValue; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`${name}, an official ${stackLabel(stack)} template`}
      data-template-panel=""
      className={cn(
        "relative flex h-full w-full flex-col justify-between overflow-hidden bg-foreground p-4 text-background sm:p-5",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -bottom-12 h-40 w-40 rounded-full bg-[var(--brand-amber)] opacity-25 blur-2xl"
      />
      <BrandMark className="h-6 w-6 text-background" />
      <div className="relative min-w-0">
        <p className="truncate text-lg font-semibold sm:text-xl">{name}</p>
        <p className="mt-1 text-xs font-medium tracking-wide text-[var(--brand-amber)] uppercase">
          {stackLabel(stack)} · Official template
        </p>
      </div>
    </div>
  );
}
