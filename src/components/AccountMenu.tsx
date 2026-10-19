"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Github, LogIn, LogOut, Package, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { safeAvatarUrl, signInHref } from "@/lib/auth/avatar"

type SessionInfo = { login: string; avatarUrl: string | null } | null

const TRIGGER =
  "flex items-center justify-center h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50 ring-1 ring-border overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Session state is fetched client-side so cached public HTML never contains a maintainer's identity. */
export function AccountMenu() {
  const pathname = usePathname()
  const logoutForm = useRef<HTMLFormElement>(null)
  const [session, setSession] = useState<SessionInfo | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetch("/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { maintainer: null }))
      .then((d: { maintainer?: { login?: unknown; avatarUrl?: unknown } | null }) => {
        if (cancelled) return
        const m = d.maintainer
        setSession(m && typeof m.login === "string" && m.login ? { login: m.login, avatarUrl: safeAvatarUrl(m.avatarUrl) } : null)
      })
      .catch(() => { if (!cancelled) setSession(null) })
    return () => { cancelled = true }
  }, [])

  if (session === undefined) return <div className="h-8 w-8 shrink-0" aria-hidden />

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          aria-label={session ? `Account menu for @${session.login}` : "Account menu"}
        >
          {session?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar from avatars.githubusercontent.com only (safeAvatarUrl); not in next/image's allow-list
            <img src={session.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <Github className="h-4 w-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {session ? (
            <>
              <DropdownMenuLabel className="font-normal text-muted-foreground">@{session.login}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/me"><Package className="h-4 w-4" /> Your plugins</Link>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem asChild>
              <a href={signInHref(pathname)}><LogIn className="h-4 w-4" /> Sign in with GitHub</a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/submit"><Plus className="h-4 w-4" /> Submit a plugin</Link>
          </DropdownMenuItem>
          {session && (
            <>
              <DropdownMenuSeparator />
              {/* onSelect + requestSubmit: a submit button inside the item can unmount before it submits. */}
              <DropdownMenuItem onSelect={() => logoutForm.current?.requestSubmit()}>
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Lives outside the menu content so it stays mounted when the menu closes. */}
      <form ref={logoutForm} method="post" action="/auth/logout" className="hidden" />
    </>
  )
}
