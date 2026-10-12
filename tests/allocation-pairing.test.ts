import { describe, it, expect } from "vitest";
import {
  buildAllocationPairs,
  annotatePairConflicts,
  summarizePairing,
  type PairingAsset,
  type PairingEmployee,
  type PairingCategory,
} from "@/lib/allocation-pairing";

// ============================================================
// 批量分配：自动配对（严格 1:1）与冲突预校验
//
// 规则口径（与服务端一致，见 src/actions/lifecycle.actions.ts 的 allocateAssets）：
//   R1 状态：只有「闲置(IDLE)」设备可被分配
//   R2 唯一性(R4)：AssetCategory.unique = true 的分类，同一员工至多持有 1 台
//   R3 人员：已离职(LEFT)员工不可被分配
//   R4 配对：设备按资产编号升序、员工按勾选顺序，一一对应；数量不等即不可提交
// ============================================================

const categories: PairingCategory[] = [
  { id: 100, name: "笔记本电脑", unique: true },
  { id: 200, name: "显示器", unique: false },
];

const asset = (
  base: { id: number; assetNo: string } & Partial<PairingAsset>
): PairingAsset => ({
  name: base.assetNo,
  status: "IDLE",
  employeeId: null,
  categoryId: 200,
  ...base,
});

const employee = (
  base: { id: number; name: string } & Partial<PairingEmployee>
): PairingEmployee => ({
  departmentName: "研发部",
  status: "ACTIVE",
  ...base,
});

/** 配对 + 标注冲突（allAssets 默认与待分配集合相同） */
const annotate = (
  assets: PairingAsset[],
  employees: PairingEmployee[],
  allAssets: PairingAsset[] = assets
) =>
  annotatePairConflicts(buildAllocationPairs(assets, employees), {
    allAssets,
    categories,
  });

describe("buildAllocationPairs：自动配对顺序", () => {
  it("设备按资产编号升序、员工按勾选顺序一一对应，序号从 1 开始", () => {
    const result = buildAllocationPairs(
      [
        asset({ id: 3, assetNo: "DN-0018" }),
        asset({ id: 1, assetNo: "DN-0012" }),
        asset({ id: 2, assetNo: "DN-0015" }),
      ],
      [employee({ id: 7, name: "王强" }), employee({ id: 5, name: "张三" }), employee({ id: 6, name: "李四" })]
    );

    expect(result.pairs.map((p) => [p.index, p.asset.assetNo, p.employee.name])).toEqual([
      [1, "DN-0012", "王强"],
      [2, "DN-0015", "张三"],
      [3, "DN-0018", "李四"],
    ]);
  });

  it("资产编号里的数字按数值比较（DN-0002 排在 DN-0010 之前）", () => {
    const result = buildAllocationPairs(
      [asset({ id: 1, assetNo: "DN-0010" }), asset({ id: 2, assetNo: "DN-0002" })],
      [employee({ id: 5, name: "张三" }), employee({ id: 6, name: "李四" })]
    );

    expect(result.pairs.map((p) => p.asset.assetNo)).toEqual(["DN-0002", "DN-0010"]);
  });

  it("配对是确定性的：同一组输入无论传入顺序如何，结果一致", () => {
    const a = asset({ id: 2, assetNo: "DN-0002" });
    const b = asset({ id: 1, assetNo: "DN-0001" });
    const e1 = employee({ id: 5, name: "张三" });
    const e2 = employee({ id: 6, name: "李四" });

    const first = buildAllocationPairs([a, b], [e1, e2]);
    const second = buildAllocationPairs([b, a], [e1, e2]);

    expect(first.pairs.map((p) => p.asset.assetNo)).toEqual(["DN-0001", "DN-0002"]);
    expect(second.pairs.map((p) => p.asset.assetNo)).toEqual(["DN-0001", "DN-0002"]);
  });

  it("数量不等时只产出能配上的部分，并如实回报两侧数量", () => {
    const result = buildAllocationPairs(
      [
        asset({ id: 1, assetNo: "DN-0001" }),
        asset({ id: 2, assetNo: "DN-0002" }),
        asset({ id: 3, assetNo: "DN-0003" }),
      ],
      [employee({ id: 5, name: "张三" })]
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.assetCount).toBe(3);
    expect(result.employeeCount).toBe(1);
  });
});

