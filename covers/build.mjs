#!/usr/bin/env node
/**
 * 小红书封面生成器 · moxia 风格
 * 用法：
 *   node build.mjs 001              # 生成第 001 期的全部主题
 *   node build.mjs 001 --theme ink  # 只生成某一个主题
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 1080;
const H = 1440;

const args = process.argv.slice(2);
const issueId = (args[0] || "001").padStart(3, "0");
const themeFlag = args.includes("--theme")
  ? args[args.indexOf("--theme") + 1]
  : "all";

const issue = JSON.parse(
  readFileSync(join(ROOT, "issues", `${issueId}.json`), "utf8"),
);

// 真实行情：node fetch-quotes.mjs <期号> 生成；没有就渲染「暂无数据」
const quotesPath = join(ROOT, "data", `${issueId}-quotes.json`);
let QUOTES = null;
if (existsSync(quotesPath)) {
  try {
    QUOTES = JSON.parse(readFileSync(quotesPath, "utf8"));
  } catch {
    QUOTES = null;
  }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// 标题里用 **词** 标记要强调的词（各主题用各自的点缀色）
// *整行* 用点缀色；句中 **词** 也可强调
const hl = (line) => {
  const small = line.startsWith("~");
  const text = small ? line.slice(1) : line;
  const inner = /^\*[^*].*\*$/.test(text)
    ? `<span class="hl">${esc(text.slice(1, -1))}</span>`
    : esc(text).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');
  return small ? `<span class="sm">${inner}</span>` : inner;
};
const num = (n) => String(n).padStart(2, "0");
// 已定投多少天：优先用 JSON 的 day，否则按 start → 本期月份 1 号 计算
function dayCount(d) {
  if (Number(d.day)) return Number(d.day);
  if (!d.start) return null;
  const [y, m] = String(d.date).split(".").map(Number);
  const start = Date.parse(`${d.start}T00:00:00Z`);
  const cur = Date.UTC(y, (m || 1) - 1, 1);
  const n = Math.floor((cur - start) / 86400000) + 1;
  return n > 0 ? n : 1;
}
// 封面主视觉里的"第 N 天 · 第 X 期"
const dayOf = (d) => (dayCount(d) ? String(dayCount(d)).padStart(2, "0") : null);
const parts = (d) => [dayOf(d) ? `第 ${dayOf(d)} 天` : null, `第 ${num(d.issue)} 期`].filter(Boolean);
const stampOf = (d) => parts(d).join(" · ");
const counters = (d) =>
  `<div class="counters">${parts(d).join('<span class="sep">·</span>')}</div>`;

// 品牌图：assets/ 里的图转成 base64 内联，截图时不受相对路径影响
const asset = (file) => {
  const p = join(ROOT, "assets", file);
  return existsSync(p) ? `data:image/png;base64,${readFileSync(p).toString("base64")}` : "";
};
// 三只标的的 logo；文件名对应 assets/ 里实际的图
const LOGOS = {
  IQQ: { file: "nasdaq.png", bg: "#ffffff", fit: "contain", pad: 9 },
  "BRK.B": { file: "berkshire.png", bg: "#0c2340", fit: "cover", pad: 0 },
  SCHD: { file: "schd.png", bg: "#1a76b8", fit: "cover", pad: 0 },
};
// 按 ticker 优先、中文名兜底找 logo；都没有就退回字母徽标
const LOGO_ALIAS = {
  IQQ: ["IQQ", "QQQ", "NDX", "NASDAQ", "纳指", "纳斯达克"],
  "BRK.B": ["BRK.B", "BRK", "BERKSHIRE", "伯克希尔"],
  SCHD: ["SCHD", "高股息"],
};
const logoOf = (h) => {
  const hay = `${h.ticker || ""} ${h.name || ""}`.toUpperCase();
  const key = Object.keys(LOGO_ALIAS).find((k) => LOGO_ALIAS[k].some((a) => hay.includes(a.toUpperCase())));
  if (!key) return null;
  const src = asset(LOGOS[key].file);
  return src ? { ...LOGOS[key], src } : null;
};

// 纸张噪点：让纯色背景有一点纤维感，接近墨匣的主题底色
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='320' height='320' filter='url(%23n)'/%3E%3C/svg%3E")`;

const base = (css, body, w = W, h = H) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${w}px; height:${h}px; overflow:hidden; -webkit-font-smoothing:antialiased; }
  body { position:relative; }
  .noise { position:absolute; inset:0; background-image:${NOISE}; opacity:.05; mix-blend-mode:multiply; pointer-events:none; }
${css}
</style></head><body>${body}<div class="noise"></div></body></html>`;

/* ─────────────────────────  A · 墨韵  ─────────────────────────
   宣纸底色 + 淡格线 + 宋体标题 + 朱砂点缀。最接近墨匣原味。 */
