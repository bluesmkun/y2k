import { useEffect, useMemo, useState } from "react"

import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, bytesTop, cpuName, cycle, daysUntil, despike, despikeWindow, FOREVER, money,
  movingAverage,
  osName, percent, quarters, rate, RATE_FLOOR, rateAxis, trafficMode, uptime, windows, withGaps,
} from "@/lib/format"
import { useTheme } from "@/lib/theme"
import { Chart, type Series } from "@/components/Charts"
import { Country } from "@/components/NodeCard"

/** One bucket of the resource series. `ts` is in seconds, as the hub sends it. */
type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  /** The peak the agent saw within the bucket, never below its mean. Absent before 1.3.1. */
  cpu_max?: number
  net_rx_max?: number
  net_tx_max?: number
  /** Minutes of the bucket that had data, for the online rate. Absent before 1.3.1. */
  minutes?: number
}

/**
 * One probe's bucket. `latency` is the bucket's median round trip, null when
 * every probe in it timed out; `band` is the range its answers spanned, absent
 * when they spanned nothing; `loss` is the percentage that timed out.
 */
type PingPoint = { task_id: number; ts: number; latency: number | null; band?: [number, number]; loss?: number }

type Answer = {
  metrics: Point[]
  ping: PingPoint[]
  probes: Record<string, string>
  /** Proportion of the whole window each probe lost, absent for probes that lost nothing. */
  loss?: Record<string, number>
  /** Seconds each point covers. Absent before 1.3.1. */
  step?: number
}

/** Probe colours, in the order the probes first appear, as the panel orders them. */
const PALETTE = ["#4fd2ff", "#ff6ad5", "#45f0a8", "#ffc44d", "#7b6cff", "#b6f2ff", "#ff5f7e", "#9dff5c"]

