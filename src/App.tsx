import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { groupsOf, useNodes, type Node } from "@/lib/api"
import { markdown } from "@/lib/markdown"
import { useFlag, useText, useTheme } from "@/lib/theme"
import { NodeCard } from "@/components/NodeCard"
import { NodeDetail } from "@/components/NodeDetail"
import { Settings } from "@/components/Settings"
import { Summary } from "@/components/Summary"

/**
 * The route is a path, not a hash: the hub falls back to the theme's own
 * index.html for anything it does not own, so `/node/7` is a real URL that can
 * be refreshed, linked and bookmarked. It does mean a reverse proxy in front of
 * the hub has to pass that prefix through -- see README.
 */
const ROUTE = /^\/node\/(\d+)\/?$/

function route(path = location.pathname): number | null {
  const hit = ROUTE.exec(path)
  return hit ? Number(hit[1]) : null
}

/**
 * What the tab row is filtering by.
 *
 * A group's name is arbitrary text -- the hub allows any 13 characters, and
 * "全部", "在线" and "未分组" are all legal group names -- so a status filter
 * cannot be a bare string in the same space as a group: "在线" the group and
 * "online" the filter would be one value. The kind tells them apart, and a group
 * that really is named 在线 keeps working as its own tab.
 */
type Tab = { kind: "all" } | { kind: "group"; name: string } | { kind: "status"; online: boolean }

const ALL: Tab = { kind: "all" }

/** A tab's identity, for React keys and for "is this still a tab". `group:` is
    a prefix rather than a separator, so a group named `status:up` cannot collide. */
function tabId(tab: Tab): string {
  if (tab.kind === "group") return `group:${tab.name}`
  if (tab.kind === "status") return tab.online ? "status:up" : "status:down"
  return "all"
}

function matches(tab: Tab, node: Node): boolean {
  if (tab.kind === "group") return (node.group ?? "") === tab.name
  if (tab.kind === "status") return node.online === tab.online
  return true
}

