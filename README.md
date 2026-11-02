# 十年定投 · 图文生产

小红书 @奔放游民 的定投记录账号，记录一笔**十年美股定投**：纳指（IQQ）、伯克希尔（BRK.B）、SCHD 三只，
每期出一组图 —— 封面、账户月报、近一月走势，另有一张公众号头图。

所有图都由 `covers/build.mjs` 用 HTML + 无头 Chrome 截图生成，改数据即改图，不用打开设计软件。

## 目录

```
.
├── covers/                 图片生成器
│   ├── build.mjs           所有版式都在这个文件里（五个主题）
│   ├── fetch-quotes.mjs    拉真实行情（东方财富日 K）
│   ├── serve.mjs           热更服务器，存盘即重绘
│   ├── issues/             每期的数据，一期一个 JSON
│   ├── data/               行情缓存（fetch-quotes.mjs 生成）
│   ├── assets/             Logo；source/ 里是未处理的原图
│   └── README.md           详细用法
├── docs/
│   └── 数据源方案.md       行情/分红各从哪来，实测结果与额度
└── references/             参考图、素材
```

## 快速开始

```bash
cd covers
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
- **行情**由 `fetch-quotes.mjs` 从东方财富接口拉取，只取收盘价，不估算、不补数。
- 缺数据的地方一律显示**「暂无数据」**，不会自动填充或推算。

各家数据源的可用性、免费额度、接口路径（含 FMP / Alpha Vantage 需要 key 的部分）见
[`docs/数据源方案.md`](docs/数据源方案.md)。

## 依赖

macOS 自带字体（Songti SC / PingFang SC / DIN Alternate / Georgia）+ 本机 Google Chrome，
无需安装任何 npm 包。
