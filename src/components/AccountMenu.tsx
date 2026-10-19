"use client"

import { Suspense, useEffect, useRef, useState, type RefObject } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { LogIn, LogOut, Package, Plus, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { safeAvatarUrl, signInHref } from "@/lib/auth/avatar"

export type SessionInfo = { login: string; avatarUrl: string | null } | null

const TRIGGER =
  "flex items-center justify-center h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50 ring-1 ring-border overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const SIGNED_OUT_TRIGGER =
  "flex items-center justify-center gap-1.5 h-8 w-8 md:w-auto md:px-3 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50 ring-1 ring-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const PLACEHOLDER = <div className="h-8 w-8 shrink-0" aria-hidden />

/** Session state is fetched client-side so cached public HTML never contains a maintainer's identity. */
function AccountMenuInner() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
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

  return <AccountMenuView session={session} pathname={pathname} search={search ? `?${search}` : ""} logoutFormRef={logoutForm} />
}

export function AccountMenu() {
  // useSearchParams needs a Suspense boundary in statically rendered layouts; the fallback is the same placeholder.
  return (
    <Suspense fallback={PLACEHOLDER}>
      <AccountMenuInner />
    </Suspense>
  )
}

/** Pure view over the session state: undefined = loading, null = signed out. */
export function AccountMenuView({
  session,
  pathname,
  search,
  logoutFormRef,
}: {
  session: SessionInfo | undefined
  pathname: string | null
  search: string
  logoutFormRef: RefObject<HTMLFormElement | null> | null
}) {
  if (session === undefined) return PLACEHOLDER

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={session ? TRIGGER : SIGNED_OUT_TRIGGER}
          aria-label={session ? `Account menu for @${session.login}` : "Sign in"}
        >
          {session?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar from avatars.githubusercontent.com only (safeAvatarUrl); not in next/image's allow-list
            <img src={session.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : session ? (
            <User className="h-4 w-4" />
          ) : (
            <>
              <LogIn className="h-4 w-4" />
              <span className="hidden md:inline text-sm font-medium">Sign in</span>
            </>
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
              <a href={signInHref(pathname, search)}><LogIn className="h-4 w-4" /> Sign in with GitHub</a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/submit"><Plus className="h-4 w-4" /> Submit a plugin</Link>
          </DropdownMenuItem>
          {session && (
            <>
              <DropdownMenuSeparator />
              {/* onSelect + requestSubmit: a submit button inside the item can unmount before it submits. */}
              <DropdownMenuItem onSelect={() => logoutFormRef?.current?.requestSubmit()}>
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Lives outside the menu content so it stays mounted when the menu closes. */}
      {session && <form ref={logoutFormRef} method="post" action="/auth/logout" className="hidden" />}
    </>
  )
}
