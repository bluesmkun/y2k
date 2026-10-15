# 千禧年 Y2K — 探针监控主题

千禧年复古未来主义探针主题：铬合金、水蓝玻璃、霓虹与扫描线。纯静态 SPA，无 Web 字体、无图片资源（除站点图标外），全部视觉由 CSS 渐变与 SVG 手绘完成。唯一的站外请求是费用卡片的汇率（可关闭，见「可配置项」）。

## 路由

主题只使用两个客户端路由，hub 会把未知路径回落到本主题的 `dist/index.html`：

| 路径 | 页面 |
| --- | --- |
| `/` | 节点列表 |
| `/node/{id}` | 单节点详情（资源图表 / 延迟） |

如果反向代理或 WAF 按路径放行，需要允许上面两条；`/admin`、`/api`、`/install.sh`、`/agent/*` 由 hub 自己处理，与本主题无关。页头右上角的「进入后台」是一个指向 `/admin` 的普通链接（不是客户端路由），登录后才会看到主题设置按钮。

## 开发

```bash
pnpm install
MONITOR_HUB=https://your-hub.example.com pnpm dev
```

不设置 `MONITOR_HUB` 时，Vite 把 `/api`（含 WebSocket）代理到 `http://127.0.0.1:9911`，可以配合本地 `monitor-hub` 调试。

## 构建与打包

```bash
pnpm build    # tsc -b && vite build && 组装 y2k/
pnpm pack     # 生成 theme.tar.gz
pnpm icons    # 重新生成 public/apple-touch-icon.png
```

`pnpm build` 会依次完成两件事：

1. `tsc -b` 类型检查，`vite build` 产出 `y2k/dist/`；
2. `scripts/build-theme.mjs` 把 `dist/`、`theme.json`、`preview.png` 组装成 hub 期望的目录结构 `y2k/{theme.json,preview.png,dist/…}`。

随后 `pnpm pack` 写出 `theme.tar.gz`（自建 tar，只含普通文件与目录，避免 macOS 的扩展属性条目被 hub 拒绝），并在打包前校验文档里的五条体积限制。包内**根目录就是主题目录本身**——`theme.json`、`preview.png`、`dist/` 直接位于顶层，没有 `<short>/` 外壳：hub 把包装进临时目录后读的是 `staging/theme.json`，带外壳的包会被拒绝（「主题包里没有 theme.json」）。

`theme.json` 的 `version` 必须与发布 tag 对应（`v1.0.0` ↔ `1.0.0`），否则面板的一键更新会反复提示重装。

### 发布

```bash
git tag v1.0.0 && git push origin v1.0.0
```

`.github/workflows/release.yml` 会在 `v*` tag 上构建并发布 `theme.tar.gz`（附 `theme.tar.gz.sha256`）到 Release。面板的「从 GitHub 安装」与「从 GitHub 更新」只认仓库**最新正式 release**（不含预发布和草稿）里名为 `theme.tar.gz` 的附件——不要用 Source code 压缩包，hub 会明确提示下载错了文件。`.github/workflows/ci.yml` 在 main 上跑类型检查、构建、打包与 `gzip -t`。

### 预览图

`preview.png`（960×600，3:2）是主题在面板里的卡片图，用真实截图而不是手绘示意图。改过界面后重新截一张即可：

```bash
pnpm build
pnpm preview                        # 另开一个终端起 vite preview（默认 4321）
pnpm preview:shot                   # 无头浏览器截图 → 缩放 960×600 → 覆盖 preview.png
```

`pnpm preview:shot` 走的是 `scripts/preview.mjs`：Edge 无头模式按 2× 截 1200×750，再用自带 Python 的 Pillow 缩到 960×600（RGB，不带 alpha）。`scripts/icons.mjs` 只负责生成站点图标，不会覆盖 `preview.png`。

## 目录结构

```
theme.json              主题清单与可配置项
index.html              入口，固定引用 /favicon.svg 与 /apple-touch-icon.png
src/
  main.tsx              挂载
  App.tsx               列表页、分组标签、路由
  index.css             整套 Y2K 设计系统（8 套配色 + 6 种背景）
  lib/
    api.ts              /api 客户端、WebSocket 推送、轮询回落
    config.ts           theme.json 配置项的读取与保存
    format.ts           字节/速率/时长/货币/坐标轴等格式化
    markdown.tsx        仅用于公告的极简 Markdown 渲染（转义 HTML）
    theme.tsx           主题配置 Context 与 useFlag/useText/useNumber
    latency.ts          卡片三网延迟的取数与缓存
    rates.ts            汇率取数与换算（费用卡片）
  components/
    NodeCard.tsx        节点卡片（含国家徽标）
    NodeDetail.tsx      节点详情与图表
    Charts.tsx          手写 SVG 图表引擎
    Meter.tsx           分段 LED 进度条
    Settings.tsx        主题设置抽屉（仅登录后可用）
    Summary.tsx         顶部汇总卡片
scripts/
  build-theme.mjs       组装 y2k/
  icons.mjs             生成 apple-touch-icon.png
  preview.mjs           无头浏览器截图并缩放成 preview.png
  pack.mjs              打包 theme.tar.gz
public/
  apple-touch-icon.png  180×180 不透明站点图标
```

## 可配置项

外观：配色（8 套：aqua 水蓝玻璃 / chrome 液态铬 / vapor 蒸汽波 / matrix 终端绿 / bubble 果冻粉 / amber 琥珀单色 / ice 冰蓝工作站 / sunrise 千禧日出）、背景（8 种：星空 / 透视网格 / 星空+网格 / 千禧日落 / 极光 / 数字雨 / 地平线 / 纯色）、扫描线与屏幕反光、玻璃高光。配色与背景相互独立，可以任意搭配；每套配色只定义一组 CSS 变量，所有规则都读变量，因此加一套配色是一段二十行的声明而不是一份新的 CSS。

