import { useEffect, useState } from "react"

import { bytes, dueThisMonth, money, monthUsage, monthlyCost, percent, rate } from "@/lib/format"
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
  const monthly = paid.reduce((sum, n) => sum + monthlyCost(n), 0)
  const due = paid.reduce((sum, n) => sum + (dueThisMonth(n.expires_at) ? n.price : 0), 0)

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
      {showPrice && <Cost monthly={monthly} due={due} nodes={paid} currency={currency} rates={rates} />}
    </div>
  )
}

/**
 * The money tile. `monthly` and `due` are already summed in each node's own
 * currency, which is only meaningful when they are all the same one -- so a
 * mixed fleet is converted node by node and the totals are rebuilt from the
 * converted figures rather than from a converted total.
 */
function Cost({
  monthly,
  due,
  nodes,
  currency,
  rates,
}: {
  monthly: number
  due: number
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
      const per = convert(monthly, from, currency, rates)
      const one = convert(due, from, currency, rates)
      return per === null || one === null ? null : { monthly: per, due: one, missing: 0 }
    }
    let totalMonthly = 0
    let totalDue = 0
    let missing = 0
    for (const n of nodes) {
      const per = convert(monthlyCost(n), n.currency, currency, rates)
      const one = convert(n.price, n.currency, currency, rates)
      if (per === null || one === null) {
        missing += 1
        continue
      }
      totalMonthly += per
      if (dueThisMonth(n.expires_at)) totalDue += one
    }
    // Nothing converted at all (rates not loaded yet, or none of the currencies
    // is in the table): report the failure rather than a total of zero, which
    // would read as "this fleet is free".
    if (missing === nodes.length) return null
    return { monthly: totalMonthly, due: totalDue, missing }
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

  // 只留两个数：总费用（每月合计）与本月费用（本月到期）。三级副标题
  // 「每月合计 · 本月到期 ¥x · N 个无汇率」在小卡片上折成两行，而且
  // 无汇率条是排查用的，不是访客要看的。保留缺失提示的口径改为主数字
  // 后跟一个省略号徽标，仍能发现问题但不占版面。
  const monthlyText = sum(converted?.monthly ?? monthly)
  const dueText = sum(converted?.due ?? due)
  const missing = show && converted ? converted.missing : 0

  return (
    <div className="stat panel">
      <div className="k">费用</div>
      <div className="v">
        {monthlyText}
        {missing > 0 && (
          <span className="faint" title={`${missing} 个节点没有可用汇率，未计入合计`}>
            {" "}
            +{missing}
          </span>
        )}
      </div>
      <div className="sub">
        <span>总费用</span>
        <span className="faint"> · 本月 {dueText}</span>
      </div>
    </div>
  )
}
