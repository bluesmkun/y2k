import { useEffect, useRef, useState } from "react"

import { declared, fields, type Field } from "@/lib/config"
import { useTheme } from "@/lib/theme"

/**
 * The theme's own settings form. It is offered only to an authenticated
 * operator, because saving needs a session: the hub checks the same thing and
 * refuses a PUT from anyone else. It edits the same object the hub's own panel
 * edits, which is the point -- colours and density are chosen by looking at the
 * page they change, and this drawer is over it.
 *
 * Every edit is previewed on the page immediately. A form whose only feedback is
 * after 保存 reads as broken when the setting is a colour: the operator picks
 * 蒸汽波, sees nothing move, and concludes the switch does not work.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const { values, save, preview, revert } = useTheme()
  const [draft, setDraft] = useState<Record<string, unknown>>(values)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const committed = useRef(false)

  // The page behind the drawer is showing `draft` the whole time it is open, so
  // leaving without saving has to put the saved values back. The cleanup covers
  // every way out -- 取消, the backdrop, Escape, a route change.
  useEffect(
    () => () => {
      if (!committed.current) revert()
    },
    [revert],
  )

  // Every write goes through here so the draft and the page never diverge, and
  // a multi-key change (恢复默认) is one preview rather than one per field.
  const apply = (next: Record<string, unknown>) => {
    setDraft(next)
    preview(next)
  }

  const edit = (key: string, v: unknown) => apply({ ...draft, [key]: v })

  const defaults = () => apply(Object.fromEntries(fields.map((f) => [f.key, f.default])))

  const write = async () => {
    setBusy(true)
    setError("")
    try {
      await save(draft)
      committed.current = true
      onClose()
    } catch (e) {
      // The hub's own message is one line of plain text written for the reader;
      // anything else came from a proxy and is already generic in the error.
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="主题设置" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="chrome-text">主题设置</h2>
        <p className="faint" style={{ margin: "0 0 4px", fontSize: 11.5 }}>
          改动会立即预览，保存后生效；取消则还原
        </p>

        {declared.map((entry, i) =>
          entry.type === "title" ? (
            <div className="group" key={`h${i}`}>
              {entry.label}
            </div>
          ) : (
            <Control key={entry.key} field={entry} value={draft[entry.key]} onChange={(v) => edit(entry.key, v)} />
          ),
        )}

        {error && <div className="banner">{error}</div>}

        <div className="drawer-actions">
          <button type="button" className="btn" data-on="true" disabled={busy} onClick={write}>
            {busy ? "保存中…" : "保存"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn" onClick={defaults}>
            恢复默认
          </button>
        </div>
      </div>
    </div>
  )
}

function Control({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const label = field.label || field.key
  return (
    <div className="field">
      {field.type === "boolean" ? (
        <label className="switch">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      ) : (
        <label>
          {label}
          {field.type === "select" ? (
            <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
              {field.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label ?? o.value}
                </option>
              ))}
            </select>
          ) : field.type === "number" ? (
            <input
              type="number"
              value={String(value ?? "")}
              min={field.min}
              max={field.max}
              onChange={(e) => {
                const n = Number(e.target.value)
                // An emptied field is not zero: it is a value the operator has
                // not finished typing, and writing NaN would break the panel's
                // own validation on save.
                if (Number.isFinite(n)) onChange(n)
              }}
            />
          ) : field.type === "text" ? (
            <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          )}
        </label>
      )}
      {field.help && <span className="hint">{field.help}</span>}
    </div>
  )
}