首页：公告、每行卡片数、汇总条、分组标签、国家旗帜、公开备注。

指标：费用、流量、网速、延迟（卡片三网延迟 + 详情页延迟图）、紧凑模式。

首页布局：汇总条上是节点、本月流量、实时网速、费用四张卡片，左右两列文字两端对齐——左边贴着卡片内边距，右边贴着另一侧内边距，数字长短不同也不会让卡片高低不齐；窄屏下自动折成 2×2 的田字，并用 `grid-auto-rows: 1fr` 让四格严格等高、文字居中，不会因为费用卡片的副标题换行就把下面一排撑高。卡片状态只用左侧指示灯表示：在线为绿色并带三层光晕，比原先更亮更明显，不再额外占用一个文字徽标。离线与异常节点保持原有的网格位置与高度——CPU、内存、硬盘、网络的槽位照常画出，只是内容留空显示「—」，因此列表不会因为一台掉线就重排，在线与离线节点始终横向对齐。卡片上的三网延迟与丢包分成两行：上一行是电信 / 联通 / 移动的延迟，下一行是对应的丢包率（没有丢包时显示「—」，有则显示「↓12%」），两行的运营商名与数值都落在固定的列上，各卡之间纵向对齐。某台机器没有延迟数据时该格显示「—」而不是编造一个数。剩余天数为无限期时也照样显示徽标，不会因为「没有天数」而空着一块。

费用：汇总条的费用卡片显示机队的剩余价值（按剩余时间比例折算的已付未用部分；一次性付费与无限期节点计 0）与总费用（所有计费节点价格之和），两者都随所选分组重算。显示币种（原币种 / CNY / USD / EUR / JPY / GBP / HKD / TWD / SGD / KRW）与汇率接口都可配置。费用卡片把每个节点的价格按各自的 `billing_cycle` 折算成月成本后求和；节点币种不一致时逐个换算再相加，选「原币种」且币种混杂时显示「多币种未换算」而不是把数字直接相加。汇率默认取 `open.er-api.com`（免费、无需密钥、支持 CORS），结果缓存 6 小时；取不到时保留上一次的表，或退回原币种显示——不会因此报错。关掉「显示价格与到期」会连费用卡片一起隐藏，并且不再请求汇率（公开状态页不替访客联系第三方）。

详情页的资源图表与延迟图是同一副仪表：同样的凹槽绘图区、烧进画面的网格、发光的曲线，四张资源图（CPU / 内存 / 硬盘 / 网络）与延迟图共用同一套 CRT 观感，230px 高、两列排布，不再是大图小图两种观感。延迟图把「平滑」「削峰」「全部/各探针显示」做成图表上方的按钮：点探针名可以隐藏或显示该条线，四条全部隐藏时给出恢复提示，不需要把视线移到图表下方去找开关。

设置与 hub 面板共用同一份数据；改动会在设置面板里即时预览，保存后生效，取消则还原。

## 主题约定

- 所有 hub / agent 返回的字符串都作为纯文本渲染（`{value}`），从不进入 `innerHTML`；公告使用自带的 Markdown 渲染器，先转义 HTML，只放行 `http:`、`https:`、`mailto:` 链接。
- 四种节点状态都单独处理：在线、离线、已连接但尚未首次上报（`online: true` 且 `metrics: null`，指示灯为琥珀色）、数据异常（上报了但字段不可用，指示灯为红色，页面显示「数据异常」而不是空白）。四种状态都占用相同的卡片高度与相同的指标槽位，离线时槽位留空而不是消失。
- 使用 hub 的 `expires_in` 与 `last_seen_ago`（hub 时钟），不拿浏览器时钟去算 `expires_at` / `last_seen`。
- 页面隐藏时关闭 WebSocket 并停止轮询，恢复可见时重新拉取一次 `/api/nodes` 并重连。
- WebSocket 匿名并发有上限，握手返回 503 时自动回落到 5 秒轮询。
- 节点列表本身不带延迟，卡片上的三网延迟是每张卡片为自己的节点请求 `series=ping`；结果缓存 30 秒、并发上限 4，页面隐藏时不请求。
- 卡片上的延迟按运营商归并（探针名里含「电信」「联通」「移动」的分别合并），不是按探针逐个列出：一个运营商挂多个探针时只占一格。名称里不含这三个词的探针（如「海外」）不进卡片，详情页可以看到全部。

## 更新记录

### 1.3.0

- 详情页的四张资源图（CPU / 内存 / 硬盘 / 网络）改用与延迟图一致的 CRT 风格：同一套凹槽绘图区、网格与发光曲线。
- 卡片在线状态改为只靠左侧指示灯表示，并把光晕加强（绿色三层辉光）；去掉右侧「在线」文字徽标。
- 手机上顶部四张汇总卡片严格等高（`grid-auto-rows: 1fr`）并文字居中，费用卡片副标题换行不再撑高下排。
- 卡片的延迟与丢包拆成两行，运营商名与数值仍然按列对齐，整列看起来更规整。
- 离线节点不再清空指标区：CPU、内存、硬盘、网络的槽位照常保留并显示「—」，与在线节点对齐。
- 删除表格视图（组件、样式与主题设置项一并移除）。
- 新增 4 套配色（bubble 果冻粉 / amber 琥珀单色 / ice 冰蓝工作站 / sunrise 千禧日出）与 4 种背景（千禧日落 / 极光 / 数字雨 / 地平线），配色与背景可任意组合。
