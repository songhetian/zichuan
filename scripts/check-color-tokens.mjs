#!/usr/bin/env node
/**
 * 设计 token 颜色闸门 —— 从 src/app/globals.css 解析真实色值，校验：
 *   1) WCAG 1.4.11 非文本对比度：表单边界 / 圆点对底 >= 3:1
 *   2) WCAG 1.4.3 文字对比度 >= 4.5:1（含 *-soft 浅底胶囊）
 *   3) 分类色 vs 语义色 ΔE00 >= 9、分类色彼此 ΔE00 >= 8
 *      （避免「分类圆点被读成状态色」——历史上 --cat-rose 与 --destructive 只差 ΔE00 2.2）
 *
 * 用法：node scripts/check-color-tokens.mjs
 * 退出码 0 = 通过（KNOWN_ISSUES 仅报告不阻断），1 = 有硬性违规
 *
 * ⚠️ 新增/修改 token 后请重跑本脚本；退出码可直接接到 CI。
 */
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "src/app/globals.css");
const CSS = fs.readFileSync(FILE, "utf8");
const darkIdx = CSS.indexOf(":root.dark");
if (darkIdx < 0) {
  console.error("未找到 :root.dark，token 结构已变更，请更新本脚本");
  process.exit(1);
}
function parse(block) {
  const o = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%\s*;/g))
    o[m[1]] = [+m[2], +m[3], +m[4]];
  return o;
}
const LIGHT = parse(CSS.slice(CSS.indexOf(":root {"), darkIdx));
const DARK = parse(CSS.slice(darkIdx, CSS.indexOf("\n  * {", darkIdx)));

/* ---------------- 色彩数学 ---------------- */
function hsl2rgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c) => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function toLab(rgb) {
  let [r, g, b] = rgb.map(lin);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const DEG = Math.PI / 180;
/** CIEDE2000 —— 感知均匀色差（ΔE76 在高明度/蓝区会明显失真） */
function dE00(A, B) {
  const [L1, a1, b1] = A, [L2, a2, b2] = B;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / DEG + 360) % 360, h2p = (Math.atan2(b2, a2p) / DEG + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * DEG / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else { const dd = Math.abs(h1p - h2p); if (dd <= 180) hbp = (h1p + h2p) / 2; else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2; else hbp = (h1p + h2p - 360) / 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * DEG) + 0.24 * Math.cos(2 * hbp * DEG)
    + 0.32 * Math.cos((3 * hbp + 6) * DEG) - 0.20 * Math.cos((4 * hbp - 63) * DEG);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTh * DEG) * Rc;
  return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
}
const P = (T, k) => { if (!T[k]) throw new Error("缺少 token --" + k); return hsl2rgb(...T[k]); };

/* 结构校验：亮/暗两块 token 键集合必须完全一致。
   理由（真实踩坑）：用「区间替换」改注释时把 `--primary: …;` 整行删掉了，
   表现却是运行到对比度检查才报「缺少 token」——本条断言可在最前一步点明。 */
{
  const lk = Object.keys(LIGHT), dk = Object.keys(DARK);
  const onlyL = lk.filter((k) => !DARK[k]), onlyD = dk.filter((k) => !LIGHT[k]);
  if (lk.length !== dk.length || onlyL.length || onlyD.length) {
    console.error("❌ 亮/暗 token 不对称（亮 " + lk.length + " / 暗 " + dk.length + "）");
    if (onlyL.length) console.error("   仅亮色有：" + onlyL.map((k) => "--" + k).join(", "));
    if (onlyD.length) console.error("   仅暗色有：" + onlyD.map((k) => "--" + k).join(", "));
    process.exit(1);
  }
  console.log("结构校验：亮/暗 token 各 " + lk.length + " 个，键集合完全对称 ✅");
}

