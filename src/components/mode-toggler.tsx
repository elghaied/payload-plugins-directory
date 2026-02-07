"use client"

import * as React from "react"
import { Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"

const modes = ["light", "dark", "system"] as const

const modeConfig = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
} as const

export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const currentMode = (mounted && theme && theme in modeConfig)
    ? (theme as keyof typeof modeConfig)
    : "system"

  const cycle = () => {
    const idx = modes.indexOf(currentMode)
    setTheme(modes[(idx + 1) % modes.length])
  }

  const { icon: Icon, label } = modeConfig[currentMode]

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-all duration-200 cursor-pointer border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Current: ${label}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {mounted && <span className="hidden sm:inline text-xs">{label}</span>}
    </button>
  )
}
