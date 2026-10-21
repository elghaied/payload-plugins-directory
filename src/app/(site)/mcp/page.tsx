import { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { CopySnippet } from "@/components/CopySnippet";
import { OG_IMAGES } from "@/lib/siteOg";
import { mcpUrl } from "@/mcp/instructions";

// Per request, like every site page: the endpoint URL comes from the runtime SERVER_URL, never the build environment.
export const dynamic = "force-dynamic";

const TITLE = "MCP server — Payload Directory";
const DESCRIPTION =
  "Use Payload Directory from Claude, Cursor, VS Code and other AI agents: a free, read-only MCP server to search Payload plugins and templates.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/mcp" },
  openGraph: { url: "/mcp", images: OG_IMAGES, title: TITLE, description: DESCRIPTION },
};

const MCP_TOOLS = [
  ["searchPlugins", "Full-text search over plugins, templates or both, optionally filtered by Payload major version or category."],
  ["getPlugin", "Everything about one plugin: health score, compatible Payload versions, npm stats, AI summary and README."],
  ["getTemplate", "Everything about one template: stack, how to get started, demo and video links, and README."],
  ["listCategories", "The plugin or template category tree, with counts."],
  ["comparePlugins", "Two to five plugins side by side."],
] as const;

const EXAMPLES = [
  "Find a Payload plugin for SEO that works with Payload 3.",
  "Compare the S3 storage plugins and tell me which is best maintained.",
  "Which Payload template should I start an online store from?",
  "How do I get started with the official website template?",
] as const;

const code = "font-mono bg-secondary px-1.5 py-0.5 rounded text-sm";
const link = "text-primary underline underline-offset-4 hover:text-primary/80 transition-colors inline-flex items-center gap-1";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-card border rounded-lg p-6 scroll-mt-20">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

export default function McpPage() {
  // Built per request from SERVER_URL (this page is force-dynamic), never a hardcoded host.
  const url = mcpUrl();
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">MCP server</h1>
          <p className="text-muted-foreground mt-1">Use Payload Directory from your AI agent</p>
        </div>

        <div className="space-y-6">
          <section className="bg-card border rounded-lg p-6 space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              Payload Directory is also a{" "}
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className={link}>
                Model Context Protocol
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              server. Connect it to Claude, Cursor, VS Code or any MCP client, and your agent can find, inspect and compare
              Payload plugins and templates while it works on your project, with the same up-to-date data as this site.
            </p>
            <ul className="flex flex-wrap gap-2 text-xs font-medium">
              {["Free", "No sign-up or API key", "Read-only", "Plugins and templates"].map((t) => (
                <li key={t} className="rounded-full border bg-secondary/50 px-2.5 py-1">
                  {t}
                </li>
              ))}
            </ul>
            <CopySnippet label="Endpoint (Streamable HTTP)" value={url} />
          </section>

          <Section id="setup" title="Set it up">
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="font-medium">Claude Code</h3>
                <CopySnippet label="Run in your terminal" value={`claude mcp add --transport http payload-directory ${url}`} />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Claude Desktop and claude.ai</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Open <strong>Settings → Connectors → Add custom connector</strong>, name it{" "}
                  <code className={code}>Payload Directory</code> and paste the endpoint URL above. No authentication is
                  needed.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Cursor</h3>
                <CopySnippet
                  label="~/.cursor/mcp.json (or .cursor/mcp.json in your project)"
                  value={json({ mcpServers: { "payload-directory": { url } } })}
                />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">VS Code</h3>
                <CopySnippet label=".vscode/mcp.json" value={json({ servers: { "payload-directory": { type: "http", url } } })} />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Clients that only run local (stdio) servers</h3>
                <CopySnippet
                  label="Bridge through mcp-remote"
                  value={json({ mcpServers: { "payload-directory": { command: "npx", args: ["-y", "mcp-remote", url] } } })}
                />
              </div>
            </div>
          </Section>

          <Section id="tools" title="Tools">
            <ul className="space-y-3">
              {MCP_TOOLS.map(([name, text]) => (
                <li key={name} className="text-sm leading-relaxed">
                  <code className={code}>{name}</code>
                  <span className="text-muted-foreground"> — {text}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="examples" title="Try asking">
            <ul className="space-y-2">
              {EXAMPLES.map((q) => (
                <li key={q} className="rounded-lg bg-secondary/50 px-4 py-2.5 text-sm">
                  &ldquo;{q}&rdquo;
                </li>
              ))}
            </ul>
          </Section>

          <Section id="notes" title="Good to know">
            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground leading-relaxed">
              <li>It only reads public directory data. It cannot change anything and never sees your code.</li>
              <li>
                Descriptions, READMEs and AI summaries come from plugin and template authors, so the server tells agents to
                treat them as untrusted content and never follow instructions inside them.
              </li>
              <li>
                It is meant for MCP clients, not browsers: it does not allow cross-origin requests, so a web page cannot call
                it.
              </li>
              <li>Please keep automated use reasonable; heavy traffic may be throttled.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
