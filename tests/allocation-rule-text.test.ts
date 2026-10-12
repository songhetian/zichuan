import { describe, it, expect } from "vitest";
import { describeAllocationRule } from "@/lib/allocation-rule-text";

describe("describeAllocationRule 分类分配规则文案", () => {
  it("唯一分类：说明每人仅限一台", () => {
    expect(describeAllocationRule({ name: "笔记本电脑", unique: true })).toBe(
      "笔记本电脑为「唯一」分类：每人仅限一台"
    );
  });

  it("普通分类：说明可持有多台", () => {
    expect(describeAllocationRule({ name: "显示器", unique: false })).toBe(
      "显示器为普通分类：每人可持有多台"
    );
  });

  it("分类未知时返回 undefined，调用方据此省略该行", () => {
    expect(describeAllocationRule(undefined)).toBeUndefined();
  });
});
