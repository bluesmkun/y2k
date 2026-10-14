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
 */

/** One probe's current reading, named from the response's own `probes` map. */
export type Latency = { id: number; name: string; ms: number | null }[]

type PingRow = { task_id: number; ts: number; latency: number | null }
type Reply = { ping?: PingRow[]; probes?: Record<string, string> }

/** How long an answer stays good. The socket pushes metrics every 2s; latency is
 *  a slower thing to look at, and asking on that cadence would be a burst of
 *  requests per card for a number that barely moves. */
const CACHE_MS = 30_000
const MAX = 4
/** How many of the newest answers are averaged. One sample is a spike. */
const SMOOTH = 5

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
  return ids.map((task) => {
    const own = rows.filter((p) => p.task_id === task)
    const recent: number[] = []
    // Newest first, skipping timeouts: a probe that just dropped one packet
    // still has a latency, and showing it is more useful than showing nothing.
    for (let i = own.length - 1; i >= 0 && recent.length < SMOOTH; i -= 1) {
      const v = own[i].latency
      if (typeof v === "number" && Number.isFinite(v)) recent.push(v)
    }
    const ms = recent.length ? recent.reduce((sum, v) => sum + v, 0) / recent.length : null
    return { id: task, name: probes[task] ?? `探测 ${task}`, ms }
  })
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
