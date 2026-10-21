"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Github, Rss, Search } from "lucide-react"
import { PayloadIcon } from "./PayloadIcon"
import { BrandMark } from "./BrandMark"
import { AccountMenu } from "./AccountMenu"
import { ModeToggle } from "./mode-toggler"
import { NAV_LINKS, isActiveLink } from "./navLinks"

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-lg supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 gap-2 sm:gap-4">
        {/* Left: logo mark + wordmark + text nav links */}
        <div className="flex items-center gap-2 sm:gap-6">
          <Link
            href="/"
            aria-label="Payload Plugin Directory, home"
            className="flex items-center gap-2 font-semibold tracking-tight text-foreground hover:opacity-80 transition-opacity"
          >
            <BrandMark />
            <span className="hidden md:inline whitespace-nowrap">Plugin Directory</span>
          </Link>

          <div className="flex items-center gap-0.5 sm:gap-1">
            {NAV_LINKS.map(({ href, label }) => {
              const isActive = isActiveLink(href, pathname)

              return (
                <Link
                  key={href}
                  href={href}
                  className={`${href === "/about" ? "hidden min-[440px]:block" : ""} px-1.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
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
          <Link
            href="/search"
            className={`flex items-center justify-center h-8 w-8 shrink-0 rounded-md transition-colors ${
              isActiveLink("/search", pathname)
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            aria-label="Search plugins"
            title="Search"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href="https://github.com/payloadcms/payload"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="Payload CMS GitHub"
            title="Payload CMS"
          >
            <PayloadIcon className="h-4 w-4" />
          </a>
          <a
            href="https://github.com/elghaied/payload-plugins-directory"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="Directory GitHub"
            title="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <a
            href="/feed.xml"
            className="hidden min-[400px]:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="RSS Feed"
            title="RSS Feed"
          >
            <Rss className="h-4 w-4" />
          </a>

          <Link
            href="/submit"
            className="hidden lg:flex items-center h-8 px-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            Submit
          </Link>

          <div className="hidden sm:block w-px h-5 bg-border mx-1" />

          <AccountMenu />
          <ModeToggle />
        </div>
      </div>
    </nav>
  )
}
