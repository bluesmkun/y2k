/**
 * The segmented LED meter: a recessed trough, a lit fill, and a cell mask that
 * cuts the fill into blocks. The cell mask is drawn as an overlay rather than as
 * individual lit segments, so the fill can still animate its width smoothly
 * while the eye reads discrete cells.
 */
export function Meter({
  label,
  value,
  detail,
  level,
}: {
  label: string
  /** 0-100 or higher; a plan used past its quota reads over 100. */
  value: number
  detail: string
  /** Overrides the colour band, for a figure whose danger is not its magnitude. */
  level?: "ok" | "warn" | "bad"
}) {
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