function themeInk(d) {
  const stats = d.stats
    .map(
      (s, i) => `<div class="stat${i === 0 ? " first" : ""}">
      <div class="label">${esc(s.label)}</div>
      <div class="value">${s.prefix ? `<span class="prefix">${esc(s.prefix)}</span>` : ""}${esc(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ""}</div>
    </div>`,
    )
    .join("");
  const title = d.title.map(hl).join("<br>");

  return base(
    `
  body {
    background-color:#fdfbf5;
    background-image:
      repeating-linear-gradient(to right, rgba(120,112,92,.05) 0 1px, transparent 1px 24px),
      repeating-linear-gradient(to bottom, rgba(120,112,92,.05) 0 1px, transparent 1px 24px);
    color:#3b3632;
    font-family:"Songti SC","Source Han Serif SC","Noto Serif SC",serif;
  }
  .frame { position:absolute; inset:40px; border:1px solid rgba(168,64,47,.26); }
  .content { position:absolute; inset:92px 94px; display:flex; flex-direction:column; }
  .top { display:flex; justify-content:space-between; align-items:baseline; font-family:-apple-system,"PingFang SC",sans-serif; }
  .brand { font-size:23px; letter-spacing:9px; font-weight:600; color:#a8402f; }
  .issue { font-size:23px; letter-spacing:4px; color:#8d8478; }
  .rule { height:1px; margin-top:26px; background:rgba(120,112,92,.32); }
  .mid { flex:1; display:flex; flex-direction:column; justify-content:center; padding-bottom:20px; }
  .counters { margin-bottom:34px; font-family:-apple-system,"PingFang SC",sans-serif; font-size:44px; font-weight:600; letter-spacing:6px; color:#a8402f; }
  .counters .sep { margin:0 8px; color:rgba(168,64,47,.4); letter-spacing:0; }
  .title { font-size:102px; font-weight:600; line-height:1.46; letter-spacing:3px; color:#33302c; }
  .title .hl { font-style:normal; color:#a8402f; }
  .title .sm { font-size:.72em; letter-spacing:1px; white-space:nowrap; }
  .kicker { margin-top:56px; padding-top:26px; border-top:1px solid rgba(168,64,47,.35); width:min-content; white-space:nowrap; font-size:29px; letter-spacing:4px; color:#8d8478; }
  .stats { display:flex; padding:38px 0 36px; border-top:1px solid rgba(120,112,92,.3); border-bottom:1px solid rgba(120,112,92,.3); }
  .stat { flex:1; padding-left:38px; border-left:1px solid rgba(120,112,92,.2); }
  .stat.first { padding-left:0; border-left:0; }
  .label { font-size:21px; letter-spacing:5px; color:#9a9184; font-family:-apple-system,"PingFang SC",sans-serif; }
  .value { margin-top:14px; font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:60px; font-weight:700; letter-spacing:1px; color:#3b3632; }
  .prefix { font-size:30px; font-weight:500; margin-right:4px; color:#a8402f; }
  .suffix { font-size:28px; font-weight:500; margin-left:4px; color:#8d8478; }
  .footer { display:flex; justify-content:space-between; margin-top:34px; font-size:21px; letter-spacing:3px; color:#9a9184; font-family:-apple-system,"PingFang SC",sans-serif; }
`,
    `<div class="frame"></div>
  <div class="content">
    <div class="top"><div class="brand">美股定投实录</div><div class="issue">定投手记</div></div>
    <div class="rule"></div>
    <div class="mid">
      ${counters(d)}
      <div class="title">${title}</div>
      <div class="kicker">${esc(d.kicker)}</div>
    </div>
    <div class="stats">${stats}</div>
    <div class="footer"><span>${esc(d.month)}</span><span>${esc(d.handle)}</span></div>
  </div>`,
  );
}

/* ─────────────────────────  B · 森屿  ─────────────────────────
   森林绿 + 奶油白 + 焦糖金，思源宋体标题、DIN 数字。沉稳定投感。 */
function themeForest(d) {
  const stats = d.stats
    .map(
      (s) => `<div class="stat">
      <div class="label">${esc(s.label)}</div>
      <div class="value">${s.prefix ? `<span class="prefix">${esc(s.prefix)}</span>` : ""}${esc(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ""}</div>
    </div>`,
    )
    .join("");
  const title = d.title.map((l) => `<span>${hl(l)}</span>`).join("");

  return base(
    `
  body { background:#F7F3EA; color:#463D35; font-family:"Source Han Sans SC","PingFang SC",sans-serif; }
  .frame { position:absolute; inset:46px; border:1px solid rgba(181,138,84,.45); border-radius:6px; }
  .content { position:absolute; inset:110px 104px; display:flex; flex-direction:column; }
  .eyebrow { display:flex; align-items:center; justify-content:space-between; }
  .eyebrow .left { display:flex; align-items:center; gap:16px; }
  .eyebrow .stamp { font-size:22px; font-weight:700; letter-spacing:5px; color:#B58A54; }
  .dot { width:12px; height:12px; background:#B58A54; }
  .eyebrow .txt { font-size:22px; font-weight:700; letter-spacing:7px; color:#B58A54; }
  .mid { flex:1; display:flex; flex-direction:column; justify-content:center; padding-bottom:26px; }
  .counters { margin-bottom:32px; font-size:42px; font-weight:700; letter-spacing:6px; color:#B58A54; }
  .counters .sep { margin:0 8px; color:rgba(181,138,84,.5); letter-spacing:0; }
  .title { font-family:"Source Han Serif SC","Noto Serif SC","Songti SC",serif; font-size:104px; font-weight:700; line-height:1.42; letter-spacing:2px; color:#254D3C; }
  .title span { display:block; }
  .title .hl { color:#B58A54; }
  .title .sm { display:block; margin-top:58px; font-size:.465em; line-height:1.2; letter-spacing:0; white-space:nowrap; }
  .kicker { margin-top:52px; padding-top:24px; border-top:2px solid #B58A54; width:min-content; white-space:nowrap; font-size:28px; letter-spacing:3px; color:#7d7166; }
  .stats { display:flex; gap:18px; }
  .stat { flex:1; padding:30px 26px 28px; background:#E8EDE4; border-radius:10px; }
  .label { font-size:19px; letter-spacing:4px; color:#6d7f72; }
  .value { margin-top:12px; font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:54px; font-weight:700; color:#254D3C; }
  .prefix { font-size:26px; font-weight:500; margin-right:3px; color:#B58A54; }
  .suffix { font-size:26px; font-weight:500; margin-left:3px; color:#B58A54; }
  .footer { display:flex; justify-content:space-between; align-items:center; margin-top:40px; padding-top:26px; border-top:1px solid rgba(181,138,84,.35); }
  .month { font-size:22px; letter-spacing:2px; color:#8a7d70; }
  .tickers { display:flex; gap:18px; font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:22px; letter-spacing:1px; color:#254D3C; }
  .tickers b { font-weight:700; }
  .tickers .sep { color:#B58A54; }
`,
    `<div class="frame"></div>
  <div class="content">
    <div class="eyebrow">
      <div class="left"><div class="dot"></div><div class="txt">美股定投实录</div></div>
      <div class="stamp">${esc(d.month)}</div>
    </div>
    <div class="mid">
      ${counters(d)}
      <div class="title">${title}</div>
      <div class="kicker">${esc(d.kicker)}</div>
    </div>
    <div class="stats">${stats}</div>
    <div class="footer"><div class="month">${esc(d.handle)}</div><div class="tickers"><b>${d.tickers.join('</b><span class="sep"> · </span><b>')}</b></div></div>
  </div>`,
  );
}

