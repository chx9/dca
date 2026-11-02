#!/usr/bin/env node
/**
 * 拉行情（本地缓存 + 增量更新），写进 data/<期号>-quotes.json，供 build.mjs 画走势图。
 *
 * 用法：
 *   node fetch-quotes.mjs 001                    # 默认取「上一个自然月」
 *   node fetch-quotes.mjs 001 2026-10-03 2026-11-02
 *
 * 缓存：data/quotes-cache.json，按标的存 {日期: 收盘价}。
 *   - 每次只请求「最新缓存日期的后一天 → 结束日」这一小段，已有日期一律不重抓
 *   - 首次运行时用 data/ 里已有的 *-quotes.json 回填缓存，历史不用重拉
 *
 * 数据源（同一天的收盘价两边一致，已对过）：
 *   1. 东方财富 push2his 日 K（前复权 fqt=1）——主源
 *   2. Nasdaq 官方 API（收盘价）——东财不可达时自动切换，本次运行内不再回头试东财
 *
 * 规则：拿不到的标的记缺失、不补不猜；三只不齐全就不覆盖旧文件。
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const CACHE_FILE = join(DATA, "quotes-cache.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36";

// 东方财富的美股市场编号；加新标的时在这里补一行
const MARKET = { IQQ: 105, "BRK.B": 106, SCHD: 107 };
// Nasdaq 兜底的 assetclass（ETF / 普通股票）
const NASDAQ_CLASS = { IQQ: "etf", "BRK.B": "stocks", SCHD: "etf" };
const secid = (t) => `${MARKET[t.toUpperCase()] ?? 105}.${String(t).replace(/\./g, "_")}`;

const get = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", ...headers } }, (r) => {
        if (r.statusCode !== 200) {
          r.resume();
          reject(new Error(`HTTP ${r.statusCode}`));
          return;
        }
        let s = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (s += c));
        r.on("end", () => resolve(s));
      })
      .on("error", reject);
  });

// 网络抖动时重试；同一接口最多试 tries 次，不重试到死
const getRetry = async (url, tries = 2, headers) => {
  for (let i = 0; ; i++) {
    try {
      return await get(url, headers);
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
};

/* ── 日期 ── */
const isoOf = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const shift = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ── 两种数据源 ── */
// 东财：klines 是逗号串「日期,收」，价格是原始小数
async function fromEastmoney(ticker, fromIso, toIso) {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
    `?secid=${secid(ticker)}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1` +
    `&beg=${fromIso.replace(/-/g, "")}&end=${toIso.replace(/-/g, "")}`;
  const j = JSON.parse(await getRetry(url, 1, { Referer: "https://quote.eastmoney.com/" }));
  const klines = j?.data?.klines || [];
  return klines
    .map((k) => {
      const [d, c] = k.split(",");
      return { d, c: Number(c) };
    })
    .filter((p) => Number.isFinite(p.c));
}

