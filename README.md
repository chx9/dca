# 十年定投 · 图文生产

小红书 @奔放游民 的定投记录账号，记录一笔**十年美股定投**：纳指（IQQ）、伯克希尔（BRK.B）、SCHD 三只，
每期出一组图 —— 封面、账户月报、近一月走势，另有一张公众号头图。

所有图都由 `covers/build.mjs` 生成：HTML/CSS 模板 → satori 排版成 SVG → resvg 栅格化成 PNG，
纯 Node 渲染，不需要浏览器，改数据即改图，不用打开设计软件。

## 目录

```
.
├── covers/                 图片生成器
│   ├── build.mjs           所有版式都在这个文件里（五个主题）
│   ├── render-node.mjs     渲染管线：HTML → satori 排版 → resvg 栅格化 → PNG
│   ├── fetch-fonts.mjs     首次准备字体：下载可变字体 + 切静态字重
│   ├── fetch-quotes.mjs    拉真实行情（东方财富日 K）
│   ├── app.mjs             网页生成器：填美元金额，自动换汇率出图
│   ├── serve.mjs           热更服务器，存盘即重绘
│   ├── issues/             每期的数据，一期一个 JSON
│   ├── data/               行情缓存（fetch-quotes.mjs 生成）
│   ├── assets/             Logo；fonts/ 是渲染字体（不入库，fetch-fonts.mjs 生成）
│   └── README.md           详细用法
├── docs/
│   └── 数据源方案.md       行情/分红各从哪来，实测结果与额度
└── references/             参考图、素材
```

## 快速开始

```bash
cd covers
npm install                # 首次：装渲染依赖
node fetch-fonts.mjs       # 首次：下载字体并切出静态字重（需 Python + pip install fontTools）
node app.mjs               # 打开 http://localhost:4330，填表出图（推荐）
```

网页里填三只标的的本期定投 / 累计定投 / 当前市值（**美元**），自动按
frankfurter.dev 的 USD→CNY 汇率换算、拉最近 30 天行情、生成全部四张图。

调版式时用热更服务器：

```bash
node serve.mjs 4321        # 打开 http://localhost:4321
```

之后改 `issues/*.json` 或 `build.mjs`，存盘就自动重绘并在浏览器里刷新。

单独生成一期：

```bash
node build.mjs 001             # 全部主题
node build.mjs 001 --theme panel
node fetch-quotes.mjs 001      # 先拉行情，走势图才有数据
```

输出在 `covers/out/`，同时生成 `covers/gallery.html`（平铺预览，可单张保存或整包下载）。

## 产出

| 主题 | 尺寸 | 用途 |
|---|---|---|
| `press` | 1080×1440 | 小红书封面，报刊风，粗衬线大标题 |
| `panel` | 1080×1440 | 账户月报，三张白卡 + 浅灰总览 |
| `trend` | 1080×1440 | 近一月走势，真实行情曲线 + 明细表 |
| `wechat` | 900×383 | 公众号头图（2.35:1） |

全部导出 2 倍图。另有一个**交互走势页**（不是图片）：`http://localhost:4321/trend.html`，
鼠标悬停显示每个交易日的收盘价 / 当日涨跌 / 区间涨跌，数据与 `trend` 图同源。

## 数据

- **投资数据**（投入、市值、当期金额）手填在 `issues/<期号>.json`，浮盈和收益率由脚本按 `市值 − 投入` 计算。
  网页每次提交还会追加一条到 `data/history.json`（定投台账：提交时间、美元原值、汇率），页面上可回溯、回填、删除单条。
- **行情**由 `fetch-quotes.mjs` 拉取（东方财富为主、Nasdaq 兜底），存本地缓存 `data/quotes-cache.json`，
  每次只补新交易日；只取收盘价，不估算、不补数。
- 缺数据的地方一律显示**「暂无数据」**，不会自动填充或推算。

各家数据源的可用性、免费额度、接口路径（含 FMP / Alpha Vantage 需要 key 的部分）见
[`docs/数据源方案.md`](docs/数据源方案.md)。

## 依赖

- Node.js 18+（用到全局 `fetch`）
- `covers/` 下 `npm install`（satori 排版、@resvg/resvg-js 栅格化、ultrahtml 解析、jimp 转 JPEG）
- 字体：`node fetch-fonts.mjs` 下载 Noto Serif SC / Noto Sans SC 可变字体，并用 Python
  fontTools 切成 400–900 五个静态字重实例存到 `assets/fonts/`（只需跑一次；
  需要本机 Python 3 + `pip install fontTools`）

纯 Node 渲染，不需要 Chrome 或任何浏览器，macOS / Windows / Linux 都能跑。
字体不入库（100+ MB），新机器克隆后跑一遍 `fetch-fonts.mjs` 即可。
