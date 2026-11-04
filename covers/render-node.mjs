/**
 * render-node.mjs — 无浏览器渲染管线
 *
 *   HTML 字符串 → ultrahtml 解析 + <style> 内联 → 规范化（satori 兼容层）
 *   → satori 排版成 SVG → resvg 按 2 倍栅格化成 PNG
 *
 * 内嵌 <svg>（走势图）单独用 resvg 先栅格化成 2x PNG，再以 <img> 嵌回版式。
 * 字体：assets/fonts/ 下 Noto Serif SC / Noto Sans SC 的静态字重实例（缺了跑 fetch-fonts.mjs）。
 *
 * satori 兼容层要点（normalizeStyle / fontFamilyOf 里处理）：
 *   - 只支持 flex 布局；em 字号不跟随父级（按父级换算成 px）；fontWeight 必须是数字
 *   - 无逐字字体回退，整段文本只能指定一个字体 → 模板字体栈统一映射到 Noto 二选一
 *   - 可变字体字重实例化有 bug → 预切静态字重文件，按 weight 精确匹配
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parse as parseHtml,
  walkSync,
  ELEMENT_NODE,
  TEXT_NODE,
} from "ultrahtml";
import inlineCSS from "ultrahtml/transformers/inline";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { Jimp } from "jimp";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(ROOT, "assets", "fonts");
const SERIF = "Noto Serif SC";
const SANS = "Noto Sans SC";
// 模板里用到的全部字重
const WEIGHTS = [400, 500, 600, 700, 900];
const FONT_FILE = (name, w) => join(FONT_DIR, `${name === SERIF ? "NotoSerifSC" : "NotoSansSC"}-${w}.ttf`);
// 全部静态实例路径（resvg 的 fontFiles 也用这份清单）
const FONT_FILES = WEIGHTS.flatMap((w) => [FONT_FILE(SERIF, w), FONT_FILE(SANS, w)]);

// satori 对可变字体的字重实例化有 bug（部分字重静默回落默认实例），
// 所以不用可变字体，直接用 fontTools 预生成的静态字重文件
let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;
  const missing = FONT_FILES.filter((p) => !existsSync(p));
  if (missing.length) {
    throw new Error(`缺少字体文件（${missing.length} 个），先运行 node fetch-fonts.mjs`);
  }
  _fonts = WEIGHTS.flatMap((weight) => [
    { name: SERIF, data: readFileSync(FONT_FILE(SERIF, weight)), weight, style: "normal" },
    { name: SANS, data: readFileSync(FONT_FILE(SANS, weight)), weight, style: "normal" },
  ]);
  return _fonts;
}

/* ── CSS 规范化：把浏览器 CSS 翻译成 satori 能吃的子集 ── */

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// satori 不认识、直接丢掉的属性
const DROP_PROPS = new Set([
  "fontVariantNumeric",
  "webkitFontSmoothing",
  "mixBlendMode",
  "pointerEvents",
  "transition",
  "boxShadow",
  "textShadow",
]);

// font-family 字体栈 → 本地 Noto 二选一。satori 不支持逐字回退，只能整段指定。
// 注意先判 sans："sans-serif" 里含 "serif"，顺序反了会把无衬线误判成衬线
const fontFamilyOf = (v) =>
  /sans|-apple-system|pingfang|helvetica|inter|din alternate/i.test(v)
    ? SANS
    : /serif|georgia|songti/i.test(v)
      ? SERIF
      : SANS;

// inset 简写展开（1~4 值语法，同 margin）
function expandInset(v) {
  const p = String(v).trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = p;
  return { top: t, right: r, bottom: b, left: l };
}

/**
 * style 对象 → satori style。
 * ctx.parentFontSize 用于把 font-size 的 em 换算成 px（satori 的 em 不跟随父级字号）。
 */
function normalizeStyle(raw, ctx) {
  const out = {};
  for (const [k0, v0] of Object.entries(raw || {})) {
    const k = camel(k0);
    const v = v0;
    if (DROP_PROPS.has(k)) continue;
    switch (k) {
      case "fontFamily":
        out.fontFamily = fontFamilyOf(v);
        break;
      case "fontSize": {
        const m = /^([\d.]+)em$/.exec(String(v).trim());
        out.fontSize = m ? Math.round(ctx.parentFontSize * parseFloat(m[1]) * 100) / 100 : v;
        break;
      }
      case "fontWeight":
        // satori 按数字匹配可变字体实例，字符串 "900" 匹配不上会退回 400
        out.fontWeight = /^\d+$/.test(String(v).trim()) ? Number(v) : v;
        break;
      case "inset":
        Object.assign(out, expandInset(v));
        break;
      case "width":
      case "maxWidth":
        // kicker 靠 min-content 让 border-top 只盖住文字宽；
        // satori 没有这个值，换成 flex 容器里的 align-self:flex-start，视觉效果相同
        if (String(v).trim() === "min-content") {
          out.alignSelf = "flex-start";
        } else out[k] = v;
        break;
      case "visibility":
        // 占位元素（ghost）用透明代替，保持布局
        if (String(v).trim() === "hidden") out.opacity = 0;
        break;
      default:
        out[k] = v;
    }
  }
  return out;
}

