import { ago, bytes, cycle, daysUntil, money, monthUsage, osName, pair, percent, rate, sinceSeen, uptime } from "@/lib/format"
import { latencyTone, useLatency } from "@/lib/latency"
import { useFlag } from "@/lib/theme"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"

/**
 * The country as a chip rather than a bitmap flag: the theme ships no image
 * assets, so a flag is either a dependency of several hundred files or an emoji
 * that Windows renders as two letters. A beveled plate with the code is legible
 * everywhere, and the emoji rides along as decoration where it renders.
 */
export function Country({ code }: { code: string }) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null
  const upper = code.toUpperCase()
  const emoji = String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
  return (
    <span className="badge" title={upper}>
      <span aria-hidden="true">{emoji}</span>
      {upper}
    </span>
  )
}

/** The usage figure the plan meters, which is what the quota bar is drawn from. */
export function usage(node: Node): number {
  return monthUsage(node)
}

/**
 * How long a node has been quiet, for the card that has no live figures. Four
 * states arrive here and read differently:
 *
 *   a report arrived with unusable figures   "数据异常"
 *   offline, last seen a while ago           "2 小时前"
 *   online, no report yet                    "已连接，等待首次上报"
 *   never reported at all                    "尚未上报"
 *
 * The last two are the easiest to miss: `online` is true while `metrics` is
 * still null, so treating "no metrics" as "offline" would label a node that just
 * connected with the time it was last down. And a malformed report is a fault,
 * not a fresh node, so it gets its own word rather than either of those.
 */
function quiet(node: Node): string {
  if (node.broken) return "数据异常"
  const seconds = sinceSeen(node)
  const seen = node.last_seen_ago != null || node.last_seen > 0
  if (node.online) return seen ? "已连接，等待首次上报" : "尚未上报"
  if (!seen) return "尚未上报"
  return seconds > 0 ? ago(seconds) : "刚刚离线"
}

/**
 * The three-network latency line on a card. The node list carries no latency, so
 * this reads its own node's ping rows (see `@/lib/latency` for the caching and
 * the concurrency cap) and shows one figure per probe, coloured by how good the
 * number is. Before the first answer -- and on a node that is not reporting --
 * the probes are not invented: the plate shows a quiet placeholder instead, so a
 * missing measurement never reads as a bad one.
 */
function LatencyPlate({ id, enabled }: { id: number; enabled: boolean }) {
  const rows = useLatency(id, enabled)

  if (!enabled) {
    return (
      <div className="plate" style={{ justifyContent: "center" }}>
        <span className="faint">延迟 —</span>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="plate" style={{ justifyContent: "center" }}>
        <span className="faint">延迟读取中…</span>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="plate" style={{ justifyContent: "center" }}>
        <span className="faint">无延迟数据</span>
      </div>
    )
  }

  return (
    <div className="plate">
      {rows.map((row, i) => (
        <span key={row.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {i > 0 && <span className="sep">|</span>}
          <span className="faint">{row.name}</span>
          <span style={{ color: latencyTone(row.ms) }}>{row.ms === null ? "超时" : `${row.ms.toFixed(0)}ms`}</span>
        </span>
      ))}
    </div>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: (id: number) => void }) {
  const showFlags = useFlag("show_flags", true)
  const showPrice = useFlag("show_price", true)
  const showTraffic = useFlag("show_traffic", true)
  const showNet = useFlag("show_net", true)
  const showLatency = useFlag("show_latency", true)
  const showRemark = useFlag("show_remark", true)
  const compact = useFlag("compact", false)

  const m = node.metrics
  const live = node.online && m !== null
  const used = usage(node)
  const quota = percent(used, node.traffic_limit)

  // Older hubs do not send `expires_in`; the browser clock is the fallback, and
  // `null` there means no expiry at all rather than an unknown one.
  const expires = node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
  const days = expires ?? null
  const expiryTone = days === null ? undefined : days < 0 ? "bad" : days <= 7 ? "warn" : "ok"

  return (
    <button
      type="button"
      className="card panel bevel"
      data-glass="on"
      data-offline={live ? undefined : "true"}
      onClick={() => onOpen(node.id)}
    >
      <div className="card-head">
        {/* Three states, not two. A node that has connected but not yet reported
            is reachable -- `online` is true -- while carrying no figures, and a
            red lamp would call it down when the agent is in fact up. A broken
            report keeps the red lamp: that one is a fault. */}
        <span
          className="lamp"
          data-on={node.online && !node.broken ? "true" : "false"}
          data-pending={node.online && !live && !node.broken ? "true" : undefined}
        />
        <span className="name" title={node.name}>
          {node.name}
        </span>
        {showFlags && <Country code={node.country} />}
      </div>

      <div className="plate">
        <span>{osName(node.os) || "未知系统"}</span>
        <span className="sep">|</span>
        <span>
          {node.arch || "?"} · {node.cpu_cores} 核
        </span>
        {!compact && (
          <>
            <span className="sep">|</span>
            <span title={node.kernel}>内核 {node.kernel || "?"}</span>
          </>
        )}
      </div>

      {live ? (
        <div className="meters">
          <Meter label="CPU" value={m.cpu} detail={`${m.cpu.toFixed(1)}%`} />
          <Meter label="内存" value={percent(m.mem_used, m.mem_total)} detail={pair(m.mem_used, m.mem_total)} />
          <Meter label="硬盘" value={percent(m.disk_used, m.disk_total)} detail={pair(m.disk_used, m.disk_total)} />
          {showNet && (
            <div className="plate">
              <span style={{ color: "var(--ok)" }}>↓ {rate(m.net_rx)}</span>
              <span className="sep">|</span>
              <span style={{ color: "var(--accent)" }}>↑ {rate(m.net_tx)}</span>
            </div>
          )}
          {!compact && (
            <div className="plate">
              <span>负载 {m.load.map((v) => v.toFixed(2)).join(" / ")}</span>
              <span className="sep">|</span>
              <span>进程 {m.procs}</span>
              <span className="sep">|</span>
              <span>连接 {m.tcp + m.udp}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="plate" style={{ justifyContent: "center" }}>
          <span>{quiet(node)}</span>
        </div>
      )}

      {(showTraffic || showLatency) && (
        <div className="meters">
          {showTraffic &&
            (node.traffic_limit > 0 ? (
              <Meter label="流量" value={quota} detail={`${bytes(used)} / ${bytes(node.traffic_limit)}`} />
            ) : (
              <div className="plate">
                <span>流量不限量</span>
              </div>
            ))}
          {showLatency && <LatencyPlate id={node.id} enabled={live} />}
        </div>
      )}

      {showRemark && node.public_remark && <p className="remark">{node.public_remark}</p>}

      <div className="card-foot">
        <span title="运行时长">运行 {live ? uptime(m.uptime) : "—"}</span>
        {showPrice && (node.price > 0 || days !== null) && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {node.price > 0 && <span>{money(node.price, node.currency)}</span>}
            {node.billing_cycle && <span className="faint">{cycle(node.billing_cycle)}</span>}
            {days !== null && (
              <span className="badge" data-tone={expiryTone}>
                {days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`}
              </span>
            )}
          </span>
        )}
      </div>
    </button>
  )
}
