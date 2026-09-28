import { describe, it, expect } from "vitest";
import { getStatusLabel } from "@/lib/status-labels";

describe("getStatusLabel 设备状态中文标签", () => {
  it("四个状态全部映射为中文，不含英文枚举值", () => {
    expect(getStatusLabel("IDLE")).toBe("闲置");
    expect(getStatusLabel("IN_USE")).toBe("在用");
    expect(getStatusLabel("IN_MAINTENANCE")).toBe("维修中");
    expect(getStatusLabel("SCRAPPED")).toBe("报废");
  });

  it("未知状态返回原值兜底", () => {
    expect(getStatusLabel("UNKNOWN_STATUS")).toBe("UNKNOWN_STATUS");
  });
});
