import Link from "next/link";

/** Plain link footer: the navbar hides several of these on narrow screens. All URLs are relative or fixed external repos. */
export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/trending", label: "Trending" },
  { href: "/stats", label: "Stats" },
  { href: "/mcp", label: "MCP server" },
  { href: "/submit", label: "Submit" },
  { href: "/feed.xml", label: "RSS", external: false },
  { href: "https://github.com/elghaied/payload-plugins-directory", label: "Directory on GitHub", external: true },
  { href: "https://github.com/payloadcms/payload", label: "Payload CMS on GitHub", external: true },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 px-4 py-6">
      <nav aria-label="Footer" className="container mx-auto max-w-7xl">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {FOOTER_LINKS.map((l) => (
            <li key={l.href}>
              {"external" in l && l.external ? (
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline underline-offset-4">
                  {l.label}
                </a>
              ) : l.href === "/feed.xml" ? (
                <a href={l.href} className="hover:text-foreground hover:underline underline-offset-4">{l.label}</a>
              ) : (
                <Link href={l.href} className="hover:text-foreground hover:underline underline-offset-4">{l.label}</Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