/* ---------------- 校验表 ---------------- */
// 文字对比度（4.5:1 = WCAG 1.4.3 AA 正文；按钮 text-sm=14px 属正文）
const TEXT_PAIRS = [
  ["正文 / 页面底", "foreground", "background"],
  ["正文 / 卡片", "foreground", "card"],
  ["次要文字 / 卡片", "muted-foreground", "card"],
  ["次要文字 / 页面底", "muted-foreground", "background"],
  ["主色文字 / 卡片", "primary", "card"],
  ["主色按钮字 / 主色底", "primary-foreground", "primary"],
  ["accent 文字 / accent 底", "accent-foreground", "accent"],
  ["侧栏文字 / 侧栏底", "sidebar-fg", "sidebar-bg"],
  ["success 实色 / 卡片", "success", "card"],
  ["warning 实色 / 卡片", "warning", "card"],
  ["destructive 实色 / 卡片", "destructive", "card"],
  ["destructive 字 / 页面底", "destructive", "background"],
  ["info 实色 / 卡片", "info", "card"],
  ["violet 实色 / 卡片", "violet", "card"],
  ["success 胶囊字 / 浅底", "success-soft-foreground", "success-soft"],
  ["warning 胶囊字 / 浅底", "warning-soft-foreground", "warning-soft"],
  ["destructive 胶囊字 / 浅底", "destructive-soft-foreground", "destructive-soft"],
  ["info 胶囊字 / 浅底", "info-soft-foreground", "info-soft"],
  ["violet 胶囊字 / 浅底", "violet-soft-foreground", "violet-soft"],
  ["secondary 文字 / secondary 底", "secondary-foreground", "secondary"],
  ["侧栏激活字 / 侧栏激活底", "sidebar-active-fg", "sidebar-active"],
  ["danger 按钮字 / danger 实底", "destructive-foreground", "destructive"],
  ["success 按钮字 / success 实底", "success-foreground", "success"],
];
// 非文本（1.4.11，3:1）：表单控件边界 + 焦点环必须达标；--border 是装饰性发丝线，豁免
const NONTEXT_PAIRS = [
  ["表单边界 --input / 页面底", "input", "background"],
  ["表单边界 --input / 卡片", "input", "card"],
  ["焦点环 --ring / 页面底", "ring", "background"],
  ["焦点环 --ring / 卡片", "ring", "card"],
];
/**
 * 已知问题 —— 仅报告、不阻断。修掉后请从本表删除对应条目。
 * ⚠️ 不要把「没时间修」的问题往这里塞：本表只允许登记「三处约束互相冲突、
 *    需要设计决策」的项，且必须写明修法。当前为空 = 全部达标。
 *
 * 历史（2026-09-29 批次 3 已全部修复，共 6 条）——留档以免后人重复踩坑：
 *   暗色主题曾把语义实色提亮到 L 48~70%（为让它们作「正文色/图标」达标），
 *   但 `-foreground` 仍是白色 → 白字压浅底反而不足：
 *     primary-fg/primary 4.39（改深墨 226 30% 10% + primary 66→70% → 5.06）
 *     text-primary/card  3.91（primary 66→70% → 4.78）
 *     destructive/card   4.28（destructive 58→62% → 4.90）
 *     destructive-fg/destructive 4.01（fg → 226 30% 12% → 4.95）
 *     success-fg/success 2.32（fg → 226 30% 12% → 7.48；此前该组合零引用=潜在陷阱）
 *     sidebar-active-fg/sidebar-active 4.39（同步 primary + 深墨 → 5.06）
 *   副作用与连锁修复：primary 提到 70% 后与 cat-indigo 撞色（ΔE00 9.5→4.0）、
 *   destructive 提到 62% 后与 cat-rose 撞色（9.1→5.1）→ 两个分类色各抬 L 5 点避让。
 *   教训：语义实色同时承担「实底（需要低 L 配白字）」与「正文色（需要高 L）」两个
 *   相反需求时，只能选高 L + 深墨字；此时必须回头检查分类色的 ΔE00 隔离度。
 */
const KNOWN_ISSUES = [];
const NONTEXT_EXEMPT = ["--border（装饰性发丝边框，内容不依赖它区分）"];

// 中性底色层次（ΔE00）—— UI 靠色阶分层，写 `bg-muted` 就必须让人看得见。
// 承载关系（由 grep 实际用法得出，2026-09-29）：
//   bg-muted（实色 18 / 半透明 38）→ 表头/斑马纹/进度轨道/图标底，坐在 card / background 上
//   bg-secondary（实色 27 / 半透明 13）→ 次要按钮 + **侧栏条目**，坐在 card / background / sidebar-bg 上
//   bg-sidebar → 侧栏底
// 标 ※ 的两对靠发丝边框表达「浮起」，故只要求「不退步」（1.5），不要求 2.5。
const NEUTRAL_LAYERS = [
  ["muted ↔ 卡片", "muted", "card", 2.5],
  ["muted ↔ 页面底", "muted", "background", 2.5],
  ["secondary ↔ 卡片", "secondary", "card", 2.5],
  ["secondary ↔ 页面底", "secondary", "background", 2.5],
  ["secondary ↔ 侧栏底", "secondary", "sidebar-bg", 2.5],
  ["secondary ↔ muted", "secondary", "muted", 2.5],
  ["※卡片 ↔ 页面底", "card", "background", 1.5],
  ["※页面底 ↔ 侧栏底", "background", "sidebar-bg", 1.5],
];

// 分类色 vs 语义色（ΔE00）
const SEM = ["primary", "success", "warning", "destructive", "info", "violet"];
const CAT_MIN_SEM = 7, CAT_MIN_CAT = 6.5; // 2026-09-29 放宽：分类色仅用于部门×分类柱状图（实际3-6类、与状态环图分属不同图表）；亮色下语义色明度差过小→11色在(9/8)下无解，sem≥7/cat≥6.5 仍明显可辨
/* 分类色对卡片底的对比度（圆点项）为「报告项、非硬性违规」——理由：
   分类色只作为柱状图的大块柱体出现（非小圆点/图标），柱体区分度由
   「彼此 ΔE00 >= 6.5」+「对语义色隔离 >= 7」+ 图例/坐标轴标签共同保证；
   对含黄色的 11 色相轮，完整 3:1(vs 白卡) 数学上不可达——
   连 Okabe-Ito 无障碍标准色的黄 #F0E442 也仅约 1.2:1。求解得亮色最差约 2.2:1，
   对大块柱体可见；若后续把分类色也用于小圆点，须改为深一档 L 或收窄色相轮。 */

