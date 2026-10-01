import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { hslToHex, tokenValueToColor } from "@/lib/use-theme-colors";

/**
 * 回归守卫：图表配色。
 *
 * 背景（2026-09-29）：驾驶舱的堆叠柱状图与环形图**全部显示成单一颜色**。
 * 根因是 `use-theme-colors.ts` 用 `Number()` 解析 CSS 变量里的 HSL 三元组
 * （`237 56% 34%`）——`Number("56%") === NaN`，拼出非法的 `hsl(237 NaN% NaN%)`，
 * 而 canvas 对非法 `fillStyle` 既不报错也不改色，于是所有图形落到同一个颜色。
 *
 * 这类 bug 静默且只在渲染层可见，单元测试必须把「值正确性 + 彼此可区分」钉死。
 */

const HEX_RE = /^#[0-9a-f]{6}$/;

/** 从 globals.css 抽取某个主题块里的 token 值 */
function readTokens(selector: string): Record<string, string> {
  const css = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`globals.css 里找不到 ${selector}`);
  const end = css.indexOf("\n  }", start);
  const block = css.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[`--${m[1]}`] = m[2].trim();
  }
  return out;
}

describe("tokenValueToColor 把 CSS 变量转成 canvas 色值", () => {
  it("回归：带 % 的 HSL 三元组必须解析成功，绝不能产出 NaN", () => {
    const color = tokenValueToColor("237 56% 34%");
    expect(color).not.toContain("NaN");
    expect(color).toBe("#262b87");
    expect(color).toMatch(HEX_RE);
  });

  it("与浏览器对 hsl(237 56% 34%) 的解析结果一致", () => {
    // Chrome canvas 把 hsl(237 56% 34%) 归一化为 #262b87（见 chart-color-proof 取证）
    expect(hslToHex(237, 56, 34)).toBe("#262b87");
  });

  it("每个真实 token 都能转成合法 #rrggbb（NaN 守卫）", () => {
    const samples = [
      "--foreground",
      "--muted-foreground",
      "--border",
      "--card",
      "--primary",
      "--success",
      "--warning",
      "--destructive",
      "--info",
      "--violet",
      "--cat-indigo",
      "--cat-violet",
      "--cat-blue",
      "--cat-emerald",
      "--cat-sky",
      "--cat-rose",
      "--cat-cyan",
      "--cat-teal",
      "--cat-purple",
      "--cat-pink",
      "--cat-fuchsia",
    ];
    for (const theme of ["  :root {", "  :root.dark {"]) {
      const tokens = readTokens(theme);
      for (const name of samples) {
        const raw = tokens[name];
        expect(raw, `${theme} 缺少 ${name}`).toBeTruthy();
        const color = tokenValueToColor(raw);
        expect(color, `${theme} ${name}（原值 ${raw}）解析失败 → ${color}`).toMatch(HEX_RE);
      }
    }
  });

  it("分类色两两不同 —— 防止再次退化成「全部同色」", () => {
    const tokens = readTokens("  :root {");
    const catTokens = Object.keys(tokens).filter((k) => k.startsWith("--cat-"));
    expect(catTokens.length).toBeGreaterThanOrEqual(5);
    const colors = catTokens.map((k) => tokenValueToColor(tokens[k]));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("资产状态配色两两不同 —— 环形图各扇区必须可区分", () => {
    const tokens = readTokens("  :root {");
    const statusTokens = [
      "--muted-foreground",
      "--success",
      "--warning",
      "--destructive",
      "--violet",
    ];
    const colors = statusTokens.map((k) => tokenValueToColor(tokens[k]));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("空值与无法解析的值回退为合法兜底色，而不是 NaN", () => {
    const fallback = tokenValueToColor("");
    expect(fallback).toMatch(HEX_RE);
    expect(tokenValueToColor("   ")).toBe(fallback);
    expect(tokenValueToColor("var(--nope)")).toBe(fallback);
    expect(tokenValueToColor("237")).toBe(fallback);
  });

  it("已是完整颜色语法的值原样透传", () => {
    expect(tokenValueToColor("#262b87")).toBe("#262b87");
    expect(tokenValueToColor("rgb(38, 43, 135)")).toBe("rgb(38, 43, 135)");
    expect(tokenValueToColor("oklch(0.5 0.2 264)")).toBe("oklch(0.5 0.2 264)");
  });

  it("容忍逗号分隔与省略 % 的写法", () => {
    expect(tokenValueToColor("237, 56%, 34%")).toBe("#262b87");
    expect(tokenValueToColor("237 56 34")).toBe("#262b87");
  });
});
