import Link from "next/link";
import { Metadata } from "next";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "About — Payload CMS Plugin Directory",
  description:
    "Learn how the Payload CMS Plugin Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  openGraph: {
    title: "About — Payload CMS Plugin Directory",
    description:
      "Learn how the Payload CMS Plugin Directory works, how plugins are discovered automatically from GitHub, and how to build and list your own plugin.",
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <Link
            href="/"
            replace
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            &larr; Back to directory
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-4">About</h1>
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
                    "The directory refreshes twice daily via GitHub Actions, so new plugins and updates appear without any manual intervention.",
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
