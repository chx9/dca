#!/usr/bin/env node
/**
 * 拉行情：三只标的的日线收盘价，写进 data/<期号>-quotes.json，供 build.mjs 画走势图。
 *
 * 用法：
 *   node fetch-quotes.mjs 001                    # 默认取「上一个自然月」
 *   node fetch-quotes.mjs 001 2026-10-01 2026-11-01
 *
 * 数据源：东方财富 push2his 的日 K 接口（境内可直连，免费、无需 key）。
 *   105 = 纳斯达克  106 = 纽交所  107 = NYSE Arca
 * 只取收盘价，不做前复权以外的任何加工；涨跌幅在 build.mjs 里按区间首日收盘归一。
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const ROOT = dirname(fileURLToPath(import.meta.url));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36";

// 东方财富的美股市场编号；加新标的时在这里补一行
const MARKET = { IQQ: 105, "BRK.B": 106, SCHD: 107 };
const secid = (t) => `${MARKET[t.toUpperCase()] ?? 105}.${String(t).replace(/\./g, "_")}`;

const get = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" } }, (r) => {
        let s = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (s += c));
        r.on("end", () => resolve(s));
      })
      .on("error", reject);
  });

// 网络抖动/限流时重试，仍失败就抛错（这只标的记为缺失，不拿别的源顶替）
const getRetry = async (url, tries = 3) => {
  for (let i = 0; ; i++) {
    try {
      return await get(url);
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
};

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

const isoOf = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const shift = (s, n) => {
  const d = new Date(`${isoOf(s)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};
// 多往前抓一段，用来算区间第一天的「当日涨跌」（需要前一个交易日的收盘价）
const fromIso = isoOf(d0);
const beg = shift(d0, -12);

const rows = [];
for (const h of issue.holdings || []) {
  const id = secid(h.ticker);
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}` +
    `&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&beg=${beg}&end=${d1}`;
  let raw = null;
  try {
    raw = await getRetry(url);
  } catch (e) {
    console.error(`✗ ${h.ticker} (${id}) 网络错误：${e.message}`);
    continue;
  }
  let data = null;
  try {
    data = JSON.parse(raw).data;
  } catch {
    data = null;
  }
  const klines = data?.klines || [];
  if (!klines.length) {
    console.error(`✗ ${h.ticker} (${id}) 没有取到行情`);
    continue;
  }
  const points = klines.map((k) => {
    const [d, c] = k.split(",");
    return { d, c: Number(c) };
  });
  rows.push({ ticker: h.ticker, name: h.name, secid: id, points });
  console.log(
    `✓ ${h.ticker.padEnd(6)} ${points.length} 根日线  ${points[0].d} ${points[0].c} → ${points.at(-1).d} ${points.at(-1).c}`,
  );
}

// 任何一只没拿到都不覆盖旧文件：宁可留旧数据，也不写缺一条腿的行情
const want = (issue.holdings || []).length;
if (rows.length < want) {
  console.error(`\n✗ 只拿到 ${rows.length}/${want} 只，未写入（旧数据保留）。网络恢复后重跑即可。`);
  process.exit(1);
}

// 区间第一天的「当日涨跌」要拿它前一个交易日的收盘价；抓不到就记为 null，不补
for (const r of rows) {
  r.prev = r.points.filter((p) => p.d < fromIso).at(-1) || null;
  r.points = r.points.filter((p) => p.d >= fromIso);
}

// 只保留三只都有报价的交易日，避免某只停牌把线画歪
const common = rows.length
  ? rows
      .map((r) => r.points.map((p) => p.d))
      .reduce((acc, ds) => acc.filter((d) => ds.includes(d)))
  : [];
for (const r of rows) r.points = r.points.filter((p) => common.includes(p.d));

const out = {
  from: common[0] || null,
  to: common.at(-1) || null,
  fetchedAt: new Date().toISOString(),
  source: "东方财富 push2his · 日 K 收盘价",
  series: rows.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    secid: r.secid,
    prev: r.prev,
    points: r.points,
  })),
};

if (!existsSync(join(ROOT, "data"))) mkdirSync(join(ROOT, "data"));
const file = join(ROOT, "data", `${issueId}-quotes.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\n✓ ${file}`);
console.log(`  区间 ${out.from} → ${out.to}，${common.length} 个交易日`);
