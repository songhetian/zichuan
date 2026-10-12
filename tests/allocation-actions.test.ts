/**
 * 批量分配的服务端行为。
 *
 * 覆盖两个曾经的缺陷：
 *  - `allocateAssets` / `transferAssets` 的唯一性校验带了 `id: { notIn: assetIds }`，
 *    把本批设备自己排除 → 批量把多台唯一分类设备分给同一人时规则完全失效。
 *  - 批量分配只支持单个员工，且失败时整批回滚（与「跳过冲突只分可行的」语义冲突）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { allocateAssets, allocateAssetsToEmployees, transferAssets } from "@/actions/lifecycle.actions";
import { createAsset } from "@/actions/asset.actions";
import { createDeviceTemplate } from "@/actions/device-template.actions";
import { createEmployee } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupUniqueCategory(prefix: string) {
  const cat = await prisma.assetCategory.create({
    data: { name: `${prefix}分类`, code: prefix, unique: true },
  });
  const dept = await prisma.department.create({ data: { name: `${prefix}部门` } });
  const tpl = await createDeviceTemplate({
    name: `${prefix}笔记本`,
    categoryId: cat.id,
    components: [],
  });
  return { cat, dept, tpl: unwrap(tpl) };
}

async function makeIdleAsset(templateId: number, name: string) {
  return unwrap(
    await createAsset({ templateId, name, operator: "admin" })
  );
}

describe("分配 —— 唯一分类的批内自冲突", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("唯一分类下把两台设备批量分配给同一员工会被拦截", async () => {
    const { dept, tpl } = await setupUniqueCategory("UB");
    const emp = unwrap(
      await createEmployee({ employeeNo: "UB01", name: "张批量", departmentId: dept.id })
    );
    const a1 = await makeIdleAsset(tpl.id, "批量机1");
    const a2 = await makeIdleAsset(tpl.id, "批量机2");

    const result = await allocateAssets({
      assetIds: [a1.id, a2.id],
      employeeId: emp.id,
      operator: "admin",
    });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("唯一性约束");

    // 一台都不能落下
    const assets = await prisma.asset.findMany({
      where: { id: { in: [a1.id, a2.id] } },
    });
    expect(assets.every((a) => a.status === "IDLE")).toBe(true);
  });

  it("唯一分类下把两台设备批量调拨给同一员工会被拦截", async () => {
    const { dept, tpl } = await setupUniqueCategory("UT");
    const from = unwrap(
      await createEmployee({ employeeNo: "UT01", name: "原使用人", departmentId: dept.id })
    );
    const to = unwrap(
      await createEmployee({ employeeNo: "UT02", name: "目标员工", departmentId: dept.id })
    );
    const a1 = await makeIdleAsset(tpl.id, "调拨机1");
    const a2 = await makeIdleAsset(tpl.id, "调拨机2");
    await prisma.asset.updateMany({
      where: { id: { in: [a1.id, a2.id] } },
      data: { status: "IN_USE", employeeId: from.id },
    });

    const result = await transferAssets({
      assetIds: [a1.id, a2.id],
      toEmployeeId: to.id,
      operator: "admin",
    });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("唯一性约束");

    const assets = await prisma.asset.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    expect(assets.every((a) => a.employeeId === from.id)).toBe(true);
  });
});

describe("allocateAssetsToEmployees —— 一次提交多个员工", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  async function setupPlainBatch(prefix: string) {
    const cat = await prisma.assetCategory.create({
      data: { name: `${prefix}普通分类`, code: prefix, unique: false },
    });
    const dept = await prisma.department.create({ data: { name: `${prefix}部门` } });
    const tpl = unwrap(
      await createDeviceTemplate({ name: `${prefix}普通机`, categoryId: cat.id, components: [] })
    );
    const e1 = unwrap(
      await createEmployee({ employeeNo: `${prefix}01`, name: "甲", departmentId: dept.id })
    );
    const e2 = unwrap(
      await createEmployee({ employeeNo: `${prefix}02`, name: "乙", departmentId: dept.id })
    );
    return { cat, dept, tpl, e1, e2 };
  }

  it("一次提交把两台设备分别分配给两个员工", async () => {
    const { tpl, e1, e2 } = await setupPlainBatch("MB");
    const a1 = await makeIdleAsset(tpl.id, "机1");
    const a2 = await makeIdleAsset(tpl.id, "机2");

    const result = await allocateAssetsToEmployees({
      assignments: [
        { assetId: a1.id, employeeId: e1.id },
        { assetId: a2.id, employeeId: e2.id },
      ],
      operator: "admin",
      remark: "批量分配",
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).allocatedCount).toBe(2);

    const rows = await prisma.asset.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a1.id)?.status).toBe("IN_USE");
    expect(byId.get(a1.id)?.employeeId).toBe(e1.id);
    expect(byId.get(a1.id)?.name).toBe("甲");
    expect(byId.get(a2.id)?.employeeId).toBe(e2.id);
  });

  it("唯一分类下同一员工一次提交 3 台，只落 1 台并把其余回报为冲突", async () => {
    const { dept, tpl } = await setupUniqueCategory("MU");
    const emp = unwrap(
      await createEmployee({ employeeNo: "MU01", name: "张唯一多", departmentId: dept.id })
    );
    const a1 = await makeIdleAsset(tpl.id, "唯一多1");
    const a2 = await makeIdleAsset(tpl.id, "唯一多2");
    const a3 = await makeIdleAsset(tpl.id, "唯一多3");
    const sorted = [a1, a2, a3].sort((x, y) =>
      x.assetNo.localeCompare(y.assetNo, undefined, { numeric: true })
    );

    const result = await allocateAssetsToEmployees({
      assignments: sorted.map((a) => ({ assetId: a.id, employeeId: emp.id })),
      operator: "admin",
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).allocatedCount).toBe(1);
    expect(unwrap(result).skipped.map((s) => s.assetNo)).toEqual([
      sorted[1].assetNo,
      sorted[2].assetNo,
    ]);

    const allocated = await prisma.asset.findMany({ where: { employeeId: emp.id } });
    expect(allocated.map((a) => a.assetNo)).toEqual([sorted[0].assetNo]);
  });

  it("设备状态不可分配时只落其余设备，并把原因回报在 skipped 里", async () => {
    const { tpl, e1 } = await setupPlainBatch("MS");
    const ok = await makeIdleAsset(tpl.id, "可分配机");
    const busy = await makeIdleAsset(tpl.id, "在用机");
    await prisma.asset.update({
      where: { id: busy.id },
      data: { status: "IN_USE", employeeId: e1.id },
    });

    const result = await allocateAssetsToEmployees({
      assignments: [
        { assetId: ok.id, employeeId: e1.id },
        { assetId: busy.id, employeeId: e1.id },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).allocatedCount).toBe(1);
    expect(unwrap(result).skipped).toEqual([
      { assetId: busy.id, assetNo: busy.assetNo, reason: "设备状态为「在用」，不可分配" },
    ]);

    const okAfter = await prisma.asset.findUnique({ where: { id: ok.id } });
    expect(okAfter?.employeeId).toBe(e1.id);
  });

  it("多员工提交时按员工各记一条系统日志", async () => {
    const { tpl, e1, e2 } = await setupPlainBatch("ML");
    const a1 = await makeIdleAsset(tpl.id, "日志机1");
    const a2 = await makeIdleAsset(tpl.id, "日志机2");

    await allocateAssetsToEmployees({
      assignments: [
        { assetId: a1.id, employeeId: e1.id },
        { assetId: a2.id, employeeId: e2.id },
      ],
      operator: "admin",
    });

    const logs = await prisma.systemLog.findMany({ where: { module: "分配" } });
    expect(logs.map((l) => l.detail).sort()).toEqual(
      [`将 ${a1.assetNo} 分配给 甲`, `将 ${a2.assetNo} 分配给 乙`].sort()
    );
  });
});