describe("annotatePairConflicts：冲突预校验", () => {
  it("R3：目标员工已离职 → EMPLOYEE_LEFT", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" })],
      [employee({ id: 5, name: "赵敏", status: "LEFT" })]
    );

    expect(result.pairs[0].conflict?.kind).toBe("EMPLOYEE_LEFT");
    expect(result.pairs[0].conflict?.message).toContain("赵敏");
  });

  it("R1：设备非闲置 → ASSET_NOT_IDLE", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", status: "IN_USE", employeeId: 9 })],
      [employee({ id: 5, name: "张三" })]
    );

    expect(result.pairs[0].conflict?.kind).toBe("ASSET_NOT_IDLE");
  });

  it("R2：唯一分类且员工已持有同分类设备 → UNIQUE_VIOLATION，并指出是哪一台", () => {
    const held = asset({ id: 91, assetNo: "DN-0091", categoryId: 100, status: "IN_USE", employeeId: 5 });
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })],
      [employee({ id: 5, name: "张三" })],
      [held, asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })]
    );

    expect(result.pairs[0].conflict?.kind).toBe("UNIQUE_VIOLATION");
    expect(result.pairs[0].conflict?.message).toContain("笔记本电脑");
    expect(result.pairs[0].conflict?.message).toContain("DN-0091");
  });

  it("R2：非唯一分类即使员工已持有同分类设备也不冲突", () => {
    const held = asset({ id: 91, assetNo: "DN-0091", categoryId: 200, status: "IN_USE", employeeId: 5 });
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", categoryId: 200 })],
      [employee({ id: 5, name: "张三" })],
      [held, asset({ id: 1, assetNo: "DN-0001", categoryId: 200 })]
    );

    expect(result.pairs[0].conflict).toBeNull();
  });

  it("R2：员工持有的是同分类的【已报废】设备 → 不算持有，不冲突", () => {
    const scrapped = asset({ id: 91, assetNo: "DN-0091", categoryId: 100, status: "SCRAPPED", employeeId: 5 });
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })],
      [employee({ id: 5, name: "张三" })],
      [scrapped, asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })]
    );

    expect(result.pairs[0].conflict).toBeNull();
  });

  it("R2：员工持有的【维修中】设备仍算持有（与服务端口径一致）", () => {
    const repairing = asset({ id: 91, assetNo: "DN-0091", categoryId: 100, status: "IN_MAINTENANCE", employeeId: 5 });
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })],
      [employee({ id: 5, name: "张三" })],
      [repairing, asset({ id: 1, assetNo: "DN-0001", categoryId: 100 })]
    );

    expect(result.pairs[0].conflict?.kind).toBe("UNIQUE_VIOLATION");
  });

  it("1:1 下不会误报「同批次内同唯一分类」——待分配设备本身是闲置的，不算任何人持有", () => {
    const result = annotate(
      [
        asset({ id: 1, assetNo: "DN-0001", categoryId: 100 }),
        asset({ id: 2, assetNo: "DN-0002", categoryId: 100 }),
      ],
      [employee({ id: 5, name: "张三" }), employee({ id: 6, name: "李四" })]
    );

    expect(result.pairs.map((p) => p.conflict)).toEqual([null, null]);
  });

  it("多条冲突同时存在时按「人 → 设备 → 唯一性」的优先级报第一条", () => {
    const held = asset({ id: 91, assetNo: "DN-0091", categoryId: 100, status: "IN_USE", employeeId: 5 });
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001", categoryId: 100, status: "IN_USE", employeeId: 9 })],
      [employee({ id: 5, name: "赵敏", status: "LEFT" })],
      [held, asset({ id: 1, assetNo: "DN-0001", categoryId: 100, status: "IN_USE", employeeId: 9 })]
    );

    expect(result.pairs[0].conflict?.kind).toBe("EMPLOYEE_LEFT");
  });

  it("干净的配对没有冲突", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" }), asset({ id: 2, assetNo: "DN-0002", categoryId: 100 })],
      [employee({ id: 5, name: "张三" }), employee({ id: 6, name: "李四" })]
    );

    expect(result.pairs.map((p) => p.conflict)).toEqual([null, null]);
  });
});

describe("summarizePairing：状态栏与提交闸门", () => {
  it("数量相等且无冲突 → 可提交", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" })],
      [employee({ id: 5, name: "张三" })]
    );
    const summary = summarizePairing(result);

    expect(summary).toMatchObject({
      assetCount: 1,
      employeeCount: 1,
      pairCount: 1,
      missingEmployees: 0,
      extraEmployees: 0,
      conflictCount: 0,
      canSubmit: true,
    });
  });

  it("人不够 → missingEmployees 为正且不可提交", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" }), asset({ id: 2, assetNo: "DN-0002" })],
      [employee({ id: 5, name: "张三" })]
    );

    expect(summarizePairing(result)).toMatchObject({
      missingEmployees: 1,
      extraEmployees: 0,
      canSubmit: false,
    });
  });

  it("人多了 → extraEmployees 为正且不可提交", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" })],
      [employee({ id: 5, name: "张三" }), employee({ id: 6, name: "李四" })]
    );

    expect(summarizePairing(result)).toMatchObject({
      missingEmployees: 0,
      extraEmployees: 1,
      canSubmit: false,
    });
  });

  it("有冲突 → 计入 conflictCount 且不可提交", () => {
    const result = annotate(
      [asset({ id: 1, assetNo: "DN-0001" })],
      [employee({ id: 5, name: "赵敏", status: "LEFT" })]
    );

    expect(summarizePairing(result)).toMatchObject({ conflictCount: 1, canSubmit: false });
  });

  it("一台设备都没选 → 不可提交", () => {
    const result = annotate([], []);
    const summary = summarizePairing(result);

    expect(summary.canSubmit).toBe(false);
    expect(summary.assetCount).toBe(0);
  });
});
