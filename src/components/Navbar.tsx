"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Github, Rss } from "lucide-react"
import { PayloadIcon } from "./PayloadIcon"
import { ModeToggle } from "./mode-toggler"

const textLinks = [
  { href: "/", label: "Home" },
  { href: "/stats", label: "Stats" },
  { href: "/about", label: "About" },
] as const

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-lg supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 gap-4">
        {/* Left: Logo + text nav links */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-foreground hover:opacity-80 transition-opacity"
          >
            <PayloadIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Plugins</span>
          </Link>

          <div className="flex items-center gap-1">
            {textLinks.map(({ href, label }) => {
              const isActive = href === "/"
                ? pathname === "/"
                : pathname.startsWith(href)

              return (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </div>
        </div>

        {/* Right: Icon links + theme toggle */}
        <div className="flex items-center gap-1">
          <a
            href="https://github.com/payloadcms/payload"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="Payload CMS GitHub"
            title="Payload CMS"
          >
            <PayloadIcon className="h-4 w-4" />
          </a>
          <a
            href="https://github.com/elghaied/payload-plugins-directory"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="Directory GitHub"
            title="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <a
            href="/feed.xml"
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="RSS Feed"
            title="RSS Feed"
          >
            <Rss className="h-4 w-4" />
          </a>

          <div className="w-px h-5 bg-border mx-1" />

          <ModeToggle />
        </div>
      </div>
    </nav>
  )
}
