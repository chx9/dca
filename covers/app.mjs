#!/usr/bin/env node
/**
 * 封面生成网页应用
 *   node app.mjs [port]        # 默认 4330，占用则顺延
 *
 * 浏览器里填：期数、第一天日期、三只标的的 本期定投 / 累计定投 / 当前市值（美元）。
 * 服务器自动拿 frankfurter.dev 的 USD→CNY 汇率换算成人民币，写 issues/<期号>.json，
 * 再拉最近 30 天行情、跑 build.mjs，页面上直接看四张成品图。
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
let PORT = Number(process.argv[2]) || 4330;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
};

// 三只标的的 ticker 写死（fetch-quotes.mjs 的市场编号表只认识它们），名字可改
const STOCKS = [
  { name: "纳指", ticker: "IQQ" },
  { name: "伯克希尔", ticker: "BRK.B" },
  { name: "SCHD", ticker: "SCHD" },
];
const DEFAULTS = {
  start: "2026-11-05",
  kicker: "坚持定投 · 慢慢变富 · 早日退休",
  handle: "@奔放游民",
};

/* ── 汇率：frankfurter.dev（ECB 参考价，每个交易日更新一次）── */
const FX_FILE = join(ROOT, "data", "fx.json");
async function fetchFx() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch("https://api.frankfurter.dev/v2/rate/USD/CNY", { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Number.isFinite(j?.rate) || j.rate <= 0) throw new Error("返回里没有有效 rate");
    const fx = {
      rate: j.rate,
      date: j.date,
      source: "frankfurter.dev · ECB 参考汇率",
      fetchedAt: new Date().toISOString(),
    };
    if (!existsSync(join(ROOT, "data"))) mkdirSync(join(ROOT, "data"));
    writeFileSync(FX_FILE, JSON.stringify(fx, null, 2) + "\n");
    return fx;
  } finally {
    clearTimeout(timer);
  }
}
const cachedFx = () => {
  try {
    return JSON.parse(readFileSync(FX_FILE, "utf8"));
  } catch {
    return null;
  }
};

/* ── 小工具 ── */
const pad3 = (n) => String(n).padStart(3, "0");
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const round2 = (n) => Math.round(n * 100) / 100;

function nextIssue() {
  let max = 0;
  for (const f of readdirSync(join(ROOT, "issues"))) {
    const m = /^(\d+)\.json$/.exec(f);
    if (!m) continue;
    try {
      const j = JSON.parse(readFileSync(join(ROOT, "issues", f), "utf8"));
      max = Math.max(max, Number(j.issue) || Number(m[1]) || 0);
    } catch {}
  }
  return max + 1;
}

const run = (args) =>
  new Promise((resolve) => {
    execFile("node", args, { cwd: ROOT }, (err, stdout, stderr) => {
      resolve({ ok: !err, log: String(stdout + (stderr ? "\n" + stderr : "")).trim() });
    });
  });

// 串行生成，避免两个请求同时写 issues / out
let busy = Promise.resolve();
const enqueue = (job) => (busy = busy.then(job, job));

