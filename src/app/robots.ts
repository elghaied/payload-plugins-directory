import type { MetadataRoute } from "next";
import { getServerURL, isProductionSite } from "@/lib/serverUrl";

// Evaluated per request: the same image serves every environment (SERVER_URL is runtime-only).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite(getServerURL())) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${getServerURL()}/sitemap.xml`,
  };
}