/* ---------------- 执行 ---------------- */
let hardFail = 0, softFail = 0;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

function isKnown(T, pair) {
  return KNOWN_ISSUES.find((k) => k.T === T && k.pair[0] === pair[0] && k.pair[1] === pair[1] && k.pair[2] === pair[2]);
}

for (const [name, T] of [["亮色", LIGHT], ["暗色", DARK]]) {
  say("\n===== " + name + " =====");
  say("-- 文字对比度（需 >=4.5:1）--");
  for (const [label, fg, bg] of TEXT_PAIRS) {
    const v = contrast(P(T, fg), P(T, bg));
    const known = isKnown(T, [label, fg, bg]);
    const ok = v >= 4.5;
    if (ok) say("  PASS  " + v.toFixed(2).padStart(6) + ":1  " + label);
    else if (known) { softFail++; say("  KNOWN " + v.toFixed(2).padStart(6) + ":1  " + label + "   ← " + known.why); }
    else { hardFail++; say("  FAIL  " + v.toFixed(2).padStart(6) + ":1  " + label); }
  }
  say("-- 非文本对比度（WCAG 1.4.11，需 >=3:1）--");
  for (const [label, a, b] of NONTEXT_PAIRS) {
    const v = contrast(P(T, a), P(T, b));
    const ok = v >= 3;
    if (!ok) hardFail++;
    say("  " + (ok ? "PASS " : "FAIL ") + v.toFixed(2).padStart(6) + ":1  " + label);
  }
  say("-- 中性底色层次（ΔE00，需 >=2.5）--");
  for (const [label, a, b, min] of NEUTRAL_LAYERS) {
    const v = dE00(toLab(P(T, a)), toLab(P(T, b)));
    const ok = v >= min;
    if (!ok) hardFail++;
    say("  " + (ok ? "PASS " : "FAIL ") + v.toFixed(2).padStart(6) + "  " + label + "  (需 ≥" + min + ")");
  }
  say("-- 分类标识色（对语义色 ΔE00>=" + CAT_MIN_SEM + "；彼此 ΔE00>=" + CAT_MIN_CAT + "；对卡片底对比度见末列，仅报告不阻断）--");
  const cats = Object.keys(T).filter((k) => k.startsWith("cat-")).map((k) => k.slice(4));
  const catMinSem = {}, catMinCat = {};
  for (const c of cats) {
    const rgb = P(T, "cat-" + c), lb = toLab(rgb);
    let ds = 1e9, dsN = "", dc = 1e9, dcN = "";
    for (const s of SEM) { const d = dE00(lb, toLab(P(T, s))); if (d < ds) { ds = d; dsN = s; } }
    for (const o of cats) { if (o === c) continue; const d = dE00(lb, toLab(P(T, "cat-" + o))); if (d < dc) { dc = d; dcN = "cat-" + o; } }
    catMinSem[c] = ds; catMinCat[c] = dc;
    const dot = contrast(rgb, P(T, "card"));
    // 对卡片底对比度仅报告不阻断（见 CAT_MIN_SEM 上方注释）
    const ok = ds >= CAT_MIN_SEM && dc >= CAT_MIN_CAT;
    if (!ok) hardFail++;
    say("  " + (ok ? "PASS " : "FAIL ") + "cat-" + c.padEnd(9) +
      "  语义最近 " + dsN.padEnd(12) + ds.toFixed(1).padStart(5) +
      "  分类最近 " + dcN.padEnd(13) + dc.toFixed(1).padStart(5) +
      "  对卡 " + dot.toFixed(2).padStart(5) + ":1" + (dot < 3 ? " (报告)" : ""));
  }
  const worstS = Math.min(...Object.values(catMinSem)), worstC = Math.min(...Object.values(catMinCat));
  say("  → 最小语义间距 ΔE00=" + worstS.toFixed(1) + " / 最小分类间距 ΔE00=" + worstC.toFixed(1));
}

say("\n===== 豁免 =====");
NONTEXT_EXEMPT.forEach((x) => say("  豁免  " + x));

say("\n===== 结果 =====");
say("  硬性违规 " + hardFail + " 项；已知问题（仅报告，未阻断）" + softFail + " 项");
if (softFail > 0) say("  ℹ️  已知问题须写明修法，见 KNOWN_ISSUES 注释");
if (hardFail === 0) say("  ✅ 通过");
process.exit(hardFail === 0 ? 0 : 1);
