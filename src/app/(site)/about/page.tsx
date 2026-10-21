import { Metadata } from "next";
import { OG_IMAGES } from "@/lib/siteOg";
import { ExternalLink } from "lucide-react";
import { mcpUrl } from "@/mcp/instructions";

// Per request, like every site page: absolute URLs come from the runtime SERVER_URL (metadataBase in the layout),
// never from the build environment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About — Payload CMS Plugin Directory",
  alternates: { canonical: "/about" },
  description:
    "Learn how the Payload CMS Plugin Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  openGraph: {
    url: "/about",
    images: OG_IMAGES,
    title: "About — Payload CMS Plugin Directory",
    description:
      "Learn how the Payload CMS Plugin Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  },
};

const mcpTools = [
  ["searchPlugins", "full-text search, optionally filtered by Payload major version or category"],
  ["getPlugin", "everything about one plugin, including its README"],
  ["listCategories", "the category tree with plugin counts"],
  ["comparePlugins", "2–5 plugins side by side"],
] as const;

export default function AboutPage() {
  // Built per request from SERVER_URL (this page is force-dynamic), never a hardcoded host.
  const url = mcpUrl();
  const claudeCodeCommand = `claude mcp add --transport http payload-directory ${url}`;
  const jsonConfig = JSON.stringify({ mcpServers: { "payload-directory": { type: "http", url } } }, null, 2);
  const stdioCommand = `npx -y mcp-remote ${url}`;
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">About</h1>
          <p className="text-muted-foreground mt-1">
            Everything you need to know about the Payload Plugin Directory
          </p>
        </div>

        <div className="space-y-6">
          {/* What is this? */}
          <section className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">What is this?</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Payload Plugin Directory is a community-driven catalog that
              automatically discovers and indexes plugins for{" "}
              <a
                href="https://payloadcms.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors inline-flex items-center gap-1"
              >
                Payload CMS
                <ExternalLink className="h-3 w-3" />
              </a>
              . Whether you&apos;re looking for authentication, SEO, media
              handling, or any other functionality, you can browse, search, and
              compare plugins all in one place.
            </p>
          </section>

          {/* How does it work? */}
          <section className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">How does it work?</h2>
            <div className="space-y-4">
              {[
                {
                  title: "Discovery",
                  description: (
                    <>
                      GitHub repositories with the{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        payload-plugin
                      </code>{" "}
                      topic are discovered automatically via the GitHub API.
                    </>
                  ),
                },
                {
                  title: "Processing",
                  description:
                    "Each repository's metadata — description, stars, forks, version compatibility, npm downloads, license, and more — is fetched and processed.",
                },
                {
                  title: "Refresh",
                  description:
                    "The directory syncs with GitHub and npm automatically several times a day, so new plugins and updates appear without any manual intervention.",
                },
                {
                  title: "No submission needed",
                  description: (
                    <>
                      There&apos;s no sign-up or manual submission process. Just
                      add the{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        payload-plugin
                      </code>{" "}
                      topic to your GitHub repo and it will be picked up
                      automatically.
                    </>
                  ),
                },
              ].map((step, i) => (
                <div key={step.title} className="flex gap-4">
                  <div className="shrink-0 flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                    {i + 1}
                  </div>
                  <div className="pt-0.5">
                    <p className="font-medium">{step.title}</p>
                    <p className="text-muted-foreground text-sm mt-0.5 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Build Your Own Plugin */}
          <section className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">
              Build Your Own Plugin
            </h2>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              Creating a Payload plugin is straightforward. Here&apos;s how to
              get started:
            </p>
            <div className="space-y-4">
              {[
                {
                  title: "Scaffold the project",
                  description: (
                    <>
                      Run{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        npx create-payload-app
                      </code>{" "}
                      (or{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        pnpx create-payload-app
                      </code>
                      ) and select the{" "}
                      <strong>&ldquo;plugin&rdquo;</strong> template when
                      prompted.
                    </>
                  ),
                },
                {
                  title: "Develop your plugin",
                  description: (
                    <>
                      Follow the{" "}
                      <a
                        href="https://payloadcms.com/docs/plugins/build-your-own"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                      >
                        official plugin guide
                        <ExternalLink className="h-3 w-3" />
                      </a>{" "}
                      to build and test your plugin.
                    </>
                  ),
                },
                {
                  title: "Get listed",
                  description: (
                    <>
                      Add the{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        payload-plugin
                      </code>{" "}
                      topic to your GitHub repository. The directory will
                      discover and list it automatically within 24 hours.
                    </>
                  ),
                },
              ].map((step, i) => (
                <div key={step.title} className="flex gap-4">
                  <div className="shrink-0 flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                    {i + 1}
                  </div>
                  <div className="pt-0.5">
                    <p className="font-medium">{step.title}</p>
                    <p className="text-muted-foreground text-sm mt-0.5 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Use with your agent */}
          <section id="mcp" className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">Use with your agent</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              The directory is also a public, read-only{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors inline-flex items-center gap-1"
              >
                MCP server
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              at{" "}
              <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm break-all">{url}</code>. No sign-up or
              API key is needed. Your coding agent can find, inspect, and compare plugins while it works on your Payload
              project.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              The endpoint is for MCP clients such as Claude Code, Claude Desktop and other CLI or agent clients. It is not
              meant for browsers: it does not allow cross-origin requests, so a web page cannot call it.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 mb-4">
              {mcpTools.map(([name, text]) => (
                <li key={name}>
                  <code className="font-mono bg-secondary px-1.5 py-0.5 rounded">{name}</code> — {text}
                </li>
              ))}
            </ul>
            <p className="font-medium text-sm mb-1">Claude Code</p>
            <pre className="mb-4 overflow-x-auto rounded-lg bg-secondary/50 px-4 py-3 text-sm font-mono">{claudeCodeCommand}</pre>
            <p className="font-medium text-sm mb-1">Cursor, VS Code and other clients with HTTP support</p>
            <p className="text-xs text-muted-foreground mb-1">
              The top-level key name varies by client; check your client&apos;s MCP docs.
            </p>
            <pre className="mb-4 overflow-x-auto rounded-lg bg-secondary/50 px-4 py-3 text-sm font-mono">{jsonConfig}</pre>
            <p className="font-medium text-sm mb-1">Clients that only run local (stdio) servers, such as Claude Desktop</p>
            <pre className="mb-4 overflow-x-auto rounded-lg bg-secondary/50 px-4 py-3 text-sm font-mono">{stdioCommand}</pre>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Requests are rate-limited. Plugin descriptions and READMEs are written by plugin authors, so the server tells
              agents to treat them as untrusted content.
            </p>
          </section>

          {/* Open Source */}
          <section className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">Open Source</h2>
            <p className="text-muted-foreground leading-relaxed">
              This project is fully open source. Contributions, bug reports, and
              feature requests are welcome on{" "}
              <a
                href="https://github.com/elghaied/payload-plugins-directory"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors inline-flex items-center gap-1"
              >
                GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
