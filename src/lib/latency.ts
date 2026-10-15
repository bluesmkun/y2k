import { useEffect, useState } from "react"

import { api } from "@/lib/api"

/**
 * Latency for the cards on the list page.
 *
 * The node list carries no latency: `/api/nodes` is nodes, live metrics and
 * traffic only, and the ping rows live behind `/api/nodes/{id}/metrics?series=ping`.
 * There is no bulk endpoint, so a card that wants to show 三网 latency has to ask
 * for its own node. That is one request per visible card, which is why this is
 * not a plain fetch in the component:
 *
 *   - answers are cached for a while, so re-renders and tab switches are free;
 *   - a request already in flight is shared rather than repeated (React's
 *     StrictMode runs effects twice in development, and so does a re-mount);
 *   - at most `MAX` requests are open at once, so a page of forty cards walks
 *     through the hub instead of arriving on it as a burst;
 *   - a hidden tab stops asking, matching what the socket already does.
 *
 * What a card shows is carriers, not probes: see `CARRIERS`.
 */

/** One carrier's current reading, averaged over every probe that maps to it. */
export type Latency = { id: string; name: string; ms: number | null; loss: number | null }[]

type PingRow = { task_id: number; ts: number; latency: number | null; loss?: number }
type Reply = { ping?: PingRow[]; probes?: Record<string, string>; loss?: Record<string, number> }

/** How long an answer stays good. The socket pushes metrics every 2s; latency is
 *  a slower thing to look at, and asking on that cadence would be a burst of
 *  requests per card for a number that barely moves. */
const CACHE_MS = 30_000
const MAX = 4
/** How many of the newest answers are averaged. One sample is a spike. */
const SMOOTH = 5

/**
 * The three carriers a card reports, in the order they are drawn. A hub can
 * carry several probes for the same carrier -- 电信V4, 电信V6, 电信 上海 -- and a
 * card that listed them separately would spend its whole line on one network
 * while the other two went unmentioned. So the card speaks in carriers: every
 * probe whose name contains one of these words is folded into that carrier.
 */
const CARRIERS = [
  { key: "telecom", name: "电信", match: ["电信"] },
  { key: "unicom", name: "联通", match: ["联通"] },
  { key: "mobile", name: "移动", match: ["移动"] },
] as const

export type CarrierKey = (typeof CARRIERS)[number]["key"]

/**
 * Which carrier a probe belongs to, or null when its name matches none. Matching
 * is a plain substring test on the probe's own name, because that name is the
 * only thing the hub gives: 电信V6, 电信 CN2, 上海电信 all carry 电信 and all mean
 * the same network to a reader.
 */
export function carrierOf(name: string): string | null {
  for (const c of CARRIERS) if (c.match.some((word) => name.includes(word))) return c.key
  return null
}

/** The carriers in draw order, resolved from the response's own probe names. */

const cache = new Map<number, { at: number; rows: Latency }>()
const inflight = new Map<number, Promise<Latency>>()
let active = 0
const waiting: (() => void)[] = []

/** Keeps a page of cards from opening every request at the same moment. */
async function gate<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await run()
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

async function read(id: number): Promise<Latency> {
  // A short window: the card shows the current number, not a trend.
  const data = await gate(() => api<Reply>(`/nodes/${id}/metrics?hours=1&points=60&series=ping`))
  const rows = data.ping ?? []
  const probes = data.probes ?? {}
  const ids = [...new Set(rows.map((p) => p.task_id))]

  // Every probe's own reading first, then the carriers are rebuilt from them:
  // an average of averages would weight a carrier with three probes the same as
  // one with a single probe only if the mean were taken over probes, which is
  // exactly what this does not do -- see below.
  const perProbe = ids.map((task) => {
    const own = rows.filter((p) => p.task_id === task)
    const recent: number[] = []
    // Newest first, skipping timeouts: a probe that just dropped one packet
    // still has a latency, and showing it is more useful than showing nothing.
    for (let i = own.length - 1; i >= 0 && recent.length < SMOOTH; i -= 1) {
      const v = own[i].latency
      if (typeof v === "number" && Number.isFinite(v)) recent.push(v)
    }
    const ms = recent.length ? recent.reduce((sum, v) => sum + v, 0) / recent.length : null
    const name = probes[task] ?? `探测 ${task}`
    return { name, ms, key: carrierOf(name), loss: data.loss?.[task] ?? null }
  })

  const out: Latency = []
  for (const carrier of CARRIERS) {
    const own = perProbe.filter((p) => p.key === carrier.key)
    if (!own.length) continue
    // The carrier's latency is the mean of the probes that answered. Probes that
    // timed out are left out of the mean rather than counted as zero or as
    // infinity: the figure is "how long the network takes", and a probe that
    // never answered has no opinion on that. If every probe timed out the
    // carrier shows a timeout, which is the honest reading of "none answered".
    const answered = own.map((p) => p.ms).filter((v): v is number => v !== null)
    const ms = answered.length ? answered.reduce((sum, v) => sum + v, 0) / answered.length : null
    // Loss averages across the carrier's probes the same way, and is null only
    // when the hub reported none for any of them -- 0 would claim a clean line
    // for a carrier the hub said nothing about.
    const losses = own.map((p) => p.loss).filter((v): v is number => v !== null)
    const loss = losses.length ? losses.reduce((sum, v) => sum + v, 0) / losses.length : null
    out.push({ id: carrier.key, name: carrier.name, ms, loss })
  }
  return out
}

function load(id: number): Promise<Latency> {
  const running = inflight.get(id)
  if (running) return running
  const started = read(id).finally(() => inflight.delete(id))
  inflight.set(id, started)
  return started
}

/**
 * The latency of one node, or null while it is unknown. `enabled` is the
 * operator's setting and the node's own state: there is nothing to ask for on a
 * node that is not reporting.
 */
export function useLatency(id: number, enabled: boolean): Latency | null {
  const [rows, setRows] = useState<Latency | null>(null)

  useEffect(() => {
    if (!enabled) {
      setRows(null)
      return
    }
    const hit = cache.get(id)
    if (hit) setRows(hit.rows)

    let live = true
    const tick = async () => {
      if (document.hidden) return
      const now = cache.get(id)
      if (now && Date.now() - now.at < CACHE_MS) {
        if (live) setRows(now.rows)
        return
      }
      try {
        const fresh = await load(id)
        cache.set(id, { at: Date.now(), rows: fresh })
        if (live) setRows(fresh)
      } catch {
        // A card is not the place to report a failed latency read: the page
        // already has one banner for the connection, and a second error per
        // card would bury the node list under the same sentence forty times.
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), CACHE_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [id, enabled])

  return enabled ? rows : null
}

/** Green under 60ms, amber under 150, red beyond: the usual feel of a probe. */
export function latencyTone(ms: number | null): string {
  if (ms === null) return "var(--ink-faint)"
  if (ms < 60) return "var(--ok)"
  if (ms < 150) return "var(--warn)"
  return "var(--bad)"
}