/* ── HTML AST → satori vdom ── */

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");

// SVG 属性名在 HTML 解析时会被小写化，栅格化前恢复
const SVG_ATTR_CASE = { viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio" };

function serializeSvg(node) {
  if (node.type === TEXT_NODE) return decodeEntities(node.value);
  if (node.type !== ELEMENT_NODE) return "";
  const tag = node.name;
  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => {
      if (k === "style" && v && typeof v === "object") {
        const st = normalizeStyle(v, { parentFontSize: 16 });
        const css = Object.entries(st)
          .map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${sv}`)
          .join(";");
        return `style="${css}"`;
      }
      return `${SVG_ATTR_CASE[k] || k}="${String(v).replace(/"/g, "&quot;")}"`;
    })
    .join(" ");
  const kids = (node.children || []).map(serializeSvg).join("");
  return `<${tag}${attrs ? " " + attrs : ""}>${kids}</${tag}>`;
}

// 走势图等内嵌 svg → 2x PNG data URI 的 img 节点
function svgToImgNode(node, style) {
  let svg = serializeSvg(node);
  if (!/xmlns=/.test(svg)) svg = svg.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
  const w = Number(node.attributes.width) || 900;
  const h = Number(node.attributes.height) || 560;
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(w * 2) },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();
  return {
    type: "img",
    props: {
      src: `data:image/png;base64,${png.toString("base64")}`,
      style: { ...style, width: w, height: h },
    },
  };
}

function toVdom(node, ctx) {
  if (node.type === TEXT_NODE) return decodeEntities(node.value);
  if (node.type !== ELEMENT_NODE || !node.name) return null;

  const tag = node.name.toLowerCase();
  const style = normalizeStyle(
    typeof node.attributes.style === "object" ? node.attributes.style : {},
    ctx,
  );
  if (style.display === "none") return null;
  if (tag === "svg") return svgToImgNode(node, style);
  if (tag === "br") return "\n";

  const fontSize =
    typeof style.fontSize === "number"
      ? style.fontSize
      : parseFloat(style.fontSize) || ctx.parentFontSize;
  const childCtx = { parentFontSize: fontSize };

  const children = (node.children || [])
    .map((c) => toVdom(c, childCtx))
    .filter((c) => c != null && !(typeof c === "string" && c.trim() === "" && c !== "　"));

  if (tag === "img") {
    return {
      type: "img",
      props: { src: node.attributes.src, alt: node.attributes.alt || "", style },
    };
  }
  // body 作为根容器：交给外层包，这里统一转成 div
  const type = tag === "body" || tag === "html" ? "div" : tag;
  return { type, props: { style, children } };
}

/**
 * 主题 HTML 文档 → PNG Buffer（2 倍分辨率）
 * @param html   base() 拼出来的完整 HTML 文档
 * @param width  逻辑宽（CSS px）
 * @param height 逻辑高
 * @param scale  导出倍率，默认 2
 */
export async function htmlToPng(html, width, height, scale = 2) {
  const doc = parseHtml(html);
  inlineCSS({ useObjectSyntax: true })(doc);

  let bodyStyle = {};
  let bodyChildren = [];
  walkSync(doc, (node) => {
    if (node.type === ELEMENT_NODE && node.name && node.name.toLowerCase() === "body") {
      bodyStyle = normalizeStyle(
        typeof node.attributes.style === "object" ? node.attributes.style : {},
        { parentFontSize: 16 },
      );
      const ctx = { parentFontSize: parseFloat(bodyStyle.fontSize) || 16 };
      bodyChildren = (node.children || [])
        .map((c) => toVdom(c, ctx))
        .filter((c) => c != null && !(typeof c === "string" && c.trim() === ""));
    }
  });

  const vdom = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width,
        height,
        overflow: "hidden",
        position: "relative",
        ...bodyStyle,
      },
      children: bodyChildren,
    },
  };

  const svg = await satori(vdom, { width, height, fonts: loadFonts() });
  return new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width * scale) },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false },
  })
    .render()
    .asPng();
}

/** PNG → JPEG（gallery 预览图用，替代 macOS 的 sips） */
export async function pngToJpeg(pngPath, jpgPath, quality = 92) {
  const img = await Jimp.read(pngPath);
  const buf = await img.getBuffer("image/jpeg", { quality });
  writeFileSync(jpgPath, buf);
}
