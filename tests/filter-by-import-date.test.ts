import { describe, it, expect } from "vitest";
import { filterByImportDate } from "@/lib/filter-by-import-date";

const assets = [
  { id: 1, createdAt: new Date("2026-01-10T08:00:00") },
  { id: 2, createdAt: new Date("2026-01-15T08:00:00") },
  { id: 3, createdAt: new Date("2026-01-20T08:00:00") },
  { id: 4, createdAt: new Date("2026-02-01T08:00:00") },
  { id: 5, createdAt: null },
];

describe("filterByImportDate", () => {
  it("未提供范围时返回全部", () => {
    expect(filterByImportDate(assets)).toHaveLength(5);
    expect(filterByImportDate(assets, {})).toHaveLength(5);
    expect(filterByImportDate(assets, { from: null, to: null })).toHaveLength(5);
  });

  it("按 [from, to] 闭区间筛选（含边界当天）", () => {
    const result = filterByImportDate(assets, {
      from: "2026-01-12",
      to: "2026-01-25",
    });
    expect(result.map((a) => a.id)).toEqual([2, 3]);
  });

  it("仅设置起期：包含当天及之后", () => {
    const result = filterByImportDate(assets, { from: "2026-01-15" });
    expect(result.map((a) => a.id)).toEqual([2, 3, 4]);
  });

  it("仅设置止期：包含当天及之前", () => {
    const result = filterByImportDate(assets, { to: "2026-01-15" });
    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it("导入时间为空的设备在筛选开启时被排除", () => {
    const result = filterByImportDate(assets, { from: "2026-01-01" });
    expect(result.map((a) => a.id)).not.toContain(5);
  });
});