/* ─────────────────────────  C · 时评  ─────────────────────────
   黑白报刊 + 中国红，粗衬线标题。信息冲击力最强，最像财经号。 */
function themePress(d) {
  const stats = d.stats
    .map(
      (s) => `<div class="stat">
      <div class="value">${s.prefix ? `<span class="prefix">${esc(s.prefix)}</span>` : ""}${esc(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ""}</div>
      <div class="label">${esc(s.label)}</div>
    </div>`,
    )
    .join("");
  const title = d.title.map((l) => `<span>${hl(l)}</span>`).join("");

  return base(
    `
  body {
    background-color:#fafaf8;
    color:#1a1a1a;
    font-family:-apple-system,"PingFang SC",sans-serif;
  }
  .noise { display:none; }              /* 和投资数据同一张底板，干净底 */
  .content { position:absolute; inset:96px 88px 0; display:flex; flex-direction:column; }
  .top { display:flex; justify-content:space-between; align-items:baseline; font-size:23px; letter-spacing:6px; font-weight:700; color:#c8161d; }
  .top .issue { color:#1a1a1a; }
  .rule { height:1px; margin-top:22px; background:#1a1a1a; }
  .mid { flex:1; display:flex; flex-direction:column; justify-content:center; }
  .counters { margin-top:34px; font-size:50px; font-weight:700; letter-spacing:5px; color:#c8161d; }
  .counters .sep { margin:0 6px; color:#1a1a1a; letter-spacing:0; }
  .title { font-family:Georgia,"Songti SC","Source Han Serif SC",serif; font-size:166px; font-weight:900; letter-spacing:0; color:#111; }
  .title > span { display:block; line-height:1.14; }
  .title span { display:block; }
  .title .hl { color:#c8161d; }
  .title .sm { display:block; margin-top:58px; font-size:.465em; line-height:1.2; letter-spacing:0; white-space:nowrap; }
  .kicker { margin:0 0 44px; padding-top:20px; border-top:2px solid #111; width:min-content; white-space:nowrap; font-size:27px; letter-spacing:3px; color:#5a5a5a; }
  .stats { display:flex; gap:0; padding:42px 0; border-top:3px solid #111; border-bottom:1px solid #111; }
  .stat { flex:1; padding-right:28px; }
  .stat + .stat { padding-left:28px; border-left:1px solid #d5d0c8; }
  .value { font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:84px; font-weight:700; color:#c8161d; }
  .prefix { font-size:32px; font-weight:500; margin-right:3px; }
  .suffix { font-size:30px; font-weight:500; margin-left:3px; color:#1a1a1a; }
  .label { margin-top:10px; font-size:22px; letter-spacing:4px; color:#6a6a6a; }
  .band { position:absolute; left:0; right:0; bottom:0; height:126px; background:#111; color:#faf8f4; display:flex; align-items:center; justify-content:space-between; padding:0 88px; }
  .band .l { font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:27px; letter-spacing:2px; }
  .band .r { font-size:23px; letter-spacing:5px; color:#cbbfb2; }
`,
    `<div class="content">
    <div class="top"><div>美股定投实录</div><div class="issue">${esc(d.date)}</div></div>
    <div class="rule"></div>
    ${counters(d)}
    <div class="mid">
      <div class="title">${title}</div>
    </div>
    <div class="kicker">${esc(d.kicker)}</div>
    <div class="stats">${stats}</div>
    <div style="height:112px"></div>
  </div>
  <div class="band"><div class="l">${d.tickers.join(" / ")}</div><div class="r">${esc(d.handle)}</div></div>`,
  );
}

/* ───────────────────────  D · 公众号头图  ───────────────────────
   900×383（2.35:1），微信文章首图；同样导出 2 倍图 1800×766。
   宽幅版式：左边标题，右边数据，底部黑条。 */
function themeWechat(d) {
  const stats = d.stats
    .map(
      (s) => `<div class="stat">
      <div class="label">${esc(s.label)}</div>
      <div class="value">${s.prefix ? `<span class="prefix">${esc(s.prefix)}</span>` : ""}${esc(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ""}</div>
    </div>`,
    )
    .join("");
  const title = d.title.map(hl).join("");

  return base(
    `
  body {
    background-color:#fafaf8;
    color:#1a1a1a;
    font-family:-apple-system,"PingFang SC",sans-serif;
  }
  .noise { display:none; }              /* 和竖版同一张底板，干净底 */
  .content { position:absolute; inset:34px 46px 0; display:flex; flex-direction:column; }
  .top { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; font-weight:700; letter-spacing:4px; color:#c8161d; }
  .top .date { color:#1a1a1a; }
  .rule { height:1px; margin-top:11px; background:#1a1a1a; }
  .main { flex:1; display:flex; padding-bottom:52px; }
  .left { flex:1.72; display:flex; flex-direction:column; padding-right:34px; }
  .counters { margin-top:16px; font-size:20px; font-weight:700; letter-spacing:4px; color:#c8161d; }
  .title { margin-top:24px; font-family:Georgia,"Songti SC","Source Han Serif SC",serif; font-size:100px; font-weight:900; line-height:1.02; color:#c8161d; white-space:nowrap; }
  .title > span { display:block; }
  .title .sm { margin-top:14px; font-size:.40em; line-height:1.1; color:#111; }
  .kicker { margin-top:auto; padding-top:9px; border-top:2px solid #111; width:min-content; white-space:nowrap; font-size:15px; letter-spacing:2px; color:#5a5a5a; }
  .right { flex:1; border-left:1px solid #cfc9bf; padding-left:30px; display:flex; flex-direction:column; justify-content:center; gap:16px; }
  .stat .label { font-size:17px; letter-spacing:3px; color:#6a6a6a; }
  .stat .value { margin-top:4px; font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:56px; font-weight:700; color:#c8161d; }
  .stat .prefix { font-size:22px; font-weight:500; margin-right:2px; }
  .band { position:absolute; left:0; right:0; bottom:0; height:42px; background:#111; color:#faf8f4; display:flex; align-items:center; justify-content:space-between; padding:0 46px; font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:15px; letter-spacing:2px; }
  .band .r { color:#cbbfb2; font-family:-apple-system,"PingFang SC",sans-serif; letter-spacing:3px; }
`,
    `<div class="content">
    <div class="top"><div>美股定投实录</div><div class="date">${esc(d.date)}</div></div>
    <div class="rule"></div>
    <div class="main">
      <div class="left">
        ${counters(d)}
        <div class="title">${title}</div>
        <div class="kicker">${esc(d.kicker)}</div>
      </div>
      <div class="right">${stats}</div>
    </div>
  </div>
  <div class="band"><div>${d.tickers.join(" / ")}</div><div class="r">${esc(d.handle)}</div></div>`,
    900,
    383,
  );
}