export function App() {
  const { nodes, error, closed } = useNodes()
  const { canSave } = useTheme()
  const [open, setOpen] = useState<number | null>(() => route())
  const [tab, setTab] = useState<Tab>(ALL)
  const [settings, setSettings] = useState(false)

  const notice = useText("notice", "")
  const skin = useText("skin", "aqua")
  const backdrop = useText("backdrop", "starfield")
  const crt = useFlag("crt", true)
  const glass = useFlag("glass", true)
  const showGroups = useFlag("show_groups", true)
  const showSummary = useFlag("show_summary", true)
  const showLatency = useFlag("show_latency", true)
  const compact = useFlag("compact", false)

  // The palette variables are read by `body`, the backdrop and the settings
  // drawer, none of which are inside `div.window`; binding the skin to the root
  // element is what lets one attribute colour the whole document. A layout
  // effect so the first paint already carries it.
  useLayoutEffect(() => {
    document.documentElement.dataset.skin = skin
  }, [skin])

  const go = useCallback((id: number | null) => {
    const path = id === null ? "/" : `/node/${id}`
    history.pushState(null, "", path)
    setOpen(id)
  }, [])

  // The back button moves between client routes without a request, so the view
  // follows the address rather than the other way round.
  useEffect(() => {
    const pop = () => setOpen(route())
    addEventListener("popstate", pop)
    return () => removeEventListener("popstate", pop)
  }, [])

  // Every group in use, in node order, then the nodes carrying none, then the two
  // status filters. The catch-all is a kind rather than an empty string, because a
  // group may legitimately be named 未分组 or 在线.
  const groups = useMemo(() => (nodes ? groupsOf(nodes) : []), [nodes])
  const tabs = useMemo(() => {
    const named = groups.map((g) => ({ tab: { kind: "group", name: g } as Tab, label: g }))
    const ungrouped = (nodes ?? []).some((n) => !n.group)
    return [
      { tab: ALL, label: "全部" },
      ...named,
      ...(ungrouped && named.length > 0 ? [{ tab: { kind: "group", name: "" } as Tab, label: "未分组" }] : []),
      { tab: { kind: "status", online: true } as Tab, label: "在线" },
      { tab: { kind: "status", online: false } as Tab, label: "离线" },
    ]
  }, [groups, nodes])

  // A group that disappears -- the operator renamed it, or its last node left --
  // must not leave the page on an empty tab. The status filters are always there.
  useEffect(() => {
    if (!tabs.some((t) => tabId(t.tab) === tabId(tab))) setTab(ALL)
  }, [tabs, tab])

  const shown = useMemo(() => (nodes ?? []).filter((n) => matches(tab, n)), [nodes, tab])

  const current = open === null ? null : (nodes ?? []).find((n) => n.id === open) ?? null

  const openNode = (id: number) => go(id)
  const close = () => go(null)

  // The address names a node the hub does not return: private, deleted, or the
  // status page was closed between the link being shared and the visit.
  const missing = open !== null && nodes !== null && current === null

  return (
    <>
      {/* Every backdrop layer is always mounted and switched by a data attribute
          on the parent: the layers are pure CSS, and mounting them conditionally
          would re-run the backdrop's own animation on each switch. */}
      <div
        className="backdrop"
        data-stars={backdrop === "starfield" || backdrop === "both" ? "on" : undefined}
        data-grid={backdrop === "grid" || backdrop === "both" ? "on" : undefined}
        data-sun={backdrop === "sun" ? "on" : undefined}
        data-aurora={backdrop === "aurora" ? "on" : undefined}
        data-rain={backdrop === "rain" ? "on" : undefined}
        data-horizon={backdrop === "horizon" ? "on" : undefined}
      >
        <div className="sun" />
        <div className="aurora" />
        <div className="rain" />
        <div className="horizon" />
        <div className="pgrid" />
      </div>
      {crt && <div className="crt" />}

      <div className="window" data-skin={skin} data-glass={glass ? "on" : "off"}>
        <div className="titlebar">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="path">{`monitor://${location.host}${open === null ? "/" : `/node/${open}`}`}</span>
          <span className="dots" aria-hidden="true" style={{ visibility: "hidden" }}>
            <i />
            <i />
            <i />
          </span>
        </div>

        <div className="window-body">
          <header className="masthead">
            <div className="brand">
              {/* A fixed path, never a bundled asset: the hub rewrites it when the
                  operator uploads a site icon, and a hashed name cannot be rewritten. */}
              <BrandMark />
              <div>
                <h1 className="chrome-text">{useSiteName()}</h1>
                <p className="tagline">Y2K Monitoring Station</p>
              </div>
            </div>
            <div className="head-tools">
              {/* /admin is the hub's own page, never a theme route. A plain anchor
                  rather than a router push: the hub serves it, and a full load is
                  what leaves the theme. Shown to everyone, because the hub
                  decides who may actually use it -- an anonymous visitor who
                  clicks it lands on the hub's login prompt, which is the honest
                  answer to "where do I log in". */}
              <a className="btn" href="/admin">
                进入后台
              </a>
              {canSave && (
                <button type="button" className="btn" onClick={() => setSettings(true)}>
                  主题设置
                </button>
              )}
            </div>
          </header>

          {notice && <Notice text={notice} />}

          {closed && <div className="banner">公开状态页已关闭，需要登录后查看</div>}
          {!closed && error && nodes === null && <div className="banner">{error}</div>}

          {open !== null ? (
            missing ? (
              <div className="empty">
                <p>找不到这个节点</p>
                <button type="button" className="btn" onClick={close}>
                  返回列表
                </button>
              </div>
            ) : current ? (
              showLatency ? (
                <NodeDetail node={current} onBack={close} />
              ) : (
                <NodeDetailNoPing node={current} onBack={close} />
              )
            ) : (
              <div className="charts">
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            )
          ) : nodes === null ? (
            <div className="grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div className="skeleton" key={i} />
              ))}
            </div>
          ) : nodes.length === 0 ? (
            <div className="empty">这台 hub 上还没有公开的节点</div>
          ) : (
            <>
              {showSummary && <Summary nodes={shown} />}

              {showGroups && tabs.length > 1 && (
                <div className="tabs">
                  {tabs.map((t) => (
                    <button
                      key={tabId(t.tab)}
                      type="button"
                      className="tab"
                      data-on={tabId(tab) === tabId(t.tab) ? "true" : undefined}
                      onClick={() => setTab(t.tab)}
                    >
                      {t.label}
                      <span className="faint"> {(nodes ?? []).filter((n) => matches(t.tab, n)).length}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="grid" data-compact={compact ? "true" : undefined}>
                {shown.map((n) => (
                  <NodeCard key={n.id} node={n} onOpen={openNode} />
                ))}
              </div>

              {shown.length === 0 && <div className="empty">这个分组下没有节点</div>}
            </>
          )}

          <footer className="faint" style={{ marginTop: 22, fontSize: 11, textAlign: "center" }}>
            千禧年 Y2K 主题 · {shown.length} 个节点
          </footer>
        </div>
      </div>

      {settings && <Settings onClose={() => setSettings(false)} />}
    </>
  )
}

/**
 * The mark beside the site name. The hub serves `/favicon.svg` only when the
 * operator has uploaded a site icon, so an `<img>` pointing at it is a broken
 * image on every other site; the theme's own drawn mark stands in until (and
 * unless) that request answers. Both occupy the same 42px box, so the masthead
 * does not shift when the operator's icon replaces the drawn one.
 */
function BrandMark() {
  const [uploaded, setUploaded] = useState(true)
  if (uploaded) {
    return (
      <img
        src="/favicon.svg"
        alt=""
        width={42}
        height={42}
        onError={() => setUploaded(false)}
      />
    )
  }
  return (
    <svg className="mark" viewBox="0 0 48 48" width={42} height={42} aria-hidden="true">
      <defs>
        <radialGradient id="mark-face" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#0b1f4a" />
          <stop offset="100%" stopColor="#050a1e" />
        </radialGradient>
        <linearGradient id="mark-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dff3ff" />
          <stop offset="48%" stopColor="#8fb6d8" />
          <stop offset="100%" stopColor="#3d5f85" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="none" stroke="url(#mark-ring)" strokeWidth="3.2" />
      <circle cx="24" cy="24" r="17.4" fill="url(#mark-face)" />
      <circle cx="24" cy="20" r="6.6" fill="#45f0a8" />
      <circle cx="21.6" cy="17.6" r="2.5" fill="#eafff5" opacity="0.85" />
      <path d="M9 33 Q16.5 27.5 24 33 T39 33" fill="none" stroke="#b6f2ff" strokeWidth="1.4" opacity="0.9" />
    </svg>
  )
}

/**
 * The announcement bar. A marquee only earns its name when the text is wider
 * than the frame: with a short notice, two copies scrolling past read as the
 * sentence repeated rather than as one line moving. So the roll is measured --
 * the duplicate copy exists only while it is needed to fill the gap behind the
 * first -- and a notice that fits is left still.
 */
function Notice({ text }: { text: string }) {
  const frame = useRef<HTMLDivElement | null>(null)
  const first = useRef<HTMLSpanElement | null>(null)
  const [rolling, setRolling] = useState(false)

  useLayoutEffect(() => {
    const outer = frame.current
    const inner = first.current
    if (!outer || !inner) return
    // Measured against the frame's own width, not the viewport's: the notice sits
    // inside the window, which is narrower than the page at every size.
    const measure = () => setRolling(inner.scrollWidth > outer.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="notice">
      <span className="lamp" />
      <div className="frame" ref={frame}>
        <span className="roll" data-rolling={rolling ? "true" : undefined}>
          <span ref={first}>{markdown(text)}</span>
          {rolling && (
            <span aria-hidden="true">{markdown(text)}</span>
          )}
        </span>
      </div>
    </div>
  )
}

/** The site name from `/api/me`, falling back to the page title the hub set. */
function useSiteName(): string {
  const { me } = useTheme()
  return me?.site_name || document.title || "Monitor"
}

/** The detail page with its latency tab suppressed by the operator's setting. */
function NodeDetailNoPing({ node, onBack }: { node: Node; onBack: () => void }) {
  // The setting hides the chart, not the route: the resources are still worth
  // reading, and hiding the whole page would make a link to it dead.
  return <NodeDetail node={node} onBack={onBack} hidePing />
}

