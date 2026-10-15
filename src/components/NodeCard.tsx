import { ago, bytes, cycle, daysUntil, money, monthUsage, osName, pairShort, percent, rate, sinceSeen, uptime } from "@/lib/format"
import { CARRIERS, latencyTone, useLatency, type Latency } from "@/lib/latency"
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
 * The three-network latency block on a card: latency over loss.
 *
 * The node list carries no latency, so this reads its own node's ping rows (see
 * `@/lib/latency` for the caching, the concurrency cap, and the probe-to-carrier
 * folding) and shows one figure per carrier.
 *
 * Both rows are drawn in every state -- reporting, waiting for the first answer,
 * no probe configured, and offline. A node that is not reporting used to keep
 * its latency row but lose its loss row, which made it a different height from
 * its neighbours and left the numbers below it at a different height in the
 * list; a card that goes down must not change shape, and the same is true of a
 * card whose carriers happen to be clean. The second row is therefore a fixture:
 * its figure is an em dash when there is nothing to report, and it only turns
 * amber when some carrier is actually losing packets.
 *
 * A node with no probe at all is not the same as one whose carriers are clean --
 * the first has nothing configured and says so; the second has been measured and
 * answered -- so the two do not share a word.
 */
function LatencyPlate({ id, enabled }: { id: number; enabled: boolean }) {
  const rows = useLatency(id, enabled)

  const waiting = !enabled || rows === null
  const silent = rows !== null && rows.length === 0
  // The carriers are named from the response when there is one; with no answer
  // yet -- and on a node that is not reporting -- the three fixed columns are
  // drawn empty rather than invented: a missing measurement must never read as
  // a bad one.
  const roster: Latency =
    rows && rows.length > 0 ? rows : CARRIERS.map((carrier) => ({ id: carrier.key, name: carrier.name, ms: null, loss: null }))
  const lossy = !waiting && !silent && roster.some((row) => (row.loss ?? 0) > 0)

  return (
    <div className="latency-block">
      <div className={waiting ? "plate probes faint" : "plate probes"}>
        {silent ? (
          <span className="none">无延迟数据</span>
        ) : (
          roster.map((row) => (
            <span key={row.id}>
              <span className="faint">{row.name}</span>
              <span style={waiting ? undefined : { color: latencyTone(row.ms) }}>
                {waiting ? "…" : row.ms === null ? "超时" : `${row.ms.toFixed(0)}ms`}
              </span>
            </span>
          ))
        )}
      </div>
      {/* The loss row. Its columns are the carriers' own, in the same order, so
          the two rows read down the card as one instrument; it is a size smaller
          because loss is the exception, not the number anyone opens the page
          for, and that size is fixed rather than conditional so the row is the
          same height whether or not it is tinted. */}
      <div className={lossy ? "plate probes loss" : "plate probes loss faint"} data-loss={lossy ? "on" : undefined}>
        {roster.map((row) => (
          <span key={row.id} title={row.loss ? `丢包 ${row.loss.toFixed(2)}%` : waiting || silent ? "尚无数据" : "无丢包"}>
            {row.loss && !waiting && !silent ? `↓${row.loss.toFixed(row.loss < 10 ? 1 : 0)}%` : "—"}
          </span>
        ))}
      </div>
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
            report keeps the red lamp: that one is a fault.

            The lamp is the only status readout: a lit green LED with a wide
            bloom, an amber one that is still, and a dark one for anything down.
            The text badge that used to sit on the right said the same thing a
            second time and pulled the eye away from the node name. */}
        <span
          className="lamp"
          data-on={node.online && !node.broken ? "true" : "false"}
          data-pending={node.online && !live && !node.broken ? "true" : undefined}
          title={node.broken ? "上报异常" : !node.online ? "离线" : live ? "在线" : "等待上报"}
        />
        <span className="name" title={node.name}>
          {node.name}
        </span>
        {showFlags && <Country code={node.country} />}
      </div>

      {/* The OS / arch / kernel line. A wide card keeps it on one line; a narrow
          one breaks it in two, because the distro name is by far the longest of
          the three fields and on one line it takes the width and pushes the
          architecture and the kernel off the end -- the two fields that
          actually differ between machines. The break is driven by the card's own
          width, so every card in a row (all the same width) breaks the same way
          and nothing drifts out of step down the list. The whole line is on the
          tooltip, and each half still ends in an ellipsis.

          The architecture and the kernel share one span so that the second line
          is a single run: whatever room is left over after the architecture
          goes to the kernel, which is the field that can afford to be cut. */}
      <div
        className="plate ellipsis"
        title={[osName(node.os) || "未知系统", `${node.arch || "?"} · ${node.cpu_cores} 核`, `内核 ${node.kernel || "?"}`].join(" · ")}
      >
        <span className="spec-os">{osName(node.os) || "未知系统"}</span>
        <span className="sep">|</span>
        <span className="spec-rest">
          <span className="spec-arch">
            {node.arch || "?"} · {node.cpu_cores} 核
          </span>
          <span className="sep">|</span>
          <span className="spec-kernel">内核 {node.kernel || "?"}</span>
        </span>
      </div>

      {/*
        The live block keeps its rows even when there is nothing to put in them.
        A node that is down used to collapse to a single line of prose, which
        made its card a different height from its neighbours and left the list
        with a hole in the middle of a row; worse, the rows below it (traffic,
        latency, price) then sat at a different height than on every other card,
        so nothing could be compared by scanning down a column. The rows stay,
        the figures are replaced by an em dash, and the whole card dims -- which
        is the more honest way to say "this machine is not reporting".
      */}
      {live ? (
        <div className="meters">
          <Meter label="CPU" value={m.cpu} detail={`${m.cpu.toFixed(1)}%`} />
          <Meter label="内存" value={percent(m.mem_used, m.mem_total)} detail={pairShort(m.mem_used, m.mem_total)} />
          <Meter label="硬盘" value={percent(m.disk_used, m.disk_total)} detail={pairShort(m.disk_used, m.disk_total)} />
          {showNet && (
            /* 两端对齐：同一个 pair，左右各占一半。卡片窄时中间的空隙是
               唯一能把 ↓ 和 ↑ 分开又对得很齐的办法。 */
            <div className="plate pair">
              <span style={{ color: "var(--ok)" }}>↓ {rate(m.net_rx)}</span>
              <span style={{ color: "var(--accent)" }}>↑ {rate(m.net_tx)}</span>
            </div>
          )}
          <div className="plate">
            <span>负载 {m.load.map((v) => v.toFixed(2)).join(" / ")}</span>
            <span className="sep">|</span>
            <span>进程 {m.procs}</span>
            <span className="sep">|</span>
            <span>连接 {m.tcp + m.udp}</span>
          </div>
        </div>
      ) : (
        <div className="meters">
          <Meter label="CPU" value={null} detail="—" />
          <Meter label="内存" value={null} detail="—" />
          <Meter label="硬盘" value={null} detail="—" />
          {showNet && (
            <div className="plate pair faint">
              <span>↓ —</span>
              <span>↑ —</span>
            </div>
          )}
          <div className="plate faint">
            <span>负载 — / — / —</span>
            <span className="sep">|</span>
            <span>进程 —</span>
            <span className="sep">|</span>
            <span>连接 —</span>
          </div>
        </div>
      )}

      {(showTraffic || showLatency) && (
        <div className="meters">
          {/* An unlimited allowance is still drawn as a meter, and its figure is
              still the period's usage: "no ceiling" is not "nothing to report",
              and the bar's shape is what tells a reader how much of the plan is
              gone. The word for the missing ceiling goes on the row itself --
              the trough is hatched -- so the usage stays where every other
              card's usage is. */}
          {showTraffic &&
            (node.traffic_limit > 0 ? (
              <Meter label="流量" value={quota} detail={pairShort(used, node.traffic_limit)} />
            ) : (
              <Meter label="不限量" uncapped detail={bytes(used)} />
            ))}
          {showLatency && <LatencyPlate id={node.id} enabled={live} />}
        </div>
      )}

      {showRemark && node.public_remark && <p className="remark">{node.public_remark}</p>}

      <div className="card-foot">
        {/* The reason a node is not reporting belongs on the foot, next to the
            uptime it replaces. It used to occupy the whole live block, which
            is what made a down card a different shape from every other card;
            here it is one line that the foot already had room for. */}
        <span title="运行时长" className={live ? undefined : "faint"}>
          {live ? `运行 ${uptime(m.uptime)}` : quiet(node)}
        </span>
        {showPrice && (node.price > 0 || expires !== undefined) && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {node.price > 0 && <span>{money(node.price, node.currency)}</span>}
            {node.billing_cycle && <span className="faint">{cycle(node.billing_cycle)}</span>}
            {/* 无限期要单独占一个徽标：`expires_in` 为 null 是「没有到期日」，
                而不是「不知道」。只画有期限的节点会让免费节点和永久节点
                在页面上长得一样，看不出要不要续。 */}
            {expires !== undefined && (
              <span className="badge" data-tone={expiryTone ?? "ok"}>
                {days === null ? "无限期" : days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`}
              </span>
            )}
          </span>
        )}
      </div>
    </button>
  )
}