// Nasdaq：rows 里的日期是 10/30/2026，收盘带「$」和千分位，清掉再转
async function fromNasdaq(ticker, fromIso, toIso) {
  const cls = NASDAQ_CLASS[ticker.toUpperCase()] || "stocks";
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical` +
    `?assetclass=${cls}&fromdate=${fromIso}&todate=${toIso}&limit=500`;
  const j = JSON.parse(await getRetry(url, 2, { Referer: "https://www.nasdaq.com/" }));
  const rows = j?.data?.tradesTable?.rows || [];
  return rows
    .map((r) => {
      const [mm, dd, yyyy] = String(r.date).split("/");
      return { d: `${yyyy}-${mm}-${dd}`, c: Number(String(r.close).replace(/[$,]/g, "")) };
    })
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && Number.isFinite(p.c))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

/* ── 缓存 ── */
function loadCache() {
  if (existsSync(CACHE_FILE)) {
    try {
      const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
      if (c && c.tickers) return c;
    } catch {
      console.warn("! 缓存文件损坏，重新回填");
    }
  }
  const c = { updatedAt: null, tickers: {} };
  // 从已有的每期行情文件回填，历史不重抓
  for (const f of existsSync(DATA) ? readdirSync(DATA) : []) {
    if (!/-quotes\.json$/.test(f)) continue;
    try {
      const d = JSON.parse(readFileSync(join(DATA, f), "utf8"));
      const src = /东方财富/.test(d.source || "") ? "东方财富" : String(d.source || "旧数据").split(/[\s·]/)[0];
      for (const s of d.series || []) {
        const t = (c.tickers[s.ticker] ||= { points: {}, sources: [] });
        for (const p of s.points || []) if (t.points[p.d] == null) t.points[p.d] = p.c;
        if (src && !t.sources.includes(src)) t.sources.push(src);
      }
    } catch {}
  }
  if (Object.keys(c.tickers).length) console.log(`· 已从 data/*-quotes.json 回填 ${Object.keys(c.tickers).length} 只标的的缓存`);
  return c;
}

/* ── 本期参数 ── */
const issueId = (process.argv[2] || "001").padStart(3, "0");
const issue = JSON.parse(readFileSync(join(ROOT, "issues", `${issueId}.json`), "utf8"));

// 默认区间：上一个自然月（本期是 2026.11 → 取 2026.10.01 ~ 2026.11.01）
function lastMonth(dateStr) {
  const [y, m] = String(dateStr || "2026.11").split(".").map(Number);
  const s = new Date(Date.UTC(y, m - 2, 1));
  const e = new Date(Date.UTC(y, m - 1, 1));
  const f = (x) => x.toISOString().slice(0, 10).replace(/-/g, "");
  return [f(s), f(e)];
}
const [d0, d1] = process.argv[3]
  ? [process.argv[3].replace(/-/g, ""), (process.argv[4] || "").replace(/-/g, "") || "20500101"]
  : lastMonth(issue.date);

const fromIso = isoOf(d0);
const todayIso = new Date().toISOString().slice(0, 10);
const toIso = isoOf(d1) > todayIso ? todayIso : isoOf(d1); // 结束日填到未来时按今天算
// 多往前留一段，区间第一天的「当日涨跌」要用前一个交易日的收盘价
const neededFrom = shift(fromIso, -12);

/* ── 增量拉取 ── */
const cache = loadCache();
let emDown = false; // 东财一旦连不上，本次运行内不再回头试
const held = issue.holdings || [];

for (const h of held) {
  const t = (cache.tickers[h.ticker] ||= { points: {}, sources: [] });
  const cachedDates = Object.keys(t.points);
  const lastCached = cachedDates.sort().at(-1) || null;
  const fetchFrom = lastCached ? shift(lastCached, 1) : neededFrom;

  if (fetchFrom > toIso) {
    console.log(`✓ ${h.ticker.padEnd(6)} 缓存已到 ${lastCached}，无需请求`);
    continue;
  }

  let pts = null;
  let src = null;
  if (!emDown) {
    try {
      pts = await fromEastmoney(h.ticker, fetchFrom, toIso);
      src = "东方财富";
    } catch (e) {
      emDown = true;
      console.warn(`! 东方财富不可达（${e.message}），本次改用 Nasdaq`);
    }
  }
  if (!pts) {
    try {
      pts = await fromNasdaq(h.ticker, fetchFrom, toIso);
      src = "Nasdaq";
    } catch (e) {
      console.error(`✗ ${h.ticker} Nasdaq 也失败：${e.message}`);
      continue;
    }
  }

  // 只补缓存里没有的日期；已有日期保持原值，历史不因换源而漂移
  let added = 0;
  for (const p of pts) {
    if (p.d >= fetchFrom && p.d <= toIso && t.points[p.d] == null) {
      t.points[p.d] = p.c;
      added++;
    }
  }
  if (added && !t.sources.includes(src)) t.sources.push(src);
  console.log(
    `✓ ${h.ticker.padEnd(6)} 新增 ${String(added).padStart(2)} 天（${src}，${fetchFrom} → ${toIso}）` +
      `，缓存共 ${Object.keys(t.points).length} 天`,
  );
}

cache.updatedAt = new Date().toISOString();
mkdirSync(DATA, { recursive: true });
writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1) + "\n");

/* ── 从缓存切片，组装本期行情 ── */
const series = [];
for (const h of held) {
  const t = cache.tickers[h.ticker];
  const all = Object.entries(t?.points || {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const points = all.filter(([d]) => d >= fromIso && d <= toIso).map(([d, c]) => ({ d, c }));
  const prevDate = all.filter(([d]) => d < fromIso).at(-1);
  if (!points.length) {
    console.error(`✗ ${h.ticker} 在 ${fromIso} → ${toIso} 区间内没有数据`);
    continue;
  }
  series.push({
    ticker: h.ticker,
    name: h.name,
    secid: secid(h.ticker),
    prev: prevDate ? { d: prevDate[0], c: prevDate[1] } : null,
    points,
    sources: t.sources,
  });
}

// 三只不齐全就不覆盖旧文件：宁可留旧数据，也不写缺一条腿的行情
if (series.length < held.length) {
  console.error(`\n✗ 只有 ${series.length}/${held.length} 只有数据，未写入（旧数据保留）。网络恢复后重跑即可。`);
  process.exit(1);
}

// 只保留三只都有报价的交易日，避免某只停牌把线画歪
const common = series
  .map((r) => r.points.map((p) => p.d))
  .reduce((acc, ds) => acc.filter((d) => ds.includes(d)));
for (const r of series) r.points = r.points.filter((p) => common.includes(p.d));

const allSources = [...new Set(series.flatMap((r) => r.sources))];
const out = {
  from: common[0] || null,
  to: common.at(-1) || null,
  fetchedAt: new Date().toISOString(),
  source: allSources.join(" + ") || "东方财富",
  series: series.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    secid: r.secid,
    prev: r.prev,
    points: r.points,
  })),
};

const file = join(DATA, `${issueId}-quotes.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\n✓ ${file}`);
console.log(`  区间 ${out.from} → ${out.to}，${common.length} 个交易日 · 数据来源 ${out.source}`);
