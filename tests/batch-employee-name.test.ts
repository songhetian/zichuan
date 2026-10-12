/**
 * 批量建人时的姓名生成规则：`部门名-4 位随机编号`。
 *
 * 目的：批量造出的占位员工一眼能看出属于哪个部门，且名字互不相同，
 * 方便直接拿来和设备做搭配（分配/调拨）。
 */
import { describe, it, expect } from "vitest";
import { generateBatchEmployeeNames } from "@/lib/batch-employee";

/** 固定随机源：0.5 → 5000，便于断言 */
const fixedRand = () => 0.5;

describe("generateBatchEmployeeNames 批量建人姓名", () => {
  it("姓名为「部门名-4 位编号」", () => {
    expect(generateBatchEmployeeNames("研发部", 1, [], fixedRand)).toEqual(["研发部-5000"]);
  });

  it("编号补足 4 位（不足前面补 0）", () => {
    // 0.000123 * 10000 = 1.23 → 1 → "0001"
    expect(generateBatchEmployeeNames("市场部", 1, [], () => 0.000123)).toEqual(["市场部-0001"]);
  });

  it("按 count 生成对应条数", () => {
    let i = 0;
    const seq = () => (i++ % 10) / 10; // 0, 0.1, 0.2 ...
    const names = generateBatchEmployeeNames("行政部", 3, [], seq);
    expect(names).toHaveLength(3);
    expect(names).toEqual(["行政部-0000", "行政部-1000", "行政部-2000"]);
  });

  it("避开已有姓名，不产生重名", () => {
    let i = 0;
    const seq = () => i++ / 10; // 0.0, 0.1, 0.2
    // 第一个候选「行政部-0000」已被占用 → 跳到 0.1
    const names = generateBatchEmployeeNames("行政部", 1, ["行政部-0000"], seq);
    expect(names).toEqual(["行政部-1000"]);
  });

  it("批内也不会重复", () => {
    // 随机源恒定 → 只能靠重试/兜底拿到不同值，但至少不能重复
    const names = generateBatchEmployeeNames("技术部", 3, [], fixedRand);
    expect(new Set(names).size).toBe(3);
  });

  it("随机源恒定且名字被占满时，退化为序号后缀兜底（保证不重复）", () => {
    // 0.0 恒定 → 候选永远是「技术部-0000」
    const names = generateBatchEmployeeNames("技术部", 2, [], () => 0);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe("技术部-0000");
  });

  it("count 为 0 或负数返回空数组", () => {
    expect(generateBatchEmployeeNames("研发部", 0, [])).toEqual([]);
    expect(generateBatchEmployeeNames("研发部", -3, [])).toEqual([]);
  });

  it("部门名前后空格会被去掉", () => {
    expect(generateBatchEmployeeNames("  研发部  ", 1, [], fixedRand)).toEqual(["研发部-5000"]);
  });
});
