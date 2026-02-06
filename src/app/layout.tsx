import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SpeedInsights } from "@vercel/speed-insights/next"
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Payload CMS Plugin Directory — Discover Community & Official Plugins",
  description:
    "Browse and discover 160+ Payload CMS plugins. Filter by version (v1, v2, v3), sort by stars, forks, or recent updates. Find official and community plugins for your Payload project.",
  metadataBase: new URL("https://payload-plugins-directory.vercel.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Payload CMS Plugin Directory",
    description:
      "Browse and discover 160+ Payload CMS plugins. Filter by version, sort by popularity, and find the right plugin for your project.",
    url: "https://payload-plugins-directory.vercel.app",
    siteName: "Payload Plugin Directory",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payload CMS Plugin Directory",
    description:
      "Browse and discover 160+ Payload CMS plugins. Filter by version, sort by popularity, and find the right plugin for your project.",
  },
  keywords: [
    "payload cms",
    "payload plugins",
    "payload cms plugins",
    "payload v3 plugins",
    "payload v2 plugins",
    "headless cms plugins",
    "payload plugin directory",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
         <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
           
        {children}
        </ThemeProvider>
        <SpeedInsights/>
      </body>
    </html>
  );
}
