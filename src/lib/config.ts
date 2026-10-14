import manifest from "../../theme.json"
import { api } from "@/lib/api"

type Option = { value: string; label?: string }

/** The five kinds of entry a theme may declare, apart from a group heading. */
export type FieldType = "string" | "text" | "number" | "boolean" | "select"

type Field = {
  key: string
  type: FieldType
  default: unknown
  label?: string
  help?: string
  options?: Option[]
  min?: number
  max?: number
}

/**
 * The operator's settings over the defaults declared in theme.json, which the
 * hub does not store. The panel applies the same checks when saving; they are
 * repeated here because a stored value may come from an older version of this
 * theme, whose declaration was different, and a value that no longer fits must
 * read as unsaved rather than reach a component that cannot render it.
 */
function fits(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= (field.min ?? -Infinity) &&
        value <= (field.max ?? Infinity)
      )
    case "select":
      return field.options?.some((option) => option.value === value) ?? false
    default:
      return typeof value === "string"
  }
}

/** A group heading: a label and nothing else. */
export type Heading = { type: "title"; label?: string }

/** Everything theme.json declares, headings included, in declaration order. */
export const declared = manifest.config as (Field | Heading)[]

/** Group headings (`type` is `title`) carry no value. */
export const fields = declared.filter((f): f is Field => f.type !== "title")

/** The declarations with the operator's values laid over them, in order. */
export function resolve(saved: Record<string, unknown>): Record<string, unknown> {
  const pick = (f: Field) => (fits(f, saved[f.key]) ? saved[f.key] : f.default)
  return Object.fromEntries(fields.map((f) => [f.key, pick(f)]))
}

/**
 * Any failure renders the defaults rather than an error: a hub predating
 * settings answers 404, and a closed status page answers 401 to anonymous
 * callers, neither of which the visitor can act on.
 */
export function loadConfig(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`)
    .then(resolve)
    .catch(() => resolve({}))
}

/**
 * Writes the settings page's values to the hub, where the operator can reach
 * them from every device. Only an authenticated operator may; the panel's own
 * form edits the same object, so the stored one is read first and untouched keys
 * are carried through rather than dropped.
 */
export async function saveConfig(values: Record<string, unknown>): Promise<void> {
  const url = `/api/themes/${manifest.short}/config`
  const read = await fetch(url)
  if (!read.ok) throw new Error((await read.text()).trim() || `读取失败（HTTP ${read.status}）`)
  const next: Record<string, unknown> = await read.json()
  // A value equal to the default is deleted rather than stored: the hub keeps
  // only what the operator changed, so a later release that revises a default
  // reaches the sites that never touched it.
  for (const f of fields) {
    if (values[f.key] === f.default) delete next[f.key]
    else next[f.key] = values[f.key]
  }
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  })
  if (!res.ok) throw new Error((await res.text()).trim() || `保存失败（HTTP ${res.status}）`)
}

export type { Field, Option }
