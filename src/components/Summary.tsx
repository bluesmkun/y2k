import { useEffect, useState } from "react"

import { bytes, money, monthUsage, monthlyCost, percent, rate, residualValue } from "@/lib/format"
import { type Node } from "@/lib/api"
import { rate as convert, DEFAULT_RATE_URL, useRates, type Rates } from "@/lib/rates"
import { useText, useFlag } from "@/lib/theme"

/**
 * The tiles above the grid.
 *
 * Throughput is one tile rather than two: down and up are the same quantity read
 * in opposite directions, and side by side on one scale the pair is legible at a
 * glance -- which is the whole reason a status page has them.
 *
 * The cost tile is the fleet's money. The hub bills each node in its own currency
 * and over its own cycle, so the two figures are: what the fleet costs per month
 * (each price divided by its cycle, then summed) and what is about to be charged
 * this calendar month (nodes whose renewal date falls in it). A node's own
 * currency is only replaced when the operator has chosen a display currency and a
 * rate for the pair exists; otherwise the original is shown, because a wrong
 * number is worse than a foreign one.
 */

// The tick is what kept the sparkline moving before the sparkline went. It also
// still does something real: the tiles read quantities that the socket mutates
// outside React, and without a slow re-render a fleet that changes state would
// keep yesterday's figures on screen until something else moved.
export function Summary({ nodes }: { nodes: Node[] }) {
  const [, tick] = useState(0)

  const currency = useText("currency", "")
  const rateUrl = useText("rate_url", "") || DEFAULT_RATE_URL
  const showPrice = useFlag("show_price", true)
  // No cost tile means no reason to tell a third party this page was opened.
  const rates = useRates(rateUrl, currency !== "" && showPrice)

  // `speedHistory` is mutated by the socket, outside React; a slow tick keeps the
  // sparkline moving without re-rendering on every frame for the same shape.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(id)
  }, [])

  // The hub's own verdict, not "has figures": a node that connected and has not
  // reported yet is up, and counting it as down would understate the fleet on
  // exactly the minute it comes back. The speed sums below do need figures, so
  // they keep their own filter.
  const online = nodes.filter((n) => n.online)
  const live = online.filter((n) => n.metrics)
  // The plan's own accounting, not rx+tx: a node on `traffic_mode: "down"` is
  // billed for its download alone, and summing both would overstate the fleet.
  const used = nodes.reduce((sum, n) => sum + monthUsage(n), 0)
  const monthRx = nodes.reduce((sum, n) => sum + (n.month_rx || 0), 0)
  const monthTx = nodes.reduce((sum, n) => sum + (n.month_tx || 0), 0)
  const down = live.reduce((sum, n) => sum + (n.metrics?.net_rx ?? 0), 0)
  const up = live.reduce((sum, n) => sum + (n.metrics?.net_tx ?? 0), 0)

  const paid = nodes.filter((n) => n.price > 0)

  return (
    <div className="summary">
      <div className="stat panel">
        <div className="k">节点</div>
        <div className="v">
          {online.length}
          <span className="faint" style={{ fontSize: 13 }}>
            {" "}
            / {nodes.length}
          </span>
        </div>
        <div className="sub">{nodes.length ? `在线率 ${percent(online.length, nodes.length).toFixed(0)}%` : "暂无节点"}</div>
      </div>

      <div className="stat panel">
        <div className="k">本月流量</div>
        <div className="v">{bytes(used)}</div>
        <div className="sub">
          ↓ {bytes(monthRx)} · ↑ {bytes(monthTx)}
        </div>
      </div>

      {/* 上下行两端对齐：一个 2 列的 grid，左边贴卡片左缘、右边贴右缘。
          比文字两端填空格的写法稳，因为空格宽度随字体变、字号一改就歪。 */}
      <div className="stat panel">
        <div className="k">实时网速</div>
        <div className="v pair">
          <span style={{ color: "var(--ok)" }}>↓ {rate(down)}</span>
          <span style={{ color: "var(--accent)" }}>↑ {rate(up)}</span>
        </div>
        <div className="sub">实时合计</div>
      </div>

      {/* 显示价格与到期 also governs the cost tile: an operator who hides the
          prices on the cards does not want the fleet's bill in the header. */}
      {showPrice && <Cost nodes={paid} currency={currency} rates={rates} />}
    </div>
  )
}

