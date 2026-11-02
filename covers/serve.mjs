#!/usr/bin/env node
/**
 * 封面热更服务器
 *   node serve.mjs [port]
 * 改 issues/*.json 或 build.mjs 后自动重新渲染，浏览器自动刷新。
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { watch, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
let PORT = Number(process.argv[2]) || 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
};

const RELOAD_SCRIPT = `<script>
  (() => {
    const es = new EventSource('/__reload');
    es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
    es.onerror = () => setTimeout(() => location.reload(), 3000);
  })();
</script>`;

let clients = new Set();
let buildLog = [];

const stamp = () => new Date().toTimeString().slice(0, 8);

function broadcast() {
  for (const res of clients) {
    try {
      res.write("data: reload\n\n");
    } catch {}
  }
}

function runBuild(id) {
  return new Promise((resolve) => {
    execFile("node", ["build.mjs", id], { cwd: ROOT }, (err, stdout) => {
      const lines = String(stdout).trim().split("\n").filter(Boolean);
      for (const l of lines) console.log(`  ${stamp()}  ${l}`);
      if (err) console.error(`  ${stamp()}  构建失败：${err.message}`);
      buildLog.push({ t: stamp(), id, ok: !err, out: lines.join("\n") });
      if (buildLog.length > 20) buildLog.shift();
      resolve();
    });
  });
}

// ── 防抖 + 串行构建 ──
const pending = new Set();
let building = false;
let timer = null;

function schedule(id) {
  pending.add(id);
  clearTimeout(timer);
  timer = setTimeout(drain, 250);
}

async function drain() {
  if (building || !pending.size) return;
  building = true;
  while (pending.size) {
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      console.log(`↻ ${stamp()} 重新渲染 ${id}`);
      await runBuild(id);
    }
    broadcast();
  }
  building = false;
}

const issueIds = () =>
  existsSync(join(ROOT, "issues"))
    ? readdirSync(join(ROOT, "issues"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "").padStart(3, "0"))
    : [];

// ── HTTP ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === "/__status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ issues: issueIds(), builds: buildLog }));
    return;
  }

  let rel = url.pathname === "/" ? "gallery.html" : decodeURIComponent(url.pathname).slice(1);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    let body = await readFile(file);
    const ext = extname(file);
    if (ext === ".html") {
      body = Buffer.from(
        String(body).replace("</body>", `${RELOAD_SCRIPT}</body>`),
        "utf8",
      );
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`端口 ${PORT} 被占用，换 ${PORT + 1}`);
    PORT += 1;
    server.listen(PORT, "127.0.0.1");
  } else throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  封面热更服务器`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  监听 issues/*.json 与 build.mjs，保存即重新渲染并刷新页面`);
  console.log(`  Ctrl+C 退出\n`);

  watch(join(ROOT, "issues"), (_e, f) => {
    if (f && f.endsWith(".json")) schedule(f.replace(/\.json$/, "").padStart(3, "0"));
  });
  // 行情数据：node fetch-quotes.mjs 写完 data/*.json 后自动重画
  if (existsSync(join(ROOT, "data"))) {
    watch(join(ROOT, "data"), (_e, f) => {
      if (f && f.endsWith(".json")) schedule(f.replace(/-quotes\.json$/, "").padStart(3, "0"));
    });
  }
  // 监听目录而不是单个文件：编辑器/脚本覆写 build.mjs 时 inode 会变，文件级 watch 会失效
  let bt = null;
  watch(ROOT, (_e, f) => {
    if (f !== "build.mjs") return;
    clearTimeout(bt);
    bt = setTimeout(() => issueIds().forEach(schedule), 300);
  });
});
