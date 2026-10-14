import { describe, it, expect } from "vitest";
import { toDateKey, filterByDateKey, formatImportDateTime } from "@/lib/import-date";

// ============================================================
// 标签打印页「按导入日期筛选」的纯逻辑
// 日期一律按【本地时区】归一，避免 UTC 跨天把用户的「今天」算错
// ============================================================

describe("toDateKey", () => {
  it("按本地时区归一成 YYYY-MM-DD", () => {
    expect(toDateKey(new Date(2026, 9, 12, 15, 30))).toBe("2026-10-12");
  });

  it("月/日补零", () => {
    expect(toDateKey(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });

  it("接受 ISO 字符串", () => {
    const iso = new Date(2026, 9, 12, 8, 0).toISOString();
    expect(toDateKey(iso)).toBe("2026-10-12");
  });

  it("当天 00:00 与 23:59 都算这一天", () => {
    expect(toDateKey(new Date(2026, 9, 12, 0, 0, 0))).toBe("2026-10-12");
    expect(toDateKey(new Date(2026, 9, 12, 23, 59, 59))).toBe("2026-10-12");
  });

  it("空值 / 非法值返回空串", () => {
    expect(toDateKey(null)).toBe("");
    expect(toDateKey(undefined)).toBe("");
    expect(toDateKey("not-a-date")).toBe("");
  });
});

describe("filterByDateKey", () => {
  const items = [
    { id: 1, createdAt: new Date(2026, 9, 12, 9, 0) },
    { id: 2, createdAt: new Date(2026, 9, 12, 23, 59) },
    { id: 3, createdAt: new Date(2026, 9, 13, 0, 1) },
  ];

  it("日期为空时原样返回全部（不产生新数组）", () => {
    expect(filterByDateKey(items, "")).toBe(items);
  });

  it("只保留当天导入的", () => {
    expect(filterByDateKey(items, "2026-10-12").map((i) => i.id)).toEqual([1, 2]);
    expect(filterByDateKey(items, "2026-10-13").map((i) => i.id)).toEqual([3]);
  });

  it("无匹配返回空数组", () => {
    expect(filterByDateKey(items, "2020-01-01")).toEqual([]);
  });

  it("跳过 createdAt 缺失的项，不误判为当天", () => {
    const withNull = [...items, { id: 4, createdAt: null }];
    expect(filterByDateKey(withNull, "2026-10-12").map((i) => i.id)).toEqual([1, 2]);
  });

  it("不修改原数组", () => {
    const copy = [...items];
    filterByDateKey(items, "2026-10-12");
    expect(items).toEqual(copy);
  });
});

describe("formatImportDateTime", () => {
  it("格式化为 YYYY-MM-DD HH:mm", () => {
    expect(formatImportDateTime(new Date(2026, 9, 12, 9, 5))).toBe("2026-10-12 09:05");
  });

  it("补零到两位", () => {
    expect(formatImportDateTime(new Date(2026, 0, 3, 7, 8))).toBe("2026-01-03 07:08");
  });

  it("空值返回占位符 -", () => {
    expect(formatImportDateTime(null)).toBe("-");
    expect(formatImportDateTime(undefined)).toBe("-");
    expect(formatImportDateTime("not-a-date")).toBe("-");
  });
});
