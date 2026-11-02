# 美股定投小红书封面 · moxia 风格

封面尺寸 1080×1440（3:4，小红书竖版），实际导出 2160×2880（2 倍图，缩略图更清晰）。

视觉语言取自墨匣（moxia）的主题：暖白底色 `#fafaf8`、粗衬线大标题、字距拉开的眉标、发丝细线、克制的点缀色、黑底页脚带。

## 风格

目前启用四个主题，共用同一份 JSON：

- `press` 小红书封面：黑白报刊 + 中国红、粗衬线大标题
- `panel` 账户月报（瑞士极简）：报头报脚沿用封面（红眉标 + 黑底页脚带），背景同为 `#fafaf8`；三张白卡各一行「标的 / 累计投入 / 浮盈+收益率」，底部浅灰三栏总览。深海军蓝 + 红涨绿跌，无渐变无阴影
- `trend` 近一月走势：真实行情曲线（三只按首日收盘归一），底部明细表兼图例。数据来自 `node fetch-quotes.mjs`，没有数据时显示「暂无数据」
- `wechat` 公众号头图（2.35:1）

墨韵（宣纸 + 朱砂）和森屿（森林绿 + 奶油白 + 焦糖金）的实现仍保留在 `build.mjs` 里，想换回来把对应主题加进 `THEMES` 对象即可。

## 热更服务器（推荐日常用这个）

```bash
cd ~/Project/xhs/covers
node serve.mjs          # 默认 4321，端口占用会顺延
```

打开 http://localhost:4321 。之后编辑 `issues/*.json` 或 `build.mjs` 并保存，服务器会自动重新渲染并在浏览器里刷新，不用手动跑命令。

## 生成

```bash
cd ~/Project/xhs/covers
node build.mjs 001                 # 生成第 001 期的封面
```

输出在 `out/001-press.png`。

## 行情数据（走势图用）

```bash
cd ~/Project/xhs/covers
node fetch-quotes.mjs 001                        # 默认取上一个自然月
node fetch-quotes.mjs 001 2026-10-01 2026-11-01  # 或手动指定区间
```

脚本从东方财富的日 K 接口（`push2his.eastmoney.com`，境内直连、免 key）拉三只标的的收盘价，
写进 `data/001-quotes.json`，再 `node build.mjs 001` 就会多出一张 `001-trend.png`。
抓完之后热更服务器也会自动重画（它在监听 `data/`）。

- **市场编号**：写死在 `fetch-quotes.mjs` 顶部的 `MARKET` 里 —— `105` 纳斯达克、`106` 纽交所、`107` NYSE Arca。加新标的就在那里补一行。
- **只取收盘价**，涨跌幅在 `build.mjs` 里按「区间首日收盘价 = 0%」归一算出，不向前复权、不估算。
- 三只标的必须都有报价的交易日才会进入图表（取交集），避免某只停牌把曲线画歪。

每次构建还会生成 `gallery.html`（双击用浏览器打开）：所有期数、所有主题平铺展示，点图片放大，点「保存封面」直接存图，「下载全部」一次保存，`out/covers.zip` 是原始 PNG 打包。新加一期后重新构建，网页自动更新。

## 做下一期

复制 `issues/001.json` 为 `issues/002.json`，改这几项即可：

```json
{
  "issue": 2,                       // 期数 → 右上角"第 02 期"
  "date": "2026.12",                // 计算天数用，格式 YYYY.MM
  "start": "2026-11-01",            // 第一次定投的日期 → 自动算"第 N 天"
  "title": ["*十年定投*", "~纳指、伯克希尔、SCHD"],
  "kicker": "标题下面的一行小字",
  "handle": "@你的小红书号",          // 底部右
  "tickers": ["IQQ", "BRK.B", "SCHD"],
  "stats": [
    { "label": "本期定投", "value": "6,000", "prefix": "¥" },
    { "label": "累计定投", "value": "12,000", "prefix": "¥" }
  ],
  "holdings": [                     // 看板 / 面板用；填每只的投入和最新市值
    { "name": "纳指", "ticker": "IQQ", "invested": 3000, "value": 3072.6, "shares": 12.5 },
    { "name": "伯克希尔", "ticker": "BRK.B", "invested": 2000, "value": 2015.4, "shares": 4.2 },
    { "name": "高股息", "ticker": "SCHD", "invested": 1000, "value": 993.8, "shares": 10.3 }
  ],
  "dividend": 0                     // 累计收到的现金分红，不填就显示「暂无数据」
}
```

> 「账户面板」里任何一项没填都会显示**暂无数据**，不会瞎猜数字。`shares`（持有股数）和 `dividend`（累计分红）只有面板用得上。

> `holdings` 里浮盈和收益率都由 `value - invested` 自动算，不用自己填。三只共用一个比例尺画条，长度可以直接比。加起来的总投入/总市值要和 `stats` 里的累计定投对得上，否则两张图会打架。

> 标题上方会显示大号「第 N 天 · 第 X 期」。天数默认按 `start` 到 `date` 所在月份 1 号自动算；想手动指定就加 `"day": 37`。
> `title` 每行控制在 7 个汉字以内（含英文代码），超出会换行破坏版式。
> 标题里用 `*整行*` 让这一行使用点缀色，句中想强调单个词可用 `**词**`，行首加 `~` 让这一行缩到 72%，可以把三只标的压成一行。

然后 `node build.mjs 002`。

## 依赖

- macOS 自带字体：Songti SC、PingFang SC、DIN Alternate、Georgia
- 本机 Google Chrome，headless 截图，无需安装其他依赖

## 号名待定

顶部眉标现在写死为"美股定投实录"，改 `build.mjs` 里各主题的 `.brand` / `.eyebrow` 文案即可。
