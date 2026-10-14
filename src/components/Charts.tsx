import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { clockFor, quarters, tickClock, timeTicks } from "@/lib/format"
/**
 * Charts are drawn by hand as SVG rather than pulled from a charting library.
 * The theme is one static bundle the hub serves from disk, and a charting
 * dependency would outweigh everything else in it; more to the point, the whole
 * Y2K look is in the furniture -- the recessed plot area, the LED grid, the
 * glowing stroke -- which a general-purpose library would have to be fought.
 */

export type Point = { ts: number; v: number | null }

export type Series = {
  id: string
  name: string
  color: string
  /** Aligned with the chart's `rows`. */
  values: (number | null)[]
  /** The span each bucket's samples covered, for the latency chart. */
  band?: ([number, number] | null)[]
  /** Dashed, for a series the operator should read as secondary. */
  dashed?: boolean
}

/** Element width, tracked so the plot is drawn in real pixels and text stays crisp. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/** Contiguous runs of non-null samples, so a gap breaks the line rather than spanning it. */
function segments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  const paths: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) paths.push(current.join(" "))
      current = []
      return
    }
    current.push(`${current.length ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
  })
  if (current.length > 1) paths.push(current.join(" "))
  return paths
}

/** The isolated samples a broken line would otherwise not show at all. */
function dots(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  const out: { cx: number; cy: number }[] = []
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return
    const before = i > 0 ? values[i - 1] : null
    const after = i < values.length - 1 ? values[i + 1] : null
    if (before === null && after === null) out.push({ cx: x(i), cy: y(v) })
  })
  return out
}

type Props = {
  /** Time stamps of every bucket, ascending; every series' values align with these. */
  rows: { ts: number }[]
  series: Series[]
  height?: number
  /** The axis top. Ignored when `domain` is given. */
  top?: number
  /** A fixed axis, used by the logarithmic rate chart. */
  domain?: [number, number]
  ticks?: number[]
  format: (n: number) => string
  /** Marks the chart as a percentage of a known total. */
  unit?: string
  /** Draw the area under a single series, as the summary sparkline does. */
  area?: boolean
  /** Window width in hours, which decides the tick format. */
  hours: number
  /** Hidden by the legend. */
  hidden?: Set<string>
  onToggle?: (id: string) => void
  /** Latency charts carry a per-probe loss figure in the legend. */
  note?: (id: string) => string | null
}

export function Chart({
  rows,
  series,
  height = 150,
  top,
  domain,
  ticks: fixedTicks,
  format,
  unit,
  area = false,
  hours,
  hidden,
  onToggle,
  note,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [at, setAt] = useState<number | null>(null)

  const shown = series.filter((s) => !hidden?.has(s.id))
  const pad = { l: 54, r: 12, t: 10, b: 22 }
  const inner = Math.max(10, width - pad.l - pad.r)
  const plot = height - pad.t - pad.b

  const lo = domain ? domain[0] : 0
  const hi = domain ? domain[1] : (top ?? 1)
  const log = Boolean(domain)

  const y = useMemo(() => {
    if (log) {
      const l0 = Math.log(lo)
      const l1 = Math.log(hi)
      return (v: number) => pad.t + plot - ((Math.log(Math.max(v, lo)) - l0) / (l1 - l0)) * plot
    }
    return (v: number) => pad.t + plot - ((v - lo) / Math.max(hi - lo, 1e-9)) * plot
  }, [log, lo, hi, pad.t, plot])

  const x = useMemo(() => {
    const first = rows[0]?.ts ?? 0
    const last = rows[rows.length - 1]?.ts ?? first + 1
    const span = Math.max(last - first, 1)
    // A single bucket has no span to divide by; it is drawn at the left edge.
    if (rows.length < 2) return () => pad.l + inner / 2
    return (i: number) => pad.l + ((rows[i].ts - first) / span) * inner
  }, [rows, pad.l, inner])

  const yTicks = useMemo(() => {
    if (fixedTicks?.length) return fixedTicks
    return quarters(hi).filter((v) => v >= lo)
  }, [fixedTicks, hi, lo])

  const xTicks = useMemo(() => {
    if (rows.length < 2) return []
    return timeTicks(rows[0].ts, rows[rows.length - 1].ts, Math.max(2, Math.min(7, Math.floor(inner / 90))))
  }, [rows, inner])

  const label = useMemo(() => {
    if (!xTicks.length) return () => ""
    return tickClock(xTicks, hours)
  }, [xTicks, hours])

  const gridY = yTicks.map(y)
  const picked = at !== null && at >= 0 && at < rows.length ? at : null

  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rows.length < 2) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left
    const ratio = (px - pad.l) / inner
    const index = Math.round(ratio * (rows.length - 1))
    setAt(Math.max(0, Math.min(rows.length - 1, index)))
  }

  const clock = clockFor(hours)

  return (
    <div className="chart-holder">
      <div ref={ref} style={{ width: "100%" }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            onPointerMove={pick}
            onPointerLeave={() => setAt(null)}
            style={{ touchAction: "none" }}
          >
            <defs>
              {shown.map((s) => (
                <linearGradient key={s.id} id={`fill-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.42" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
                </linearGradient>
              ))}
            </defs>

            {/* The recessed plot area, with the grid burned into it. */}
            <rect
              x={pad.l}
              y={pad.t}
              width={inner}
              height={plot}
              fill="rgba(0,0,0,0.28)"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="1"
            />
            {gridY.map((gy, i) => (
              <g key={i}>
                <line className="grid-line" x1={pad.l} x2={pad.l + inner} y1={gy} y2={gy} />
                <text className="tick-text" x={pad.l - 7} y={gy + 3.5} textAnchor="end">
                  {format(yTicks[i])}
                </text>
              </g>
            ))}
            <line className="axis-line" x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + plot} />
            <line className="axis-line" x1={pad.l} x2={pad.l + inner} y1={pad.t + plot} y2={pad.t + plot} />

            {xTicks.map((t, i) => {
              const first = rows[0].ts
              const last = rows[rows.length - 1].ts
              const px = pad.l + ((t - first) / Math.max(last - first, 1)) * inner
              return (
                <g key={i}>
                  <line className="grid-line" x1={px} x2={px} y1={pad.t} y2={pad.t + plot} />
                  <text className="tick-text" x={px} y={height - 6} textAnchor="middle">
                    {label(t)}
                  </text>
                </g>
              )
            })}

            {/* Bands first, so a median line sits on top of its own spread. */}
            {shown.map((s) => (s.band ? <g key={`b-${s.id}`}>{bandPath(s.band, x, y)}</g> : null))}

            {area &&
              shown.map((s) => (
                <path
                  key={`a-${s.id}`}
                  d={areaPath(s.values, x, y, pad.t + plot)}
                  fill={`url(#fill-${s.id})`}
                  stroke="none"
                />
              ))}

            {shown.map((s) => (
              <g key={s.id}>
                {segments(s.values, x, y).map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? "4 4" : undefined}
                    style={{ filter: `drop-shadow(0 0 3px ${s.color})` }}
                  />
                ))}
                {dots(s.values, x, y).map((d, i) => (
                  <circle key={i} cx={d.cx} cy={d.cy} r="2.4" fill={s.color} />
                ))}
              </g>
            ))}

            {picked !== null && (
              <g>
                <line
                  className="axis-line"
                  x1={x(picked)}
                  x2={x(picked)}
                  y1={pad.t}
                  y2={pad.t + plot}
                  stroke="var(--accent-3)"
                />
                {shown.map((s) => {
                  const v = s.values[picked]
                  return v === null || !Number.isFinite(v) ? null : (
                    <circle key={s.id} cx={x(picked)} cy={y(v)} r="3.4" fill={s.color} stroke="#000" strokeWidth="1" />
                  )
                })}
              </g>
            )}
          </svg>
        )}
      </div>

      {/* The crosshair readout sits outside the SVG so it never covers the plot. */}
      <div className="readout">
        {picked !== null ? (
          <>
            <span>{clock(rows[picked].ts)}</span>
            {shown.map((s) => {
              const v = s.values[picked]
              return (
                <span key={s.id} style={{ color: s.color }}>
                  {s.name} {v === null ? "—" : `${format(v)}${unit ?? ""}`}
                </span>
              )
            })}
          </>
        ) : (
          <span className="faint">在图上移动指针读取数值</span>
        )}
      </div>

      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              data-off={hidden?.has(s.id) ? "true" : undefined}
              onClick={() => onToggle?.(s.id)}
            >
              <span className="swatch" style={{ background: s.color }} />
              {s.name}
              {note?.(s.id) ? <span className="faint">{note(s.id)}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The area under a single series, closed along the baseline. */
function areaPath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number, base: number) {
  const points: string[] = []
  let started = false
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return
    if (!started) {
      points.push(`M${x(i).toFixed(2)} ${base}`)
      started = true
    }
    points.push(`L${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
  })
  if (points.length < 2) return ""
  const last = values.length - 1
  return `${points.join(" ")} L${x(last).toFixed(2)} ${base} L${x(0).toFixed(2)} ${base} Z`
}

/** The min-max span of a bucket's samples, as a filled ribbon. */
function bandPath(band: ([number, number] | null)[], x: (i: number) => number, y: (v: number) => number) {
  const up: string[] = []
  const down: string[] = []
  band.forEach((b, i) => {
    if (!b) return
    up.push(`${up.length ? "L" : "M"}${x(i).toFixed(2)} ${y(b[1]).toFixed(2)}`)
    down.unshift(`L${x(i).toFixed(2)} ${y(b[0]).toFixed(2)}`)
  })
  if (up.length < 2) return null
  return <path d={`${up.join(" ")} ${down.join(" ")} Z`} fill="var(--accent-3)" fillOpacity="0.13" stroke="none" />
}

/**
 * A tile's sparkline: no axes, no readout, just the shape of the last minute of
 * samples. `values` are already in display units.
 */
/**
 * Two series sharing one scale, for a tile that shows a direction pair on a
 * single plot. A shared top is the whole point: two separate sparklines each
 * normalised to their own maximum make 2 MB/s up look as busy as 200 MB/s down.
 * The fill is dropped here -- two translucent areas overlap into a third colour
 * that means nothing.
 */
export function Spark2({ a, b, colorA, colorB, height = 26 }: { a: number[]; b: number[]; colorA: string; colorB: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const count = Math.max(a.length, b.length)
  if (count < 2) return <div ref={ref} style={{ height }} />
  const hi = Math.max(...a, ...b, 1e-9)
  const w = Math.max(width, 1)
  const x = (i: number) => (i / (count - 1)) * w
  const y = (v: number) => height - 3 - (v / hi) * (height - 7)
  const line = (values: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={w} height={height} aria-hidden="true">
          {a.length > 1 && <path d={line(a)} fill="none" stroke={colorA} strokeWidth="1.4" />}
          {b.length > 1 && <path d={line(b)} fill="none" stroke={colorB} strokeWidth="1.4" />}
        </svg>
      )}
    </div>
  )
}
