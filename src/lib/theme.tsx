import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { api, type Me } from "@/lib/api"
import { fields, loadConfig, saveConfig } from "@/lib/config"

/**
 * The theme's own view of the operator's settings: the resolved values, whether
 * the viewer may write them, and a writer. The drawer edits this object and the
 * page re-renders under it, which is the point of offering the form on the
 * public page at all -- colours and backgrounds are tuned by looking at them.
 */
type ThemeValue = {
  values: Record<string, unknown>
  me: Me | null
  /** Null until the first `/api/me` answers; the drawer only offers saving when true. */
  canSave: boolean
  save: (next: Record<string, unknown>) => Promise<void>
  /** Show a candidate setting without writing it, so the drawer can be looked at. */
  preview: (next: Record<string, unknown>) => void
  /** Put the last saved settings back, for a drawer that was closed or cancelled. */
  revert: () => void
}

const Ctx = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((f) => [f.key, f.default])))
  const [me, setMe] = useState<Me | null>(null)

  // The last settings the hub confirmed. A drawer that is cancelled or closed
  // puts these back, so a preview can never outlive the form that showed it.
  const saved = useRef<Record<string, unknown> | null>(null)
  /** True while a drawer is showing unsaved values; the hub's answer must not wipe them. */
  const previewing = useRef(false)

  useEffect(() => {
    let live = true
    // Both start together and neither is awaited by the other: the settings
    // request is a nicety, the node list is the page.
    loadConfig().then((loaded) => {
      if (!live) return
      // A drawer opened before the settings arrived is already previewing; it
      // keeps the screen, but the hub's answer becomes what 取消 goes back to.
      saved.current = loaded
      setValues((current) => (previewing.current ? current : loaded))
    })
    api<Me>("/me")
      .then((got) => {
        if (live) setMe(got)
      })
      .catch(() => {
        // A hub that cannot answer /api/me still renders the page; the settings
        // drawer is simply not offered.
        if (live) setMe(null)
      })
    return () => {
      live = false
    }
  }, [])

  const save = useCallback(
    async (next: Record<string, unknown>) => {
      await saveConfig(next)
      saved.current = next
      previewing.current = false
      setValues(next)
    },
    [],
  )

  /**
   * Show a candidate setting without writing it. The drawer calls this on every
   * edit, because a colour picker whose choice only appears after 保存 reads as
   * broken -- the whole reason the form is on the public page is to be looked at.
   */
  const preview = useCallback((next: Record<string, unknown>) => {
    setValues((current) => {
      if (!previewing.current) {
        previewing.current = true
        saved.current ??= current
      }
      return next
    })
  }, [])

  const revert = useCallback(() => {
    previewing.current = false
    if (saved.current) setValues(saved.current)
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({ values, me, canSave: me?.authed === true, save, preview, revert }),
    [values, me, save, preview, revert],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(Ctx)
  if (!value) throw new Error("useTheme outside ThemeProvider")
  return value
}

/** A setting read with the type its declaration promises. */
export function useFlag(key: string, fallback = false): boolean {
  const { values } = useTheme()
  const v = values[key]
  return typeof v === "boolean" ? v : fallback
}

export function useText(key: string, fallback = ""): string {
  const { values } = useTheme()
  const v = values[key]
  return typeof v === "string" ? v : fallback
}