/**
 * The money tile. Two figures, both about the nodes currently on screen:
 *
 *   剩余价值    what the nodes are still worth -- the unused part of every
 *               prepaid period, added up. This is the number that moves down on
 *               its own as days pass, and the one that answers "how much of my
 *               money is still tied up in these machines".
 *   总费用      what they cost per month (each price divided by its cycle).
 *
 * Both follow the selected group tab, because `nodes` is already the filtered
 * list: the tile is a readout of what is on screen, not of the fleet.
 */
function Cost({
  nodes,
  currency,
  rates,
}: {
  nodes: Node[]
  currency: string
  rates: Rates | null
}) {
  const codes = [...new Set(nodes.map((n) => (n.currency || "").toUpperCase()).filter(Boolean))]
  const mixed = codes.length > 1
  const from = codes[0] ?? ""

  // A single-currency fleet is summed first and converted once (one rate, no
  // rounding drift). A mixed fleet has to be converted node by node, because a
  // total across currencies is not a number at all.
  const converted = (() => {
    if (!nodes.length || !currency) return null
    if (!mixed) {
      const left = convert(nodes.reduce((sum, n) => sum + residualValue(n), 0), from, currency, rates)
      const per = convert(nodes.reduce((sum, n) => sum + monthlyCost(n), 0), from, currency, rates)
      return left === null || per === null ? null : { left, per, missing: 0 }
    }
    let totalLeft = 0
    let totalPer = 0
    let missing = 0
    for (const n of nodes) {
      const left = convert(residualValue(n), n.currency, currency, rates)
      const per = convert(monthlyCost(n), n.currency, currency, rates)
      if (left === null || per === null) {
        missing += 1
        continue
      }
      totalLeft += left
      totalPer += per
    }
    // Nothing converted at all (rates not loaded yet, or none of the currencies
    // is in the table): report the failure rather than a total of zero, which
    // would read as "this fleet is free".
    if (missing === nodes.length) return null
    return { left: totalLeft, per: totalPer, missing }
  })()

  // With no display currency the original one is the truth -- but only while
  // there is exactly one of them. A mixed fleet has no single figure to print,
  // and inventing one by adding the numbers up would be a lie with a currency
  // symbol on it.
  const show = currency && converted ? currency : null
  const sum = (amount: number) => (show ? money(amount, show) : money(amount, from))

  if (!nodes.length) {
    return (
      <div className="stat panel">
        <div className="k">费用</div>
        <div className="v">—</div>
        <div className="sub">暂无计费节点</div>
      </div>
    )
  }

  if (!show && mixed) {
    return (
      <div className="stat panel">
        <div className="k">费用</div>
        <div className="v">—</div>
        <div className="sub">
          {currency ? "汇率暂不可用" : "多币种未换算"}
          <span className="faint"> · {currency ? "稍后自动重试" : "设置里选一个显示币种"}</span>
        </div>
      </div>
    )
  }

  // 主数字是剩余价值，副行给总费用。剩余价值比月成本更值得占主位：它每天都
  // 在变，也是「这台机器还剩多少钱」的直接答案；月成本是个稳定的费率，放副行
  // 就够。缺失汇率用省略号徽标挂在主数字后，不占一行版面。
  const residual = nodes.reduce((sum, n) => sum + residualValue(n), 0)
  const monthly = nodes.reduce((sum, n) => sum + monthlyCost(n), 0)
  const leftText = sum(converted?.left ?? residual)
  const perText = sum(converted?.per ?? monthly)
  const missing = show && converted ? converted.missing : 0

  return (
    <div className="stat panel">
      <div className="k">费用</div>
      <div className="v">
        {leftText}
        {missing > 0 && (
          <span className="faint" title={`${missing} 个节点没有可用汇率，未计入合计`}>
            {" "}
            +{missing}
          </span>
        )}
      </div>
      <div className="sub">
        <span>剩余价值</span>
        <span className="faint"> · 总费用 {perText}</span>
      </div>
    </div>
  )
}
