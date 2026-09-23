import { describe, it, expect } from "vitest";
import { formatTime } from "@/lib/utils";

describe("formatTime 日期格式化（审批/通知列表共用）", () => {
  it("Date 对象 → YYYY-MM-DD HH:mm", () => {
    const d = new Date(2026, 8, 19, 9, 5); // 2026-09-19 09:05
    expect(formatTime(d)).toBe("2026-09-19 09:05");
  });

  it("ISO 字符串 → YYYY-MM-DD HH:mm", () => {
    expect(formatTime("2026-09-19T09:05:00.000Z")).toMatch(/^2026-09-19 \d{2}:05$/);
  });

  it("分钟/月/日补零", () => {
    const d = new Date(2026, 0, 3, 8, 7); // 2026-01-03 08:07
    expect(formatTime(d)).toBe("2026-01-03 08:07");
  });

  it("非法输入返回空串", () => {
    expect(formatTime("not-a-date")).toBe("");
  });
});
