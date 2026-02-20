import { getPlugins, getPluginsMetadata } from "@/lib/getPlugins";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const plugins = getPlugins();
  const metadata = getPluginsMetadata();

  const recent = [...plugins]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 50);

  const items = recent
    .map(
      (p) => `
    <item>
      <title>${escapeXml(p.name)}</title>
      <link>https://payloaddirectory.dev/plugins/${p.id}</link>
      <description>${escapeXml(p.description)}</description>
      <pubDate>${new Date(p.createdAt).toUTCString()}</pubDate>
      <guid isPermaLink="false">${p.id}</guid>
    </item>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Payload CMS Plugin Directory</title>
    <link>https://payloaddirectory.dev</link>
    <description>New Payload CMS plugins</description>
    <lastBuildDate>${new Date(metadata.lastUpdated).toUTCString()}</lastBuildDate>
    <atom:link href="https://payloaddirectory.dev/feed.xml" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}
