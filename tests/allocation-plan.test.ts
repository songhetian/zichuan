import { describe, it, expect } from "vitest";
import {
  planAllocation,
  type AllocationAsset,
  type AllocationEmployee,
} from "@/lib/allocation";

function asset(
  id: number,
  assetNo: string,
  overrides: Partial<AllocationAsset> = {}
): AllocationAsset {
  return {
    id,
    assetNo,
    status: "IDLE",
    categoryId: 1,
    categoryName: "笔记本电脑",
    categoryUnique: false,
    employeeId: null,
    ...overrides,
  };
}

function employee(
  id: number,
  name: string,
  employeeNo: string,
  overrides: Partial<AllocationEmployee> = {}
): AllocationEmployee {
  return {
    id,
    name,
    employeeNo,
    departmentId: 1,
    departmentName: "研发部",
    ownedUniqueCategoryIds: [],
    ...overrides,
  };
}

describe("planAllocation — 均值分配", () => {
  it("普通分类：5 台设备分给 3 人，余数前置为 2/2/1", () => {
    const assets = [1, 2, 3, 4, 5].map((i) => asset(i, `DN-000${i}`));
    const employees = [
      employee(1, "张三", "E001"),
      employee(2, "李四", "E002"),
      employee(3, "王五", "E003"),
    ];

    const plan = planAllocation(assets, employees);

    expect(plan.assignments).toEqual([
      { assetId: 1, employeeId: 1 },
      { assetId: 2, employeeId: 1 },
      { assetId: 3, employeeId: 2 },
      { assetId: 4, employeeId: 2 },
      { assetId: 5, employeeId: 3 },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 2 },
      { employeeId: 2, count: 2 },
      { employeeId: 3, count: 1 },
    ]);
  });

  it("唯一分类：每人配额封顶 1 台，超出的台数直接判冲突", () => {
    const assets = [1, 2, 3, 4, 5].map((i) =>
      asset(i, `DN-000${i}`, { categoryUnique: true })
    );
    const employees = [
      employee(1, "张三", "E001"),
      employee(2, "李四", "E002"),
      employee(3, "王五", "E003"),
    ];

    const plan = planAllocation(assets, employees);

    expect(plan.assignments).toEqual([
      { assetId: 1, employeeId: 1 },
      { assetId: 2, employeeId: 2 },
      { assetId: 3, employeeId: 3 },
    ]);
    expect(plan.conflicts.map((c) => c.assetNo)).toEqual(["DN-0004", "DN-0005"]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 1 },
      { employeeId: 2, count: 1 },
      { employeeId: 3, count: 1 },
    ]);
  });

  it("唯一分类：员工已持有同类设备时槽位作废，且不把设备顺延给下一个人", () => {
    // 方案 §3.1 的推演：5 台笔记本 / 3 人 / 张三已有笔记本
    // 配额 [2,2,1] → 唯一封顶 [1,1,1] → 张三槽位作废 → 槽位序列 [张三✗, 李四, 王五]
    const assets = [1, 2, 3, 4, 5].map((i) =>
      asset(i, `DN-000${i}`, { categoryUnique: true })
    );
    const employees = [
      employee(1, "张三", "E001", { ownedUniqueCategoryIds: [1] }),
      employee(2, "李四", "E002"),
      employee(3, "王五", "E003"),
    ];

    const plan = planAllocation(assets, employees);

    expect(plan.assignments).toEqual([
      { assetId: 2, employeeId: 2 },
      { assetId: 3, employeeId: 3 },
    ]);
    expect(plan.conflicts).toEqual([
      { assetId: 1, assetNo: "DN-0001", reason: "张三已持有笔记本电脑" },
      { assetId: 4, assetNo: "DN-0004", reason: "笔记本电脑每人仅限 1 台" },
      { assetId: 5, assetNo: "DN-0005", reason: "笔记本电脑每人仅限 1 台" },
    ]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 0 },
      { employeeId: 2, count: 1 },
      { employeeId: 3, count: 1 },
    ]);
  });

  it("排序与入参顺序无关：设备按编号自然序、员工按部门→工号", () => {
    // 故意打乱入参顺序，验证结果与界面当前排序无关、可预测可核对
    const assets = [asset(3, "DN-0010"), asset(2, "DN-0002"), asset(1, "DN-0001")];
    const employees = [
      employee(2, "李四", "E001", { departmentId: 2, departmentName: "市场部" }),
      employee(3, "王五", "E009"),
      employee(1, "张三", "E001"),
    ];

    const plan = planAllocation(assets, employees);

    expect(plan.assignments).toEqual([
      { assetId: 1, employeeId: 1 },
      { assetId: 2, employeeId: 3 },
      { assetId: 3, employeeId: 2 },
    ]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 1 },
      { employeeId: 3, count: 1 },
      { employeeId: 2, count: 1 },
    ]);
  });

  it("人数多于台数：前面 N 人各 1 台，其余人为 0 台", () => {
    const assets = [asset(1, "DN-0001"), asset(2, "DN-0002")];
    const employees = [
      employee(1, "张三", "E001"),
      employee(2, "李四", "E002"),
      employee(3, "王五", "E003"),
    ];

    const plan = planAllocation(assets, employees);

    expect(plan.assignments).toEqual([
      { assetId: 1, employeeId: 1 },
      { assetId: 2, employeeId: 2 },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 1 },
      { employeeId: 2, count: 1 },
      { employeeId: 3, count: 0 },
    ]);
  });

  it("状态不可分配的设备单独判冲突，且不占用配额槽位", () => {
    const assets = [
      asset(1, "DN-0001", { status: "IN_USE" }),
      asset(2, "DN-0002", { status: "IN_STOCK" }),
      asset(3, "DN-0003"),
      asset(4, "DN-0004"),
      asset(5, "DN-0005"),
    ];
    const employees = [employee(1, "张三", "E001"), employee(2, "李四", "E002")];

    const plan = planAllocation(assets, employees);

    // 剩 4 台（含库存态）分给 2 人 → 2/2，在用那台单独判冲突
    expect(plan.assignments).toEqual([
      { assetId: 2, employeeId: 1 },
      { assetId: 3, employeeId: 1 },
      { assetId: 4, employeeId: 2 },
      { assetId: 5, employeeId: 2 },
    ]);
    expect(plan.conflicts).toEqual([
      { assetId: 1, assetNo: "DN-0001", reason: "设备状态为「在用」，不可分配" },
    ]);
    expect(plan.perEmployee).toEqual([
      { employeeId: 1, count: 2 },
      { employeeId: 2, count: 2 },
    ]);
  });

  it("未选择员工时全部判冲突，不抛错", () => {
    const assets = [asset(1, "DN-0001"), asset(2, "DN-0002", { status: "IN_USE" })];

    const plan = planAllocation(assets, []);

    expect(plan.assignments).toEqual([]);
    expect(plan.perEmployee).toEqual([]);
    expect(plan.conflicts).toEqual([
      { assetId: 1, assetNo: "DN-0001", reason: "未选择员工" },
      { assetId: 2, assetNo: "DN-0002", reason: "设备状态为「在用」，不可分配" },
    ]);
  });

  it("enforceUnique:false 时不封顶、不作废历史占用槽位", () => {
    const assets = [asset(1, "DN-0001", { categoryUnique: true })];
    const employees = [employee(1, "张三", "E001", { ownedUniqueCategoryIds: [1] })];

    const plan = planAllocation(assets, employees, { enforceUnique: false });

    expect(plan.assignments).toEqual([{ assetId: 1, employeeId: 1 }]);
    expect(plan.conflicts).toEqual([]);
  });
});
