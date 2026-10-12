import { describe, it, expect } from "vitest";
import { getAvailableActions } from "@/lib/asset-action-availability";

describe("getAvailableActions 设备状态 → 可用操作", () => {
  it("库存态设备可以分配（回归：批量入库后必须能直接分配）", () => {
    expect(getAvailableActions("IN_STOCK")).toContain("allocate");
  });

  it("库存态与闲置态的可用操作一致（两者都可分配）", () => {
    expect(getAvailableActions("IN_STOCK")).toEqual(getAvailableActions("IDLE"));
  });

  it("闲置态：可分配、可送修、可报废", () => {
    expect(getAvailableActions("IDLE").sort()).toEqual(["allocate", "scrap", "sendRepair"]);
  });

  it("在用态：可归还、可调拨、可送修、可报废，但不可分配", () => {
    expect(getAvailableActions("IN_USE").sort()).toEqual([
      "return",
      "scrap",
      "sendRepair",
      "transfer",
    ]);
  });

  it("维修中：只能标记维修完成或报废", () => {
    expect(getAvailableActions("IN_MAINTENANCE").sort()).toEqual(["completeRepair", "scrap"]);
  });

  it("已报废：不提供任何操作", () => {
    expect(getAvailableActions("SCRAPPED")).toEqual([]);
  });

  it("未知状态 fail-closed：不提供任何操作，且不抛错", () => {
    expect(getAvailableActions("WHAT_IS_THIS")).toEqual([]);
  });
});