/* ───────────────────  F · 账户面板（极简版）  ───────────────────
   纯白背景、深蓝黑字、红涨绿跌、圆角卡片 + 细分割线，无衬线。
   像券商 APP 的资产页，不是海报。缺数据的地方一律显示「暂无数据」。 */
const NA = "暂无数据";

function themePanel(d) {
  const hs = (d.holdings || []).slice(0, 3);
  const money = (n, dec = 0) =>
    n == null || !Number.isFinite(Number(n))
      ? NA
      : `${n < 0 ? "−" : ""}¥${Math.abs(Number(n)).toLocaleString("en-US", {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        })}`;
  const pctParen = (n) => (n == null || !Number.isFinite(Number(n)) ? NA : `(${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%)`);
  const tone = (n) => (n == null || !Number.isFinite(Number(n)) ? "" : n > 0 ? "up" : n < 0 ? "dn" : "");
  // 按数字位数自适应字号：金额涨到十万级时自动缩小，不撞栏
  const CHAR_EM = { "¥": 0.74, ",": 0.28, ".": 0.28, "+": 0.62, "−": 0.62 };
  const emOf = (str) => [...String(str)].reduce((a, c) => a + (CHAR_EM[c] ?? (c >= "0" && c <= "9" ? 0.56 : 0.9)), 0);
  const fitFont = (texts, avail, base, min = 32) => {
    const t = texts.filter((x) => x && x !== NA);
    if (!t.length) return base;
    return Math.max(min, Math.min(base, Math.floor(avail / Math.max(...t.map(emOf), 1))));
  };

  // 三张卡统一白底，只用文字区分；SKIN 仅作无 logo 时字母徽标的兜底色
  const SKIN = [{ badge: "#1e7fd4" }, { badge: "#1b3a66" }, { badge: "#009fe3" }];

  const rows = hs.map((h) => {
    const per = h.period ?? null;
    const inv = h.invested ?? null;
    const val = h.value ?? null;
    const pnl = inv != null && val != null ? val - inv : null;
    const rate = inv != null && val != null && inv !== 0 ? ((val - inv) / inv) * 100 : null;
    return { ...h, per, inv, val, pnl, rate };
  });

  const hasAll = rows.length > 0 && rows.every((r) => r.inv != null && r.val != null);
  const totalIn = hasAll ? rows.reduce((s, r) => s + r.inv, 0) : null;
  const totalVal = hasAll ? rows.reduce((s, r) => s + r.val, 0) : null;
  const totalPnl = totalIn != null ? totalVal - totalIn : null;
  const totalRate = totalIn ? (totalPnl / totalIn) * 100 : null;
  const pnlText = (n) => (n == null ? NA : `${n >= 0 ? "+" : "−"}¥${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  const ovSize = fitFont([money(totalIn), money(totalVal), pnlText(totalPnl)], 246, 78, 34);

  // 每只一行横排：左边标的，右边本期定投 / 累计投入 / 浮盈三栏，金额均分剩余宽度
  const rowMoney = rows.flatMap((h) => [money(h.per), money(h.inv), pnlText(h.pnl)]);
  const rowSize = fitFont(rowMoney, 152, 60, 32);
  const cards = (rows.length ? rows : [{}, {}, {}])
    .map((h, i) => {
      const s = SKIN[i % 3];
      const mark = (h.ticker || "—").replace(/[^A-Za-z]/g, "").slice(0, 3) || "—";
      const nm = h.name || NA;
      const tk = String(h.ticker || "");
      const showTk = tk !== "" && tk.toUpperCase() !== nm.trim().toUpperCase();
      const lg = logoOf(h);
      const badge = lg
        ? `<div class="badge" style="background:${lg.bg}"><img src="${lg.src}" alt="${esc(nm)}" style="object-fit:${lg.fit};padding:${lg.pad}px"></div>`
        : `<div class="badge" style="background:${s.badge}">${esc(mark)}</div>`;
      return `<div class="row">
      <div class="rhd">
        ${badge}
        <div>
          <div class="cn">${esc(nm)}</div>
          ${showTk ? `<div class="ct">${esc(tk)}</div>` : ""}
        </div>
      </div>
      <div class="cell"><div class="k">本期定投</div><div class="v" style="font-size:${rowSize}px">${money(h.per)}</div><div class="pv ghost">　</div></div>
      <div class="cell"><div class="k">累计投入</div><div class="v" style="font-size:${rowSize}px">${money(h.inv)}</div><div class="pv ghost">　</div></div>
      <div class="cell"><div class="k">浮盈</div><div class="v ${tone(h.pnl)}" style="font-size:${rowSize}px">${pnlText(h.pnl)}</div><div class="pv ${tone(h.pnl)}">${pctParen(h.rate)}</div></div>
    </div>`;
    })
    .join("");

  return base(
    `
  body {
    background:#fafaf8;
    color:#17243a;
    font-family:"Helvetica Neue","Inter",-apple-system,"PingFang SC",sans-serif;
    font-variant-numeric:tabular-nums;
  }
  .noise { display:none; }              /* 极简版不要纸纹 */
  .content { position:absolute; inset:96px 88px 168px; display:flex; flex-direction:column; }

  /* 报头 —— 与封面同一套 */
  .top { display:flex; justify-content:space-between; align-items:baseline; font-size:23px; letter-spacing:6px; font-weight:700; color:#c8161d; }
  .top .issue { color:#1a1a1a; }
  .rule { height:1px; margin-top:22px; background:#1a1a1a; }
  .counters { margin-top:34px; font-size:50px; font-weight:700; letter-spacing:5px; color:#c8161d; }
  .counters .sep { margin:0 6px; color:#1a1a1a; letter-spacing:0; }

  /* 三行白卡：细边框、轻圆角、无渐变无阴影 */
  .rows { flex:1; display:flex; flex-direction:column; gap:18px; margin-top:40px; }
  .row { flex:1; display:flex; align-items:center; gap:28px; background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:0 34px; }
  .rhd { flex:none; display:flex; align-items:center; gap:18px; min-width:272px; }
  .badge { width:84px; height:84px; border-radius:10px; overflow:hidden; border:1px solid #e5e7eb; color:#fff; font-family:"Helvetica Neue",sans-serif; font-size:26px; font-weight:600; display:flex; align-items:center; justify-content:center; flex:none; }
  .badge img { width:100%; height:100%; display:block; }
  .cn { font-size:36px; font-weight:700; letter-spacing:.5px; line-height:1.15; white-space:nowrap; color:#17243a; }
  .ct { margin-top:4px; font-size:22px; font-weight:500; color:#7a8492; letter-spacing:2px; white-space:nowrap; }
  .cell { flex:1; display:flex; flex-direction:column; align-items:flex-end; min-width:0; }
  .k { font-size:23px; font-weight:500; color:#7a8492; letter-spacing:2px; }
  .v { margin-top:6px; font-size:66px; font-weight:700; letter-spacing:-1.8px; line-height:1.08; white-space:nowrap; color:#17243a; }
  .v.up, .pv.up { color:#d94b4b; }
  .v.dn, .pv.dn { color:#16866a; }
  .pv { margin-top:4px; font-size:26px; font-weight:500; letter-spacing:.5px; white-space:nowrap; color:#7a8492; }
  .pv.ghost { visibility:hidden; }

  /* 总览：浅灰白底，三个并列数据区，数字是全图最大的一档 */
  .ov { margin-top:30px; display:flex; align-items:stretch; background:#f4f5f3; border:1px solid #e5e7eb; border-radius:14px; padding:34px 6px; }
  .ovi { flex:1; padding:0 24px; }
  .ovi + .ovi { border-left:1px solid #e5e7eb; }
  .ol { font-size:23px; font-weight:500; color:#7a8492; letter-spacing:2px; }
  .ovv { margin-top:14px; font-size:76px; font-weight:700; letter-spacing:-2px; line-height:1.05; white-space:nowrap; color:#17243a; }
  .ovp { margin-top:10px; font-size:28px; font-weight:500; letter-spacing:.5px; color:#7a8492; }
  .ovi.pnl .ovv, .ovi.pnl .ovp { color:#d94b4b; }
  .ovi.pnl.dn .ovv, .ovi.pnl.dn .ovp { color:#16866a; }

  /* 报脚 —— 与封面同一套 */
  .band { position:absolute; left:0; right:0; bottom:0; height:126px; background:#111; color:#faf8f4; display:flex; align-items:center; justify-content:space-between; padding:0 88px; }
  .band .l { font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:27px; letter-spacing:2px; }
  .band .r { font-size:23px; letter-spacing:5px; color:#cbbfb2; }
`,
    `<div class="content">
    <div class="hdb">
      <div class="top"><div>美股定投实录</div><div class="issue">${esc(d.date)}</div></div>
      <div class="rule"></div>
      ${counters(d)}
    </div>

    <div class="rows">${cards}</div>

    <div class="ov">
      <div class="ovi"><div class="ol">累计总投入</div><div class="ovv" style="font-size:${ovSize}px">${money(totalIn)}</div></div>
      <div class="ovi"><div class="ol">当前总市值</div><div class="ovv" style="font-size:${ovSize}px">${money(totalVal)}</div></div>
      <div class="ovi pnl ${tone(totalPnl)}">
        <div class="ol">累计总浮盈</div>
        <div class="ovv" style="font-size:${ovSize}px">${pnlText(totalPnl)}</div>
        <div class="ovp">${pctParen(totalRate)}</div>
      </div>
    </div>
  </div>
  <div class="band"><div class="l">${d.tickers.join(" / ")}</div><div class="r">${esc(d.handle)}</div></div>`,
  );
}

/* ───────────────────  G · 近一月走势  ───────────────────
   真实行情：data/<期号>-quotes.json（node fetch-quotes.mjs 生成）。
   三只标的以区间首日收盘价归一，画成百分比曲线；报头报脚与封面同一套。 */
// 三条线的颜色：亮钴蓝 · 活力橙 · 翡翠青绿（和红涨绿跌的语义色分开用）
const TREND_COLORS = { IQQ: "#2563eb", "BRK.B": "#f07818", SCHD: "#10b981" };
const TREND_FALLBACK = ["#2563eb", "#f07818", "#10b981"];
// 让网格线落在好看的刻度上：1 / 2 / 2.5 / 5 / 10 的整数倍
function niceStep(range, want = 4) {
  const raw = range / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || 10 * mag;
}

function themeTrend(d) {
  const q = QUOTES;
  const signed = (v, dec) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dec)}%`;
  const tone = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const md = (iso) => `${Number(iso.slice(5, 7))}.${iso.slice(8, 10)}`;

  // 画布几何（SVG 内部坐标 = CSS px）
  const CW = 904,
    CH = 560;
  const PT = 14,
    PB = 56,
    PR = 88; // 右侧留给百分比刻度
  const PW = CW - PR,
    PH = CH - PT - PB;

  let chart = `<div class="empty">暂无数据</div>`;
  let table = "";
  let range = "";

  if (q && Array.isArray(q.series) && q.series.length) {
    const series = q.series.map((s, i) => {
      const base = s.points[0].c;
      const pts = s.points.map((p) => ({ d: p.d, c: p.c, v: (p.c / base - 1) * 100 }));
      return {
        ticker: s.ticker,
        name: s.name,
        color: TREND_COLORS[String(s.ticker).toUpperCase()] || TREND_FALLBACK[i % 3],
        pts,
        last: pts.at(-1),
        chg: pts.at(-1).v,
      };
    });

    const all = series.flatMap((s) => s.pts.map((p) => p.v));
    const step = niceStep(Math.max(...all) - Math.min(...all), 4);
    const yMin = Math.floor(Math.min(0, ...all) / step) * step;
    const yMax = Math.ceil(Math.max(0, ...all) / step) * step;
    const n = series[0].pts.length;
    const X = (i) => (n === 1 ? 0 : (i / (n - 1)) * PW);
    const Y = (v) => PT + ((yMax - v) / (yMax - yMin)) * PH;

    let grid = "";
    for (let v = yMin; v <= yMax + 1e-9; v += step) {
      const y = Y(v).toFixed(1);
      const zero = Math.abs(v) < 1e-9;
      grid += `<line x1="0" y1="${y}" x2="${PW}" y2="${y}" stroke="${zero ? "#c6cbd3" : "#e5e7eb"}" stroke-width="1"/>`;
      grid += `<text x="${PW + 20}" y="${y}" dy="0.35em" fill="${zero ? "#17243a" : "#a8b0bc"}" font-size="22" font-weight="${zero ? 600 : 400}">${zero ? "0" : signed(v, 0)}</text>`;
    }

    const lines = series
      .map((s) => {
        const path = s.pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" ");
        const last = s.pts.length - 1;
        return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${X(last).toFixed(1)}" cy="${Y(s.last.v).toFixed(1)}" r="7" fill="${s.color}" stroke="#fafaf8" stroke-width="3"/>`;
      })
      .join("");

    const ticks = [...new Set([0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1])];
    const xlabels = ticks
      .map((i) => {
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
        return `<text x="${X(i).toFixed(1)}" y="${CH - 14}" text-anchor="${anchor}" fill="#7a8492" font-size="21">${md(series[0].pts[i].d)}</text>`;
      })
      .join("");

    chart = `<svg viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">${grid}${lines}${xlabels}</svg>`;
    range = `${q.from.replace(/-/g, ".")} – ${q.to.replace(/-/g, ".")}`;

    table = `<div class="tbl">
      <div class="th"><span>标的</span><span>最新收盘 · USD</span><span>区间涨跌</span></div>
      ${series
        .map(
          (s) => `<div class="tr">
        <span class="nm"><i style="background:${s.color}"></i>${esc(s.name)}${
            String(s.ticker).toUpperCase() !== String(s.name).trim().toUpperCase() ? `<span class="tk">${esc(s.ticker)}</span>` : ""
          }</span>
        <span class="px">${s.last.c.toFixed(2)}</span>
        <span class="cg ${tone(s.chg)}">${signed(s.chg, 2)}</span>
      </div>`,
        )
        .join("")}
    </div>`;
  }

  return base(
    `
  body {
    background:#fafaf8;
    color:#17243a;
    font-family:"Helvetica Neue","Inter",-apple-system,"PingFang SC",sans-serif;
    font-variant-numeric:tabular-nums;
  }
  .noise { display:none; }
  .content { position:absolute; inset:96px 88px 168px; display:flex; flex-direction:column; }

  /* 报头 —— 与封面同一套 */
  .top { display:flex; justify-content:space-between; align-items:baseline; font-size:23px; letter-spacing:6px; font-weight:700; color:#c8161d; }
  .top .issue { color:#1a1a1a; }
  .rule { height:1px; margin-top:22px; background:#1a1a1a; }
  .counters { margin-top:34px; font-size:50px; font-weight:700; letter-spacing:5px; color:#c8161d; }
  .counters .sep { margin:0 6px; color:#1a1a1a; letter-spacing:0; }

  /* 小标题 */
  .ttl { margin-top:36px; }
  .h1 { font-size:58px; font-weight:700; letter-spacing:1px; line-height:1.1; color:#17243a; }
  .sub { margin-top:12px; font-size:23px; color:#7a8492; letter-spacing:.5px; }

  /* 曲线 */
  .chart { margin-top:34px; height:560px; }
  .empty { height:100%; display:flex; align-items:center; justify-content:center; border:1px solid #e5e7eb; border-radius:14px; color:#a8b0bc; font-size:28px; letter-spacing:4px; }
  svg text { font-family:"Helvetica Neue","Inter",-apple-system,"PingFang SC",sans-serif; }

  /* 明细表：同时充当图例 */
  .tbl { margin-top:auto; padding-top:40px; }
  .th, .tr { display:flex; align-items:baseline; }
  .th { padding-bottom:14px; border-bottom:1px solid #1a1a1a; font-size:20px; letter-spacing:3px; color:#7a8492; }
  .th span:first-child { flex:1; }
  .th span:nth-child(2), .th span:nth-child(3) { width:196px; text-align:right; }
  .tr { padding:15px 0; border-bottom:1px solid #e5e7eb; }
  .nm { flex:1; display:flex; align-items:center; gap:14px; font-size:30px; font-weight:700; color:#17243a; }
  .nm i { width:14px; height:14px; border-radius:50%; flex:none; }
  .nm .tk { font-size:21px; font-weight:500; color:#7a8492; letter-spacing:2px; }
  .px { width:196px; text-align:right; font-size:26px; font-weight:600; color:#17243a; }
  .cg { width:196px; text-align:right; font-size:30px; font-weight:700; }
  .cg.up { color:#d94b4b; }
  .cg.dn { color:#16866a; }

  /* 报脚 —— 与封面同一套 */
  .band { position:absolute; left:0; right:0; bottom:0; height:126px; background:#111; color:#faf8f4; display:flex; align-items:center; justify-content:space-between; padding:0 88px; }
  .band .l { font-family:"DIN Alternate","Helvetica Neue",sans-serif; font-size:27px; letter-spacing:2px; }
  .band .r { font-size:23px; letter-spacing:5px; color:#cbbfb2; }
`,
    `<div class="content">
    <div class="hdb">
      <div class="top"><div>美股定投实录</div><div class="issue">${esc(d.date)}</div></div>
      <div class="rule"></div>
      ${counters(d)}
    </div>

    <div class="ttl">
      <div class="h1">近一月走势</div>
      <div class="sub">${range ? `${range} · ` : ""}以区间首日收盘价为基准 · 数据来源 ${esc(q?.source || "东方财富")}</div>
    </div>

    <div class="chart">${chart}</div>
    ${table}
  </div>
  <div class="band"><div class="l">${d.tickers.join(" / ")}</div><div class="r">${esc(d.handle)}</div></div>`,
  );
}

// 目前用「时评」（小红书 3:4）和「公众号头图」（2.35:1）；
// 墨韵/森屿的实现仍保留在文件里，想换回来把对应主题加进这个对象即可
const THEMES = {
  press: { render: themePress, w: 1080, h: 1440 },
  panel: { render: themePanel, w: 1080, h: 1440 },
  trend: { render: themeTrend, w: 1080, h: 1440 },
  wechat: { render: themeWechat, w: 900, h: 383 },
};

// ── 渲染 ──
if (!existsSync(CHROME)) {
  console.error("找不到 Google Chrome，无法渲染。");
  process.exit(1);
}
mkdirSync(join(ROOT, ".build"), { recursive: true });
mkdirSync(join(ROOT, "out"), { recursive: true });

const picked =
  themeFlag === "all" ? Object.keys(THEMES) : [themeFlag].filter((t) => THEMES[t]);
if (!picked.length) {
  console.error(`未知主题 ${themeFlag}，可选：${Object.keys(THEMES).join(", ")}`);
  process.exit(1);
}

for (const name of picked) {
  const htmlPath = join(ROOT, ".build", `${issueId}-${name}.html`);
  const outPath = join(ROOT, "out", `${issueId}-${name}.png`);
  const theme = THEMES[name];
  writeFileSync(htmlPath, theme.render(issue), "utf8");
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=/tmp/xhs-cover-chrome",
      `--window-size=${theme.w},${theme.h}`,
      "--force-device-scale-factor=2",
      "--virtual-time-budget=3000",
      `--screenshot=${outPath}`,
      resolve(htmlPath),
    ],
    { stdio: "ignore", timeout: 60_000 },
  );
  console.log(`✓ ${outPath}`);
}

/* ─────────────────────────  网页预览  ─────────────────────────
   把所有已生成的封面内嵌成单文件 gallery.html，双击即可看、可下载。 */
const THEME_INFO = {
  press: {
    cn: "小红书封面",
    en: "PRESS · 3:4",
    desc: "黑白报刊 + 中国红，粗衬线大标题。1080×1440，导出 2160×2880。",
  },
  panel: {
    cn: "账户面板 · 极简",
    en: "PANEL · 3:4",
    desc: "瑞士极简投资月报：报头报脚与封面同一套（红眉标 + 黑色页脚带），背景同为 #fafaf8。三张白卡（细灰边框）各一行「标的 / 累计投入 / 浮盈+收益率」，底部浅灰三栏总览。深海军蓝主色，红涨绿跌。金额按位数自动缩放。1080×1440，导出 2160×2880。",
  },
  trend: {
    cn: "近一月走势",
    en: "TREND · 3:4",
    desc: "真实行情曲线：三只标的按区间首日收盘价归一，横轴交易日、纵轴涨跌幅；底部明细表兼图例。数据由 fetch-quotes.mjs 拉取（东方财富为主、Nasdaq 兜底，本地缓存增量更新），没有数据时显示「暂无数据」。1080×1440，导出 2160×2880。",
  },
  wechat: {
    cn: "公众号头图",
    en: "WECHAT · 2.35:1",
    desc: "同一套版式的横版：左边标题，右边本期/累计，底部黑条。900×383，导出 1800×766。",
  },
};

function buildGallery() {
  const outDir = join(ROOT, "out");
  const previewDir = join(ROOT, ".build", "previews");
  mkdirSync(previewDir, { recursive: true });
  // 按主题顺序排（封面 → 看板 → 头图），而不是按字母序
  const order = Object.keys(THEMES);
  const rank = (t) => (order.indexOf(t) + 1) || 99;
  const files = readdirSync(outDir)
    .filter((f) => /^\d+-[a-z]+\.png$/.test(f))
    .sort((a, b) => {
      const [, ia, ta] = a.match(/^(\d+)-([a-z]+)\.png$/);
      const [, ib, tb] = b.match(/^(\d+)-([a-z]+)\.png$/);
      return ia.localeCompare(ib) || rank(ta) - rank(tb);
    });

  const issues = new Map();
  for (const f of files) {
    const [, id, theme] = f.match(/^(\d+)-([a-z]+)\.png$/);
    if (!issues.has(id)) issues.set(id, []);
    issues.get(id).push({ file: f, theme });
  }
  if (!issues.size) return null;

  const cards = [...issues.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, list]) => {
      let data = {};
      const cfgPath = join(ROOT, "issues", `${id}.json`);
      if (existsSync(cfgPath)) data = JSON.parse(readFileSync(cfgPath, "utf8"));

      const items = Object.keys(THEME_INFO)
        .map((t) => {
          const hit = list.find((x) => x.theme === t);
          if (!hit) return "";
          // 用 JPEG 内嵌到网页里，体积小、手机上也能直接存图；原始 PNG 仍在 out/
          const jpgName = hit.file.replace(/\.png$/, ".jpg");
          const jpgPath = join(previewDir, jpgName);
          execFileSync(
            "sips",
            ["-s", "format", "jpeg", "-s", "formatOptions", "92", join(outDir, hit.file), "--out", jpgPath],
            { stdio: "ignore" },
          );
          const b64 = readFileSync(jpgPath).toString("base64");
          const info = THEME_INFO[t];
          return `<article class="card">
            <div class="shot"><img src="data:image/jpeg;base64,${b64}" alt="${id} ${info.cn}"></div>
            <div class="meta"><div class="name">${info.cn}</div><div class="en">${info.en}</div></div>
            <p class="desc">${info.desc}</p>
            <a class="btn" download="${jpgName}" href="#">保存封面</a>
            <a class="btn ghost" download="${hit.file}" href="out/${hit.file}">PNG 原图</a>
          </article>`;
        })
        .join("");

      return `<section class="issue">
        <div class="issue-head">
          <h2>第 ${String(Number(id)).padStart(2, "0")} 期</h2>
          <span>${esc(data.month || "")}</span>
        </div>
        ${data.title ? `<p class="issue-title">${data.title.map((t) => esc(t.replace(/[~*]/g, "").trim())).join(" / ")}</p>` : ""}
        <div class="grid">${items}</div>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>美股定投 · 封面</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background-color:#fbf7ee;
    background-image:
      repeating-linear-gradient(to right, rgba(120,112,92,.045) 0 1px, transparent 1px 28px),
      repeating-linear-gradient(to bottom, rgba(120,112,92,.045) 0 1px, transparent 1px 28px);
    color:#3b3632; font-family:"Songti SC","Source Han Serif SC",serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1180px; margin:0 auto; padding:76px 44px 120px; }
  .eyebrow { font-family:-apple-system,"PingFang SC",sans-serif; font-size:12px; font-weight:600; letter-spacing:9px; color:#a8402f; }
  h1 { font-size:54px; font-weight:600; letter-spacing:3px; margin:24px 0 18px; }
  .lede { font-family:-apple-system,"PingFang SC",sans-serif; font-size:14px; line-height:2; letter-spacing:.6px; color:#8d8478; max-width:640px; }
  .toolbar { display:flex; gap:12px; margin-top:38px; flex-wrap:wrap; }
  .btn {
    display:inline-block; padding:11px 24px; border:1px solid #3b3632; background:transparent; color:#3b3632;
    font-family:-apple-system,"PingFang SC",sans-serif; font-size:12px; letter-spacing:3px; cursor:pointer;
    text-decoration:none; transition:all .18s ease;
  }
  .btn:hover { background:#3b3632; color:#fbf7ee; }
  .btn.primary { background:#a8402f; border-color:#a8402f; color:#fff; }
  .btn.primary:hover { background:#8d3325; border-color:#8d3325; }
  .issue { margin-top:78px; }
  .issue-head { display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid rgba(120,112,92,.3); padding-top:26px; }
  .issue-head h2 { font-size:28px; font-weight:600; letter-spacing:3px; }
  .issue-head span { font-family:-apple-system,"PingFang SC",sans-serif; font-size:12px; letter-spacing:3px; color:#9a9184; }
  .issue-title { font-size:17px; letter-spacing:1px; color:#8d8478; margin-top:14px; }
  .grid { display:flex; flex-wrap:wrap; gap:38px; margin-top:34px; }
  .card { flex:1 1 300px; max-width:360px; }
  .shot { background:#fff; border-radius:3px; overflow:hidden; line-height:0; cursor:zoom-in;
    box-shadow:0 20px 44px -26px rgba(60,50,35,.6), 0 2px 6px rgba(60,50,35,.06);
    transition:transform .25s ease, box-shadow .25s ease; }
  .shot:hover { transform:translateY(-4px); box-shadow:0 30px 56px -26px rgba(60,50,35,.65), 0 3px 8px rgba(60,50,35,.08); }
  .shot img { width:100%; display:block; }
  .meta { display:flex; justify-content:space-between; align-items:baseline; margin-top:20px; }
  .meta .name { font-size:21px; letter-spacing:3px; }
  .meta .en { font-family:-apple-system,sans-serif; font-size:10px; letter-spacing:4px; color:#b58a54; }
  .desc { font-family:-apple-system,"PingFang SC",sans-serif; font-size:12.5px; line-height:1.9; color:#9a9184; margin-top:9px; letter-spacing:.3px; min-height:48px; }
  .card .btn { width:100%; text-align:center; margin-top:14px; }
  .card .btn.ghost { margin-top:8px; padding:9px 0; font-size:11px; border-color:#cfc9bf; color:#6a6a6a; }
  .lightbox { position:fixed; inset:0; background:rgba(40,34,26,.86); display:none; align-items:center; justify-content:center; padding:40px; z-index:9; cursor:zoom-out; }
  .lightbox.on { display:flex; }
  .lightbox img { max-height:100%; max-width:100%; box-shadow:0 40px 90px rgba(0,0,0,.5); }
  footer { margin-top:100px; padding-top:26px; border-top:1px solid rgba(120,112,92,.3); font-family:-apple-system,"PingFang SC",sans-serif; font-size:12px; letter-spacing:2px; color:#9a9184; display:flex; justify-content:space-between; }
  @media (max-width:900px) { .grid { grid-template-columns:1fr; } .wrap { padding:48px 22px 80px; } h1 { font-size:36px; } }
</style></head>
<body>
<div class="wrap">
  <div class="eyebrow">MOXIA · 美股定投</div>
  <h1>定投封面</h1>
  <p class="lede">小红书 1080×1440（3:4，导出 2160×2880），公众号 900×383（2.35:1，导出 1800×766）。「保存封面」存压缩图，「PNG 原图」存无损图——上传平台建议用 PNG。改 issues/ 里的 JSON 保存，这里会自动更新。</p>
  <div class="toolbar">
    <button class="btn primary" id="dlAll">下载全部</button>
    <a class="btn" href="out/covers.zip" download>原始 PNG 打包</a>
  </div>
  ${cards}
  <footer><span>美股定投实录 · moxia 风格封面</span><span>IQQ · BRK.B · SCHD</span></footer>
</div>
<div class="lightbox" id="lb"><img id="lbImg" alt=""></div>
<script>
  const lb = document.getElementById('lb'), lbImg = document.getElementById('lbImg');
  document.querySelectorAll('.card').forEach(card => {
    const img = card.querySelector('img'), link = card.querySelector('a[download]');
    if (link) link.href = img.src;
    card.querySelector('.shot').addEventListener('click', () => { lbImg.src = img.src; lb.classList.add('on'); });
  });
  lb.addEventListener('click', () => lb.classList.remove('on'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('on'); });
  document.getElementById('dlAll').addEventListener('click', async () => {
    const links = [...document.querySelectorAll('.card a[download]:not(.ghost)')];
    for (const a of links) { a.click(); await new Promise(r => setTimeout(r, 600)); }
  });
</script>
</body></html>`;

  // 原始 PNG 打包，方便一次拷进小红书草稿
  try {
    execFileSync(
      "zip",
      ["-j", "-q", "-FS", join(outDir, "covers.zip"), ...files.map((f) => join(outDir, f))],
      { stdio: "ignore" },
    );
  } catch {}

  const p = join(ROOT, "gallery.html");
  writeFileSync(p, html, "utf8");
  return p;
}

const galleryPath = buildGallery();
if (galleryPath) console.log(`✓ ${galleryPath}`);
