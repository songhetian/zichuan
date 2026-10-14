/**
 * 标签尺寸 / 编号字号的几何约束。
 *
 * 为什么值得单独测：一张标签只印编号，编号一旦被截断或缩得太小，
 * 实物标签就失去意义。这里把「标签多宽、字多大、9 位编号占多少」
 * 变成可断言的事实，以后谁调尺寸都会立刻被这几条挡住。
 */
import { describe, it, expect } from "vitest";
import {
  LABEL_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_CODE_FONT_PX,
  LABEL_TEXT_WIDTH_PX,
  MONO_ADVANCE_EM,
  codeWidthPx,
  codeFitsLabel,
} from "@/lib/label-size";

/** 系统里的真实编号：2 位分类前缀 + "-" + 6 位随机码 */
const REAL_CODE = "DN-2U7W9N";

describe("label-size", () => {
  it("标签比原来的 80×40mm 更小（宽高都收）", () => {
    expect(LABEL_WIDTH_MM).toBeLessThan(80);
    expect(LABEL_HEIGHT_MM).toBeLessThan(40);
  });

  it("编号字号不低于可读下限（≥28px）", () => {
    expect(LABEL_CODE_FONT_PX).toBeGreaterThanOrEqual(28);
  });

  it("短编号也必须比长编号窄（等宽估算的单调性）", () => {
    expect(codeWidthPx("DN-1")).toBeLessThan(codeWidthPx(REAL_CODE));
  });

  it("9 位真实编号完整放得下，不会被截断", () => {
    expect(REAL_CODE).toHaveLength(9);
    expect(codeFitsLabel(REAL_CODE)).toBe(true);
    expect(codeFitsLabel("DT-8889ME")).toBe(true);
    expect(codeFitsLabel("NB-A1B2C3")).toBe(true);
  });

  it("9 位编号占满标签宽度的大部分（不至于缩成一小撮）", () => {
    const ratio = codeWidthPx(REAL_CODE) / LABEL_TEXT_WIDTH_PX;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("等宽字宽按 0.6em 保守估算（覆盖 Menlo/Consolas）", () => {
    expect(MONO_ADVANCE_EM).toBeGreaterThanOrEqual(0.55);
    expect(codeWidthPx(REAL_CODE)).toBeCloseTo(9 * MONO_ADVANCE_EM * LABEL_CODE_FONT_PX, 5);
  });

  it("超长编号放不下 —— 这是已知限制，长度超限需要重新调尺寸", () => {
    expect(codeFitsLabel("DN-20261014-0001")).toBe(false);
  });
});