/* ── 生成一期 ── */
async function generate(body) {
  const issueNo = Math.floor(Number(body.issue));
  if (!Number.isInteger(issueNo) || issueNo < 1) throw new Error("期数要是 ≥ 1 的整数");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start || "")) throw new Error("第一天日期格式 YYYY-MM-DD");
  const days = [15, 30, 60, 90].includes(Number(body.days)) ? Number(body.days) : 30;

  const stocks = STOCKS.map((def, i) => {
    const s = (body.stocks || [])[i] || {};
    const num = (v, label, optional) => {
      if (v == null || v === "") {
        if (optional) return null;
        throw new Error(`${def.name} 的${label}没填`);
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${def.name} 的${label}不是有效数字`);
      return n;
    };
    return {
      name: String(s.name || def.name).trim() || def.name,
      ticker: def.ticker,
      periodUsd: num(s.period, "本期定投"),
      investedUsd: num(s.invested, "累计定投"),
      valueUsd: num(s.value, "当前市值", true), // 不填 → 浮盈显示「暂无数据」，不猜
    };
  });

  // 汇率：手动覆盖 > 实时拉取 > 本地缓存
  let fx;
  if (Number(body.fxOverride) > 0) {
    fx = { rate: Number(body.fxOverride), date: iso(new Date()), source: "手动填写", fetchedAt: new Date().toISOString() };
  } else {
    try {
      fx = await fetchFx();
    } catch (e) {
      fx = cachedFx();
      if (!fx) throw new Error(`汇率拉取失败（${e.message}），且没有本地缓存，请手动填汇率`);
      fx = { ...fx, source: fx.source + "（拉取失败，用缓存）" };
    }
  }
  const rmb = (usd) => (usd == null ? null : round2(usd * fx.rate));

  const now = new Date();
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  const day = Math.max(1, Math.floor((new Date(iso(now)) - new Date(body.start)) / 86400000) + 1);

  const holdings = stocks.map((s) => ({
    name: s.name,
    ticker: s.ticker,
    period: rmb(s.periodUsd),
    invested: rmb(s.investedUsd),
    value: rmb(s.valueUsd),
    usd: { period: s.periodUsd, invested: s.investedUsd, value: s.valueUsd },
  }));
  const sum = (k) => stocks.reduce((a, s) => a + s[k], 0);
  const names = stocks.map((s) => s.name);
  const title = Array.isArray(body.title) && body.title.some((t) => String(t).trim())
    ? body.title.map((t) => String(t))
    : ["*十年定投*", `~${names.join("、")}`];

  const data = {
    issue: issueNo,
    date,
    month,
    start: body.start,
    day,
    title,
    kicker: String(body.kicker || DEFAULTS.kicker),
    handle: String(body.handle || DEFAULTS.handle),
    tickers: stocks.map((s) => s.ticker),
    stats: [
      { label: "本期定投", value: fmt(sum("periodUsd") * fx.rate), prefix: "¥" },
      { label: "累计定投", value: fmt(sum("investedUsd") * fx.rate), prefix: "¥" },
    ],
    holdings,
    fx: { rate: fx.rate, date: fx.date, source: fx.source },
  };

  const id = pad3(issueNo);
  writeFileSync(join(ROOT, "issues", `${id}.json`), JSON.stringify(data, null, 2) + "\n");

  // 行情：最近 N 天（自然日，交易日由接口决定）
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const q = await run(["fetch-quotes.mjs", id, iso(from), iso(now)]);
  const b = await run(["build.mjs", id]);
  if (!b.ok) throw new Error(`build.mjs 失败：\n${b.log}`);

  return {
    ok: true,
    issue: id,
    day,
    fx,
    quotes: q.ok,
    from: iso(from),
    to: iso(now),
    log: [q.log, b.log].filter(Boolean).join("\n"),
    images: ["press", "panel", "trend", "wechat"].map((t) => `out/${id}-${t}.png`),
  };
}

/* ── 页面 ── */
const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>封面生成器 · 美股定投实录</title>
<style>
  :root { --paper:#fafaf8; --ink:#17243a; --muted:#7a8492; --faint:#e5e7eb; --red:#c8161d; --up:#d94b4b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family:"Helvetica Neue","Inter",-apple-system,"PingFang SC",sans-serif;
         font-variant-numeric:tabular-nums; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:960px; margin:0 auto; padding:56px 32px 96px; }
  .top { display:flex; justify-content:space-between; align-items:baseline;
         font-size:14px; letter-spacing:5px; font-weight:700; color:var(--red); }
  .top .r { color:#1a1a1a; }
  .rule { height:1px; margin-top:12px; background:#1a1a1a; }
  h1 { margin:34px 0 6px; font-size:34px; font-weight:700; letter-spacing:1px; }
  .sub { font-size:13px; color:var(--muted); line-height:1.8; }
  section { margin-top:36px; background:#fff; border:1px solid var(--faint); border-radius:14px; padding:26px 28px; }
  .sec-t { font-size:13px; font-weight:700; letter-spacing:3px; color:var(--muted); margin-bottom:18px; }
  .grid { display:flex; flex-wrap:wrap; gap:18px 28px; }
  label { display:block; font-size:12px; font-weight:600; letter-spacing:1.5px; color:var(--muted); margin-bottom:6px; }
  input, select { font:inherit; font-size:16px; font-weight:600; color:var(--ink);
                  border:1px solid var(--faint); border-radius:8px; padding:9px 12px; background:#fff; min-width:0; }
  input:focus, select:focus { outline:2px solid #2563eb33; border-color:#2563eb; }
  table { border-collapse:collapse; width:100%; }
  th { font-size:12px; font-weight:600; letter-spacing:1.5px; color:var(--muted); text-align:right; padding:0 6px 10px; white-space:nowrap; }
  th:first-child, td:first-child { text-align:left; }
  td { padding:6px 6px; text-align:right; }
  td input { width:130px; text-align:right; }
  td .nm { font-size:16px; font-weight:700; }
  td .tk { font-size:12px; color:var(--muted); letter-spacing:1.5px; margin-left:8px; font-weight:500; }
  tr.sum td { border-top:1px solid var(--faint); padding-top:12px; font-weight:700; font-size:15px; }
  tr.sum .rmb { color:var(--red); }
  .fxline { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; font-size:15px; }
  .fxline b { font-size:22px; color:var(--red); }
  .fxline .src { font-size:12px; color:var(--muted); }
  .fxline input { width:110px; }
  .ghost-btn, button.go { font:inherit; cursor:pointer; border-radius:8px; }
  .ghost-btn { background:none; border:1px solid var(--faint); padding:8px 14px; font-size:13px; color:var(--muted); }
  button.go { margin-top:36px; width:100%; border:0; background:#111; color:#faf8f4;
              font-size:18px; font-weight:700; letter-spacing:6px; padding:18px 0; }
  button.go:disabled { opacity:.45; cursor:wait; }
  .status { margin-top:18px; font-size:13px; color:var(--muted); line-height:1.8; white-space:pre-wrap; word-break:break-all; }
  .status.err { color:var(--up); }
  .results { margin-top:36px; display:none; }
  .results.on { display:block; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:18px; margin-top:18px; }
  .card { background:#fff; border:1px solid var(--faint); border-radius:12px; overflow:hidden; }
  .card img { display:block; width:100%; }
  .card .cap { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; font-size:13px; }
  .card a { color:#2563eb; text-decoration:none; font-weight:600; }
  details { margin-top:36px; }
  summary { cursor:pointer; font-size:13px; font-weight:700; letter-spacing:3px; color:var(--muted); }
  details section { margin-top:16px; }
  @media (max-width:640px) { td input { width:96px; } .wrap { padding:32px 16px 64px; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div>美股定投实录</div><div class="r">封面生成器</div></div>
  <div class="rule"></div>
  <h1>生成一期封面</h1>
  <div class="sub">金额一律填<b>美元</b>，服务器按实时汇率换算成人民币出图。当前市值不填的话，浮盈那栏显示「暂无数据」。</div>

  <section>
    <div class="sec-t">基本信息</div>
    <div class="grid">
      <div><label>第几期</label><input id="issue" type="number" min="1" step="1" style="width:100px"></div>
      <div><label>定投第一天</label><input id="start" type="date" value="${DEFAULTS.start}"></div>
      <div><label>走势天数</label><select id="days"><option>15</option><option selected>30</option><option>60</option><option>90</option></select></div>
    </div>
  </section>

  <section>
    <div class="sec-t">三只标的（美元）</div>
    <table>
      <thead><tr><th>标的</th><th>本期定投 $</th><th>累计定投 $</th><th>当前市值 $</th></tr></thead>
      <tbody id="rows"></tbody>
      <tfoot>
        <tr class="sum"><td>合计</td><td id="sPer"></td><td id="sInv"></td><td id="sVal"></td></tr>
        <tr class="sum"><td colspan="3" style="text-align:left;font-weight:500;color:var(--muted);font-size:13px">按当前汇率折人民币</td><td class="rmb" id="sRmb"></td></tr>
      </tfoot>
    </table>
  </section>

  <section>
    <div class="sec-t">汇率 USD → CNY</div>
    <div class="fxline">
      <b id="fxRate">获取中…</b>
      <span class="src" id="fxSrc"></span>
      <button class="ghost-btn" id="fxRefresh">刷新</button>
      <span class="src">手动覆盖：</span><input id="fxOverride" type="number" step="0.0001" min="0" placeholder="留空用实时">
    </div>
  </section>

  <details>
    <summary>文案（默认沿用上一期）</summary>
    <section>
      <div class="grid">
        <div style="flex:1;min-width:220px"><label>标题第一行</label><input id="t1" style="width:100%" value="*十年定投*"></div>
        <div style="flex:1;min-width:220px"><label>标题第二行</label><input id="t2" style="width:100%" placeholder="留空自动用三只标的"></div>
      </div>
      <div class="grid" style="margin-top:16px">
        <div style="flex:1;min-width:220px"><label>副标题</label><input id="kicker" style="width:100%" value="${DEFAULTS.kicker}"></div>
        <div style="flex:1;min-width:220px"><label>底部账号</label><input id="handle" style="width:100%" value="${DEFAULTS.handle}"></div>
      </div>
    </section>
  </details>

  <button class="go" id="go">生 成 封 面</button>
  <div class="status" id="status"></div>

  <div class="results" id="results">
    <div class="sec-t">成品（点图放大，右侧下载）</div>
    <div class="cards" id="cards"></div>
    <div class="sub" style="margin-top:14px">全部期数见 <a href="/gallery.html" style="color:#2563eb">gallery</a>；原始文件在 covers/out/。</div>
  </div>
</div>

<script>
const STOCKS = ${JSON.stringify(STOCKS)};
const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtRmb = (n) => "¥" + Math.round(n).toLocaleString("en-US");
let FX = null;

$("rows").innerHTML = STOCKS.map((s, i) =>
  \`<tr><td><span class="nm">\${s.name}</span><span class="tk">\${s.ticker}</span></td>\` +
  ["period", "invested", "value"].map((k) =>
    \`<td><input data-i="\${i}" data-k="\${k}" type="number" min="0" step="0.01" placeholder="0.00"></td>\`).join("") +
  "</tr>").join("");

function totals() {
  const t = { period: 0, invested: 0, value: 0 };
  document.querySelectorAll("#rows input").forEach((inp) => {
    const v = Number(inp.value);
    if (Number.isFinite(v)) t[inp.dataset.k] += v;
  });
  $("sPer").textContent = fmtUsd(t.period);
  $("sInv").textContent = fmtUsd(t.invested);
  $("sVal").textContent = fmtUsd(t.value);
  const rate = Number($("fxOverride").value) > 0 ? Number($("fxOverride").value) : FX?.rate;
  $("sRmb").textContent = rate ? "本期 " + fmtRmb(t.period * rate) + " · 累计 " + fmtRmb(t.invested * rate) : "";
}
document.querySelectorAll("#rows input").forEach((i) => i.addEventListener("input", totals));
$("fxOverride").addEventListener("input", totals);

async function loadFx(manual) {
  $("fxRate").textContent = "获取中…";
  try {
    const r = await fetch("/api/fx" + (manual ? "?refresh=1" : ""));
    const j = await r.json();
    if (!j.rate) throw new Error(j.error || "失败");
    FX = j;
    $("fxRate").textContent = "1 USD = " + j.rate + " CNY";
    $("fxSrc").textContent = j.date + " · " + j.source + (j.stale ? "（缓存）" : "");
  } catch (e) {
    $("fxRate").textContent = "拉取失败";
    $("fxSrc").textContent = e.message + "，请手动覆盖";
  }
  totals();
}
$("fxRefresh").addEventListener("click", () => loadFx(true));

fetch("/api/next-issue").then((r) => r.json()).then((j) => { $("issue").value = j.issue; });
loadFx();

$("go").addEventListener("click", async () => {
  const btn = $("go"), st = $("status");
  btn.disabled = true;
  st.className = "status";
  st.textContent = "正在生成：写数据 → 拉行情 → 截图（约十几秒）…";
  $("results").classList.remove("on");
  const stocks = STOCKS.map((s, i) => ({
    name: s.name, ticker: s.ticker,
    period: document.querySelector(\`input[data-i="\${i}"][data-k="period"]\`).value,
    invested: document.querySelector(\`input[data-i="\${i}"][data-k="invested"]\`).value,
    value: document.querySelector(\`input[data-i="\${i}"][data-k="value"]\`).value,
  }));
  const t2 = $("t2").value.trim();
  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issue: $("issue").value, start: $("start").value, days: $("days").value,
        stocks, fxOverride: $("fxOverride").value,
        title: [$("t1").value, t2].filter((x) => x && x.trim()),
        kicker: $("kicker").value, handle: $("handle").value,
      }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    const names = { press: "小红书封面", panel: "账户月报", trend: "近一月走势", wechat: "公众号头图" };
    $("cards").innerHTML = j.images.map((src) => {
      const t = src.match(/-(\\w+)\\.png$/)[1];
      return \`<div class="card"><a href="/\${src}?v=\${Date.now()}" target="_blank"><img src="/\${src}?v=\${Date.now()}"></a>
        <div class="cap"><span>\${names[t] || t}</span><a href="/\${src}" download>下载</a></div></div>\`;
    }).join("");
    $("results").classList.add("on");
    st.textContent = "✓ 第 " + j.day + " 天 · 第 " + j.issue + " 期　汇率 " + j.fx.rate + "（" + j.fx.date + "）" +
      (j.quotes ? "　行情 " + j.from + " → " + j.to : "　⚠ 行情没拉到，走势图显示「暂无数据」");
  } catch (e) {
    st.className = "status err";
    st.textContent = "✗ " + e.message;
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;

/* ── HTTP ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
  };

  if (path === "/" || path === "/index.html") return send(200, MIME[".html"], PAGE);

  if (path === "/api/next-issue") return send(200, MIME[".json"], JSON.stringify({ issue: nextIssue() }));

  if (path === "/api/fx") {
    if (!url.searchParams.has("refresh")) {
      const c = cachedFx();
      // 缓存是今天的就直接用，省一次外网请求
      if (c && c.fetchedAt && c.fetchedAt.slice(0, 10) === iso(new Date()))
        return send(200, MIME[".json"], JSON.stringify({ ...c, stale: false }));
    }
    try {
      return send(200, MIME[".json"], JSON.stringify(await fetchFx()));
    } catch (e) {
      const c = cachedFx();
      if (c) return send(200, MIME[".json"], JSON.stringify({ ...c, stale: true, error: e.message }));
      return send(200, MIME[".json"], JSON.stringify({ error: e.message }));
    }
  }

  if (path === "/api/generate" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const j = JSON.parse(body || "{}");
        const out = await enqueue(() => generate(j));
        send(200, MIME[".json"], JSON.stringify(out));
      } catch (e) {
        send(200, MIME[".json"], JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 静态文件：out/*.png、gallery.html、data/*.json 等
  const file = join(ROOT, path);
  if (file.startsWith(ROOT) && existsSync(file) && !file.endsWith(".mjs")) {
    try {
      return send(200, MIME[extname(file)] || "application/octet-stream", readFileSync(file));
    } catch {}
  }
  send(404, "text/plain; charset=utf-8", "404");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    PORT += 1;
    server.listen(PORT);
  } else throw e;
});
server.listen(PORT, () => console.log(`→ http://localhost:${PORT}`));
