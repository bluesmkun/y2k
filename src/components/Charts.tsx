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
  /** Window width in hours, which decides the tick format. */
  hours: number
  /** Hidden by the legend. */
  hidden?: Set<string>
  onToggle?: (id: string) => void
  /** Latency charts carry a per-probe loss figure in the legend. */
  note?: (id: string) => string | null
  /**
   * Drop the legend below the plot. Used where the same information sits above
   * the chart in buttons, so a second copy under the axes is just noise -- and
   * the one under the axes cannot be seen from a tall chart without scrolling.
   */
  noLegend?: boolean
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
  hours,
  hidden,
  onToggle,
  note,
  noLegend = false,
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
            {/* The CRT face behind the trace: a dark phosphor floor with a fine
                scanline raster burned into it, clipped to the plot area. Drawn
                before the grid so the grid sits on top, the way a scope's
                graticule is etched in front of the phosphor. */}
            <defs>
              <pattern id="scope-raster" width="4" height="4" patternUnits="userSpaceOnUse">
                <rect width="4" height="2" fill="rgba(255,255,255,0.028)" />
              </pattern>
              <clipPath id="scope-clip">
                <rect x={pad.l} y={pad.t} width={inner} height={plot} />
              </clipPath>
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
            <rect
              x={pad.l}
              y={pad.t}
              width={inner}
              height={plot}
              fill="url(#scope-raster)"
              pointerEvents="none"
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

            {/* No shaded band behind the lines. A min/max ribbon was drawn in a
                single accent colour that did not belong to the line it sat
                under, so on a chart with one series it read as a coloured block
                pasted into the plot rather than as that line's spread; on a
                chart where the hub reports no `_max` at all (memory, disk) there
                was no ribbon and the chart looked like a different instrument.
                The peak is reported in the panel's own corner instead, and the
                CRT look comes from the trace itself (below) on every chart
                alike. */}

            {shown.map((s) => (
              <g key={s.id}>
                {/* The phosphor, in two passes: a wide dim bloom that lifts even a
                    dark trace off the recessed plot (memory's violet was the one
                    that disappeared -- the same two passes at the same widths
                    read as a heavy glow on cyan and as nothing on violet, because
                    the halo's brightness is the colour's own), then a tight
                    bright one that gives the line its edge. The crisp trace on
                    top keeps the figures legible; the bloom is what makes the
                    four panels -- and the latency panel -- the same instrument. */}
                {segments(s.values, x, y).map((d, i) => (
                  <path
                    key={`b${i}`}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="7"
                    strokeLinecap="round"
                    opacity="0.13"
                    clipPath="url(#scope-clip)"
                    style={{ filter: `blur(6px)` }}
                  />
                ))}
                {segments(s.values, x, y).map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="3.4"
                    strokeLinecap="round"
                    opacity="0.38"
                    clipPath="url(#scope-clip)"
                    style={{ filter: `blur(3px)` }}
                  />
                ))}
                {segments(s.values, x, y).map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? "4 4" : undefined}
                    clipPath="url(#scope-clip)"
                    style={{ filter: `drop-shadow(0 0 4px ${s.color})` }}
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

      {!noLegend && series.length > 1 && (
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

/**
 * Two series sharing one scale, for a panel that shows a direction pair on a
 * single plot. A shared top is the whole point: two separate sparklines each
 * normalised to their own maximum make 2 MB/s up look as busy as 200 MB/s down.
 * The fill is dropped here -- two translucent areas overlap into a third colour
 * that means nothing.
 */
