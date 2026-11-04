#!/usr/bin/env node
/**
 * fetch-fonts.mjs — 准备渲染用字体（新机器只需跑一次）
 *
 *   node fetch-fonts.mjs           # 缺啥补啥
 *   node fetch-fonts.mjs --force   # 全部重新下载 / 重新切
 *
 * 两步：
 *   1. 下载 Noto Serif SC / Noto Sans SC 可变字体（google/fonts 仓库，
 *      国内走 ghfast.top 代理，海外自动回落直连）
 *   2. 用 Python fontTools 的 varLib.instancer 把 400/500/600/700/900
 *      五个字重各切一份静态 TTF 到 assets/fonts/
 *
 * 为什么不直接渲染可变字体：satori 对可变字体的字重实例化有 bug
 * （部分字重静默回落默认实例，900 渲染成 400），所以预切静态实例。
 *
 * 依赖：Python 3 + fontTools（pip install fontTools）
 */
import { existsSync, mkdirSync, writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(ROOT, "assets", "fonts");
const WEIGHTS = [400, 500, 600, 700, 900];
const FORCE = process.argv.includes("--force");

const FAMILIES = [
  { key: "NotoSerifSC", ofl: "notoserifsc/NotoSerifSC%5Bwght%5D.ttf" },
  { key: "NotoSansSC", ofl: "notosanssc/NotoSansSC%5Bwght%5D.ttf" },
];

// 挨个试，第一个能下完的赢。ghfast.top 是 GitHub 反代，国内可用
const SOURCES = [
  (ofl) => `https://ghfast.top/https://raw.githubusercontent.com/google/fonts/main/ofl/${ofl}`,
  (ofl) => `https://raw.githubusercontent.com/google/fonts/main/ofl/${ofl}`,
];

// TTF 魔数：0x00010000（TrueType）或 'OTTO'（CFF）
function looksLikeFont(buf) {
  if (buf.length < 1024 * 1024) return false; // 全量 CJK 字体至少几 MB，几百 KB 的都是子集残件
  const b0 = buf[0], b1 = buf[1], b2 = buf[2], b3 = buf[3];
  return (
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f)
  );
}

// 已存在文件的快速校验：看大小和文件头 4 字节魔数
function looksLikeFontFile(p) {
  if (statSync(p).size < 1024 * 1024) return false;
  const fd = openSync(p, "r");
  const b = Buffer.alloc(4);
  readSync(fd, b, 0, 4, 0);
  closeSync(fd);
  return (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) ||
    b.toString("latin1") === "OTTO";
}

async function download(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000); // 大文件，放宽到 2 分钟
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Wget/1.0" }, // 有些 CDN 按 UA 给不同格式
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVF(family) {
  const vfPath = join(FONT_DIR, `${family.key}-VF.ttf`);
  if (!FORCE && existsSync(vfPath) && looksLikeFontFile(vfPath)) {
    console.log(`= ${family.key}-VF.ttf 已存在，跳过下载`);
    return vfPath;
  }
  let lastErr;
  for (const makeUrl of SOURCES) {
    const url = makeUrl(family.ofl);
    try {
      console.log(`↓ ${url}`);
      const buf = await download(url);
      if (!looksLikeFont(buf)) throw new Error(`文件不对（${buf.length} 字节，不是完整 TTF）`);
      writeFileSync(vfPath, buf);
      console.log(`✓ ${family.key}-VF.ttf（${(buf.length / 1048576).toFixed(1)} MB）`);
      return vfPath;
    } catch (e) {
      lastErr = e;
      console.log(`  失败：${e.message}，换下一个源`);
    }
  }
  throw new Error(`${family.key} 可变字体下载失败：${lastErr.message}`);
}

function findPython() {
  for (const cmd of ["python", "py", "python3"]) {
    try {
      execFileSync(cmd, ["-c", "import fontTools"], { stdio: "ignore" });
      return cmd;
    } catch {}
  }
  throw new Error(
    "找不到带 fontTools 的 Python。先装 Python 3，再 pip install fontTools",
  );
}

function instance(py, vfPath, family) {
  for (const w of WEIGHTS) {
    const out = join(FONT_DIR, `${family.key}-${w}.ttf`);
    if (!FORCE && existsSync(out)) {
      console.log(`= ${family.key}-${w}.ttf 已存在，跳过`);
      continue;
    }
    execFileSync(py, ["-m", "fontTools.varLib.instancer", vfPath, `wght=${w}`, "-o", out], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`✓ ${family.key}-${w}.ttf`);
  }
}

const main = async () => {
  if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });
  const py = findPython();
  for (const family of FAMILIES) {
    const vfPath = await fetchVF(family);
    instance(py, vfPath, family);
  }
  console.log("\n字体就绪，可以 node build.mjs 了");
};

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
