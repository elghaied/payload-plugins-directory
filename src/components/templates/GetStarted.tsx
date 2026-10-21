"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { TemplateDetail } from "@/lib/templates/types";

/** The "Get started" box (`#get-started`): the exact command with a copy button, or GitHub's "Use this template" link. */
export function GetStarted({ getStarted }: { getStarted: TemplateDetail["getStarted"] }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getStarted.value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure context or permissions): the command stays selectable.
    }
  };

  return (
    <section id="get-started" aria-labelledby="get-started-heading" className="mb-8 scroll-mt-24 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="get-started-heading" className="mb-3 text-sm font-semibold">Get started</h2>
      {getStarted.kind === "command" ? (
        <div className="flex items-stretch gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-secondary/60 px-4 py-3 text-sm">
            <code className="font-mono">{getStarted.value}</code>
          </pre>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy command"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
          <span role="status" className="sr-only">{copied ? "Command copied" : ""}</span>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This repository is a GitHub template: create your own copy of it in one click.</p>
          <a
            href={getStarted.value}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create a repository from this template
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </section>
  );
}
