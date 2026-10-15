/**
 * 标签尺寸 / 编号字号的几何约束。
 *
 * 为什么值得单独测：一张标签只印编号，编号一旦被截断或缩得太小，
 * 实物标签就失去意义。这里把「标签多宽、字多大、9 位编号占多少」
 * 变成可断言的事实，以后谁调尺寸都会立刻被这几条挡住。
 *
 * 2026-10-15 起字号不再用固定 px，而是 cqw（容器宽度的百分比）：
 * 真实打印环境（字体 fallback / 打印缩放 / DPR）与浏览器预览有差异，
 * 固定 px 曾导致打印出来编号末尾被 truncate 成 "DN-DN8…"（见用户实拍）。
 * 改用 cqw 后字号与容器宽度联动，任何环境下都不会溢出。
 */
import { describe, it, expect } from "vitest";
import {
  LABEL_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_CODE_FONT_PX,
  LABEL_CODE_FONT_CQW,
  LABEL_TEXT_WIDTH_PX,
  MONO_ADVANCE_EM,
  EXPORT_PAGE_MARGIN_MM,
  EXPORT_GAP_MM,
  EXPORT_SHEET_PADDING_MM,
  EXPORT_SHEET_WIDTH_MM,
  EXPORT_SHEET_HEIGHT_MM,
  EXPORT_ROWS_PER_PAGE,
  paginateForExport,
  mmToPx,
  codeWidthPx,
  codeFitsLabel,
} from "@/lib/label-size";

/** 系统里的真实编号：2 位分类前缀 + "-" + 6 位随机码 */
const REAL_CODE = "DN-2U7W9N";

describe("label-size", () => {
  it("标签比 60×30mm 明显放大（用户反馈上一版太小）", () => {
    expect(LABEL_WIDTH_MM).toBeGreaterThan(60);
    expect(LABEL_HEIGHT_MM).toBeGreaterThan(30);
    // 但不能超过 A4 竖版两列布局的上限（可用宽约 190mm，留出间隙）
    expect(LABEL_WIDTH_MM * 2).toBeLessThanOrEqual(190);
  });

  it("编号字号不低于可读下限（≥28px）", () => {
    expect(LABEL_CODE_FONT_PX).toBeGreaterThanOrEqual(28);
  });

  it("字号用 cqw 随容器宽度自适应，且比例在安全范围内", () => {
    // 9 位等宽字符占宽 = 9 × 0.6 × 比例，要 < 100% 才有余量；
    // 再扣掉 tracking-tight 的收紧，比例 ≤16% 都是安全的
    expect(LABEL_CODE_FONT_CQW).toBeGreaterThan(10);
    expect(LABEL_CODE_FONT_CQW).toBeLessThanOrEqual(16);
  });

  it("设计基准字号 = cqw 比例 × 容器宽度（两者永远联动，不会各说各话）", () => {
    const containerPx = LABEL_WIDTH_MM * (96 / 25.4);
    expect(LABEL_CODE_FONT_PX).toBeCloseTo(
      (LABEL_CODE_FONT_CQW / 100) * containerPx,
      1,
    );
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

  describe("导出 PDF 排版几何", () => {
    it("间距足够下剪刀（用户要求方便裁剪，≥8mm）", () => {
      expect(EXPORT_GAP_MM).toBeGreaterThanOrEqual(8);
    });

    it("单页 sheet 放得进 A4 竖版可打印区域", () => {
      // A4: 210×297，页边距 10mm → 可打印 190×277
      expect(EXPORT_SHEET_WIDTH_MM).toBeLessThanOrEqual(210 - 2 * EXPORT_PAGE_MARGIN_MM);
      expect(EXPORT_SHEET_HEIGHT_MM).toBeLessThanOrEqual(297 - 2 * EXPORT_PAGE_MARGIN_MM);
    });

    it("sheet 是两列布局且能容纳每页行数", () => {
      expect(EXPORT_SHEET_WIDTH_MM).toBeGreaterThanOrEqual(
        2 * LABEL_WIDTH_MM + EXPORT_GAP_MM + 2 * EXPORT_SHEET_PADDING_MM,
      );
      expect(EXPORT_SHEET_HEIGHT_MM).toBeGreaterThanOrEqual(
        EXPORT_ROWS_PER_PAGE * LABEL_HEIGHT_MM +
          (EXPORT_ROWS_PER_PAGE - 1) * EXPORT_GAP_MM +
          2 * EXPORT_SHEET_PADDING_MM,
      );
    });

    it("分页：每页 2×6=12 个，15 个分成两页", () => {
      const pages = paginateForExport(Array.from({ length: 15 }, (_, i) => i));
      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(12);
      expect(pages[1]).toHaveLength(3);
    });

    it("分页：空列表与整页边界", () => {
      expect(paginateForExport([])).toEqual([]);
      const exact = paginateForExport(Array.from({ length: 24 }, (_, i) => i));
      expect(exact).toHaveLength(2);
      expect(exact[1]).toHaveLength(12);
    });

    it("mmToPx 换算正确（96dpi）", () => {
      expect(mmToPx(75)).toBeCloseTo(75 * (96 / 25.4), 6);
    });
  });
});