export function NodeDetail({ node, onBack, hidePing = false }: { node: Node; onBack: () => void; hidePing?: boolean }) {
  const { me } = useTheme()
  const ranges = useMemo(() => windows(me?.history_days ?? 7), [me])
  const [tab, setTab] = useState<"metrics" | "ping">("metrics")
  // Six hours is the hub's own default window, and it is the one that shows a
  // working day's shape without pretending to be a trend; a hub with a shorter
  // history than that falls back to the longest it offers.
  const [hours, setHours] = useState(() => (ranges.some((r) => r.hours === 6) ? 6 : ranges[0].hours))
  const [data, setData] = useState<Answer | null>(null)
  const [failed, setFailed] = useState("")
  // The two filters the latency chart offers, on by default: they are what makes
  // a probe's own spike readable next to a network that answers in 2 ms.
  const [smooth, setSmooth] = useState(true)
  const [despiked, setDespiked] = useState(true)
  // Hiding probes, rather than soloing one. The panel orders latency charts per
  // probe and there are often three; soloing answers "which one is it" but not
  // "these two together, without that one", which is the question when one of
  // three networks is the problem. Clicking a probe's name or its legend row
  // takes it out; clicking it back puts it in.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  // Hiding the latency tab hides the chart, not the route: the resources are
  // still worth reading, and hiding the whole page would make a shared link to
  // it dead.
  useEffect(() => {
    if (hidePing && tab === "ping") setTab("metrics")
  }, [hidePing, tab])

  // A hub predating the setting keeps a week; asking for more is silently
  // narrowed, which would draw a window under a label claiming more than it holds.
  useEffect(() => {
    if (!ranges.some((r) => r.hours === hours)) setHours(ranges[0].hours)
  }, [ranges, hours])

  useEffect(() => {
    let active = true
    setData(null)
    setFailed("")
    // What this screen can resolve, in device pixels -- the unit the line is
    // drawn in. The hub only thins further, so an approximate figure suffices.
    const points = Math.max(60, Math.min(1440, Math.round(window.innerWidth * (window.devicePixelRatio || 1))))
    // The tab decides which half is requested; the other is a third to two
    // thirds of every response and is never drawn.
    const series = tab === "ping" ? "ping" : "metrics"
    api<Answer>(`/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((e: Error) => {
        if (!active) return
        // A refused request and an empty window are different answers: the hub
        // caps how many history windows it builds at once and refuses with a
        // message written for the reader.
        setFailed(e.message)
        setData({ metrics: [], ping: [], probes: {} })
      })
    return () => {
      active = false
    }
  }, [node.id, hours, tab])

  const m = node.metrics
  const live = node.online && m !== null

  const rows = useMemo(() => {
    const lifted = (v: number) => Math.max(v, RATE_FLOOR)
    const built = (data?.metrics ?? []).map((p) => ({
      ...p,
      ts: p.ts * 1_000,
      cpu_band: [p.cpu, Math.max(p.cpu, p.cpu_max ?? p.cpu)] as [number, number],
      rx: lifted(p.net_rx),
      tx: lifted(p.net_tx),
      rx_band: [lifted(p.net_rx), lifted(p.net_rx_max ?? p.net_rx)] as [number, number],
      tx_band: [lifted(p.net_tx), lifted(p.net_tx_max ?? p.net_tx)] as [number, number],
    }))
    // Broken where the node was silent: a day offline would otherwise draw as a
    // day of steady load.
    return withGaps(built)
  }, [data])

  // The rows carry the band arrays alongside the scalars; each chart reads the
  // keys it needs, and a row inserted for a gap carries neither and reads null.
  const pick = (key: string) => rows.map((r) => (key in r ? (r as Record<string, unknown>)[key] : null))
  const numeric = (key: string) => pick(key).map((v) => (typeof v === "number" ? v : null))
  const banded = (key: string) => pick(key).map((v) => (Array.isArray(v) ? (v as [number, number]) : null))

  const axes = useMemo(() => {
    const max = (pick: (p: Point) => number) => (data?.metrics ?? []).reduce((hi, p) => Math.max(hi, pick(p)), 0)
    // A floor of 4%: tracked exactly, a host that never exceeds 0.4% CPU would get
    // an axis of 0-0.4 and render every scheduler blip as a peak.
    const cpu = axisTop(max((p) => Math.max(p.cpu, p.cpu_max ?? p.cpu)), 4, 100)
    const high = Math.max(max((p) => Math.max(p.net_rx, p.net_rx_max ?? p.net_rx)), max((p) => Math.max(p.net_tx, p.net_tx_max ?? p.net_tx)))
    const low = Math.min(
      (data?.metrics ?? []).reduce((lo, p) => Math.min(lo, p.net_rx, p.net_tx), Infinity),
      Infinity,
    )
    return { cpu, rate: rateAxis(Number.isFinite(low) ? low : RATE_FLOOR, high) }
  }, [data])

  // One series per probe, in the order its samples first appear, which is the
  // panel's own monitoring order.
  const ping = useMemo(() => {
    const samples = data?.ping ?? []
    const ids = [...new Set(samples.map((p) => p.task_id))]
    const stamps = [...new Set(samples.map((p) => p.ts))].sort((a, b) => a - b)
    const at = new Map(stamps.map((t, i) => [t, i]))
    return ids
      .map((id) => {
        const own = samples.filter((p) => p.task_id === id)
        const values: (number | null)[] = Array(stamps.length).fill(null)
        const bands: ([number, number] | null)[] = Array(stamps.length).fill(null)
        const window = despikeWindow(own)
        // Timeouts are retained: dropping them would draw a probe losing half its
        // packets as an unbroken line, and one that never answered not at all.
        // The two filters are applied to the raw readings, independently: the
        // spike filter replaces an outlier with the local median (so a probe
        // that answered 4 000 ms once does not set the whole axis), while the
        // smoother averages over a window of neighbours (so a genuine slow
        // period keeps its height, since its neighbours are slow too).
        const raw = own.map((p) => p.latency)
        const flat = despiked ? despike(raw, window) : raw
        const smoothed = smooth ? movingAverage(flat, window) : flat
        const loRaw = own.map((p) => p.band?.[0] ?? p.latency)
        const hiRaw = own.map((p) => p.band?.[1] ?? p.latency)
        const lo0 = despiked ? despike(loRaw, window) : loRaw
        const hi0 = despiked ? despike(hiRaw, window) : hiRaw
        const lo = smooth ? movingAverage(lo0, window) : lo0
        const hi = smooth ? movingAverage(hi0, window) : hi0
        own.forEach((p, i) => {
          const i2 = at.get(p.ts)!
          values[i2] = smoothed[i]
          const low = lo[i]
          const high = hi[i]
          // The two edges are filtered independently, so a bucket that answered
          // slightly faster than usual can trip the low edge alone and come back
          // above the high one; the span is taken across all three.
          bands[i2] =
            low === null || high === null
              ? null
              : [Math.min(low, high, smoothed[i] ?? low), Math.max(low, high, smoothed[i] ?? low)]
        })
        return {
          id: String(id),
          name: data?.probes?.[id] ?? `探测 ${id}`,
          values,
          bands,
          loss: data?.loss?.[id] ?? 0,
        }
      })
      .filter((s) => s.values.some((v) => v !== null))
  }, [data, smooth, despiked])

  const pingRows = useMemo(() => {
    const samples = data?.ping ?? []
    const stamps = [...new Set(samples.map((p) => p.ts))].sort((a, b) => a - b)
    return stamps.map((ts) => ({ ts: ts * 1_000 }))
  }, [data])

  // The probes the chart actually draws: every one except those the visitor took
  // out. Hiding is not the same as soloing -- the axis covers what is left, so
  // two quiet networks next to a noisy one stop being flattened by it.
  const shown = useMemo(() => ping.filter((s) => !hidden.has(s.id)), [ping, hidden])
  const drawn = shown

  const latencyTop = useMemo(() => {
    let hi = 0
    for (const s of drawn) for (const b of s.bands) if (b) hi = Math.max(hi, b[1])
    return axisTop(hi, 50, 100_000)
  }, [drawn])

  const latencySeries: Series[] = shown.map((s, i) => ({
    id: s.id,
    name: s.name,
    color: PALETTE[i % PALETTE.length],
    values: s.values,
    band: s.bands,
  }))

  // A probe that stopped answering in the selected window has no series; a
  // hide left over on it would keep the chart from ever showing it again.
  useEffect(() => {
    if (!hidden.size) return
    const alive = new Set(ping.map((s) => s.id))
    setHidden((prev) => {
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [ping, hidden])

  const uptimeRate = useMemo(() => {
    const list = data?.metrics ?? []
    const step = data?.step
    if (!step || !list.length) return null
    const full = step / 60
    const have = list.reduce((sum, p) => sum + (p.minutes ?? full), 0)
    return percent(have, full * list.length)
  }, [data])

  const days = node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)

  return (
    <>
      <div className="detail-head">
        <button type="button" className="btn" onClick={onBack}>
          ← 返回
        </button>
        <h2 className="chrome-text">{node.name}</h2>
        <Country code={node.country} />
        {/* Four states, not two: live, offline, connected-but-not-yet-reporting
            (no metrics to draw, but the agent is up), and a report whose figures
            were unusable -- the last is a fault, so it reads as one. */}
        <span className="badge" data-tone={live ? "ok" : node.broken ? "bad" : node.online ? "warn" : "bad"}>
          <span
            className="lamp"
            data-on={node.online && !node.broken ? "true" : "false"}
            data-pending={node.online && !live && !node.broken ? "true" : undefined}
          />
          {live ? "在线" : node.broken ? "数据异常" : node.online ? "等待上报" : "离线"}
        </span>
        {node.agent_version && <span className="badge">agent {node.agent_version}</span>}
      </div>

      <div className="specs">
        <Spec label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ") || "不可用"} />
        <Spec label="CPU" value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`} />
        <Spec label="架构" value={[node.arch, node.virt !== "none" ? node.virt : ""].filter(Boolean).join(" · ") || "不可用"} />
        <Spec label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Spec label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Spec label="本月流量" value={`↓ ${bytes(node.month_rx)} · ↑ ${bytes(node.month_tx)}`} />
        <Spec
          label="续费"
          value={[node.price > 0 ? `${money(node.price, node.currency)} / ${cycle(node.billing_cycle)}` : "免费", days === null || days === undefined ? FOREVER : `${days} 天后到期`].join(" · ")}
        />
        <Spec label="流量策略" value={[node.traffic_limit > 0 ? bytes(node.traffic_limit) : FOREVER, trafficMode(node.traffic_mode)].filter(Boolean).join(" · ")} />
      </div>

      {/* The charts below are the load figures. A row of bars repeating the same
          four numbers in the same units was pure duplication -- what is left is
          what no chart shows: load average, process and connection counts, uptime
          and the current rate. */}
      {live && (
        <div className="plate" style={{ marginBottom: 14 }}>
          <span>负载 {m.load.map((v) => v.toFixed(2)).join(" / ")}</span>
          <span className="sep">|</span>
          <span>进程 {m.procs}</span>
          <span className="sep">|</span>
          <span>连接 {m.tcp + m.udp}</span>
          <span className="sep">|</span>
          <span>运行 {uptime(m.uptime)}</span>
          <span className="sep">|</span>
          <span style={{ color: "var(--ok)" }}>↓ {rate(m.net_rx)}</span>
          <span style={{ color: "var(--accent)" }}>↑ {rate(m.net_tx)}</span>
        </div>
      )}

      <div className="tabs">
        <button type="button" className="tab" data-on={tab === "metrics" ? "true" : undefined} onClick={() => setTab("metrics")}>
          资源
        </button>
        {!hidePing && (
          <button type="button" className="tab" data-on={tab === "ping" ? "true" : undefined} onClick={() => setTab("ping")}>
            延迟
          </button>
        )}
        <span style={{ flex: 1 }} />
        {ranges.map((r) => (
          <button key={r.hours} type="button" className="tab" data-on={hours === r.hours ? "true" : undefined} onClick={() => setHours(r.hours)}>
            {r.label}
          </button>
        ))}
      </div>

      {failed && <div className="banner">{failed}</div>}

      {data === null ? (
        <div className="charts">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : tab === "metrics" ? (
        <div className="charts">
          <Panel title="CPU 占用" note={uptimeRate !== null ? `在线率 ${uptimeRate.toFixed(0)}%` : undefined}>
            <Chart
              height={230}
              rows={rows}
              hours={hours}
              top={axes.cpu}
              ticks={quarters(axes.cpu)}
              format={(n) => `${n.toFixed(0)}%`}
              series={[
                { id: "cpu", name: "平均", color: "#4fd2ff", values: numeric("cpu"), band: banded("cpu_band") },
              ]}
            />
          </Panel>

          <Panel title="内存占用">
            <Chart
              height={230}
              rows={rows}
              hours={hours}
              top={node.mem_total > 0 ? node.mem_total : bytesTop(maxOf(data?.metrics ?? [], (p) => p.mem_used), 1)}
              format={axisBytes}
              series={[{ id: "mem", name: "已用", color: "#7b6cff", values: numeric("mem_used") }]}
            />
          </Panel>

          <Panel title="硬盘占用">
            <Chart
              height={230}
              rows={rows}
              hours={hours}
              top={node.disk_total > 0 ? node.disk_total : bytesTop(maxOf(data?.metrics ?? [], (p) => p.disk_used), 1)}
              format={axisBytes}
              series={[{ id: "disk", name: "已用", color: "#ffc44d", values: numeric("disk_used") }]}
            />
          </Panel>

          <Panel title="网络速率">
            <Chart
              height={230}
              rows={rows}
              hours={hours}
              domain={axes.rate.domain}
              ticks={axes.rate.ticks}
              format={(n) => `${bytes(n, 1)}/s`}
              series={[
                { id: "rx", name: "下行", color: "#45f0a8", values: numeric("rx"), band: banded("rx_band") },
                { id: "tx", name: "上行", color: "#ff6ad5", values: numeric("tx"), band: banded("tx_band") },
              ]}
            />
          </Panel>
        </div>
      ) : ping.length === 0 ? (
        <div className="empty">这段时间没有延迟记录</div>
      ) : (
        <div className="charts">
          <Panel title="网络延迟" note="毫秒，越短越好">
            {/* Filters first, then the probes. The two filters are the only two
                things this chart offers that the resource charts do not: a
                probe's raw samples are noisy enough that the shape of a network
                is unreadable until one or both are on. */}
            <div className="tabs" style={{ marginBottom: 8 }}>
              <button type="button" className="tab" data-on={smooth ? "true" : undefined} onClick={() => setSmooth((v) => !v)}>
                平滑
              </button>
              <button type="button" className="tab" data-on={despiked ? "true" : undefined} onClick={() => setDespiked((v) => !v)}>
                削峰
              </button>
            </div>

            {/* One toggle per probe. 全部 puts every one back; a probe that is
                drawn is named; clicking the name takes it out of the chart, and
                the axis then covers only what is left. The loss figure rides
                along because it is the one thing the line itself cannot show. */}
            {ping.length > 1 && (
              <div className="tabs" style={{ marginBottom: 8 }}>
                <button type="button" className="tab" data-on={hidden.size === 0 ? "true" : undefined} onClick={() => setHidden(new Set())}>
                  全部
                </button>
                {ping.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="tab"
                    data-on={hidden.has(s.id) ? undefined : "true"}
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev)
                        if (next.has(s.id)) next.delete(s.id)
                        else next.add(s.id)
                        return next
                      })
                    }
                  >
                    <span
                      aria-hidden="true"
                      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: latencySeries.find((x) => x.id === s.id)?.color }}
                    />
                    {s.name}
                    {s.loss > 0 && <span className="faint"> 丢包 {s.loss.toFixed(2)}%</span>}
                  </button>
                ))}
              </div>
            )}

            {shown.length === 0 ? (
              <div className="empty">所有探针都已隐藏，点上面的探针名或「全部」恢复</div>
            ) : (
              <Chart
                rows={pingRows}
                hours={hours}
                height={230}
                top={latencyTop}
                format={(n) => `${n.toFixed(0)} ms`}
                hidden={hidden}
                onToggle={(id) =>
                  setHidden((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                note={(id) => {
                  const lost = ping.find((s) => s.id === id)?.loss ?? 0
                  return lost > 0 ? `丢包 ${lost.toFixed(2)}%` : null
                }}
                noLegend
                series={latencySeries}
              />
            )}
          </Panel>
        </div>
      )}
    </>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="chart panel">
      <h3>
        {title}
        {note && <span className="peak">{note}</span>}
      </h3>
      {children}
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="spec">
      <div className="k">{label}</div>
      <div className="v">{value || "不可用"}</div>
    </div>
  )
}

/** The highest value a field reaches, for fitting an axis to a hub that sends no total. */
function maxOf(rows: Point[], pick: (p: Point) => number): number {
  return rows.reduce((hi, p) => Math.max(hi, pick(p)), 0)
}
