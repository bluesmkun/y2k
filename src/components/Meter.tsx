/**
 * The segmented LED meter: a recessed trough, a lit fill, and a cell mask that
 * cuts the fill into blocks. The cell mask is drawn as an overlay rather than as
 * individual lit segments, so the fill can still animate its width smoothly
 * while the eye reads discrete cells.
 *
 * `value: null` is the empty meter: the trough stays, unlit, and the detail is
 * an em dash. A card for a node that is down keeps its whole row of meters this
 * way, so it is the same height as its neighbours and the columns still line up
 * down the page -- a missing figure shown as a missing figure, rather than as a
 * shorter card.

 * `level` overrides the colour band, for a figure whose danger is not its
 * magnitude; it is ignored by the empty meter, which has no magnitude to judge.
 */
export function Meter({
  label,
  value,
  detail,
  level,
}: {
  label: string
  /** 0-100 or higher; a plan used past its quota reads over 100. `null` = no data. */
  value: number | null
  detail: string
  /** Overrides the colour band, for a figure whose danger is not its magnitude. */
  level?: "ok" | "warn" | "bad"
}) {
  const empty = value === null || !Number.isFinite(value)

  if (empty) {
    return (
      <div className="meter" data-empty="true">
        <span className="label">{label}</span>
        <div className="trough">
          <div className="cells" />
        </div>
        <span className="val">{detail}</span>
      </div>
    )
  }

  const clamped = Math.max(0, Math.min(100, value))
  const tone = level ?? (value >= 90 ? "bad" : value >= 75 ? "warn" : "ok")
  return (
    <div className="meter">
      <span className="label">{label}</span>
      <div className="trough" data-level={tone}>
        <div className="fill" style={{ width: `${clamped}%` }} />
        <div className="cells" />
      </div>
      <span className="val">{detail}</span>
    </div>
  )
}
