import { Metadata } from "next";
import { OG_IMAGES } from "@/lib/siteOg";
import { ExternalLink } from "lucide-react";

// Per request, like every site page: absolute URLs come from the runtime SERVER_URL (metadataBase in the layout),
// never from the build environment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About — Payload Directory",
  alternates: { canonical: "/about" },
  description:
    "Learn how the Payload Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  openGraph: {
    url: "/about",
    images: OG_IMAGES,
    title: "About — Payload Directory",
    description:
      "Learn how the Payload Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">About</h1>
          <p className="text-muted-foreground mt-1">
            Everything you need to know about the Payload Directory
          </p>
        </div>

        <div className="space-y-6">
          {/* What is this? */}
          <section className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">What is this?</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Payload Directory is a community-driven catalog that
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
                  title: "Automatic listing",
                  description: (
                    <>
                      Add the{" "}
                      <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-sm">
                        payload-plugin
                      </code>{" "}
                      topic to your GitHub repo and it is picked up
                      automatically. Plugins without the topic can be submitted
                      at{" "}
                      <a href="/submit" className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors">
                        /submit
                      </a>
                      .
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

          {/* Templates */}
          <section id="templates" className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">Templates</h2>
            <p className="text-muted-foreground leading-relaxed">
              Besides plugins, the directory lists Payload templates: complete starter projects you can scaffold or
              clone. Official templates come from the Payload repository and appear automatically; community templates are
              added by submission and reviewed before they are listed. Have one of your own? Submit it at{" "}
              <a
                href="/submit"
                className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
              >
                /submit
              </a>{" "}
              and choose &ldquo;Template&rdquo;.
            </p>
          </section>

          {/* Use with your agent: the full guide lives on /mcp; #mcp stays for older links. */}
          <section id="mcp" className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">Use with your agent</h2>
            <p className="text-muted-foreground leading-relaxed">
              The directory is also a free, read-only MCP server, so Claude, Cursor, VS Code and other AI agents can search
              plugins and templates while they work on your project. Setup for each client is on the{" "}
              <a
                href="/mcp"
                className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
              >
                MCP page
              </a>
              .
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
