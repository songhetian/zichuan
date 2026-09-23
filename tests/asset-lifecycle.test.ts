import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { getAssetLifecycleView } from "@/actions/asset-lifecycle.actions";
import { unwrap, unwrapError } from "./helpers";

// ============================================================
// 设备生命周期视图：权限门控 + 聚合查询 + 分组筛选 + 申请单关联
// 采用测试权限覆盖（setTestUser.permissions），不依赖真实角色数据。
// 数据由全局 tests/setup.ts 在每个测试前清库。
// ============================================================

function boss() {
  setTestUser({ id: 1, username: "boss", permissions: ["asset.manage"] });
}
function nobody() {
  setTestUser({ id: 2, username: "nobody", permissions: [] });
}

/** 标准环境：两个部门、两名员工、一台资产、一张已通过申请单。 */
async function seedEnv() {
  const deptA = await prisma.department.create({ data: { name: "研发部" } });
  const deptB = await prisma.department.create({ data: { name: "市场部" } });
  const empA = await prisma.employee.create({
    data: { employeeNo: "EA", name: "张三", departmentId: deptA.id },
  });
  const empB = await prisma.employee.create({
    data: { employeeNo: "EB", name: "李四", departmentId: deptB.id },
  });
  const cat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const tpl = await prisma.deviceTemplate.create({
    data: { name: "办公电脑", categoryId: cat.id },
  });
  const asset = await prisma.asset.create({
    data: { assetNo: "DN-1001", name: "研发电脑", templateId: tpl.id, status: "IN_USE", employeeId: empA.id },
  });

  // 关联申请单：需要定义 + 发起账号
  const initiator = await prisma.admin.create({ data: { username: "admin0", password: "x" } });
  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_UPGRADE",
      name: "升级流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const request = await prisma.approvalRequest.create({
    data: {
      requestNo: "AP-TEST-001",
      definitionId: def.id,
      businessType: "ASSET_UPGRADE",
      title: "研发电脑升级",
      initiatorId: initiator.id,
      payload: {},
      status: "APPROVED",
    },
  });

  return { deptA, deptB, empA, empB, asset, request, admin: initiator };
}

async function seedLogs(env: Awaited<ReturnType<typeof seedEnv>>) {
  const { asset, empA, empB, request } = env;
  await prisma.lifecycleLog.create({
    data: {
      assetId: asset.id,
      action: "CREATED",
      operator: "系统",
      createdAt: new Date("2026-09-01T10:00:00"),
    },
  });
  await prisma.lifecycleLog.create({
    data: {
      assetId: asset.id,
      action: "ALLOCATED",
      operator: "管理员A",
      employeeId: empA.id,
      fromStatus: "IDLE",
      toStatus: "IN_USE",
      createdAt: new Date("2026-09-02T10:00:00"),
    },
  });
  await prisma.lifecycleLog.create({
    data: {
      assetId: asset.id,
      action: "RETURNED",
      operator: "管理员B",
      employeeId: empB.id,
      fromStatus: "IN_USE",
      toStatus: "IDLE",
      createdAt: new Date("2026-09-03T10:00:00"),
    },
  });
  await prisma.lifecycleLog.create({
    data: {
      assetId: asset.id,
      action: "UPGRADED",
      operator: "系统",
      requestId: request.id,
      remark: "升级内存",
      createdAt: new Date("2026-09-04T10:00:00"),
    },
  });
}

describe("设备生命周期视图 getAssetLifecycleView", () => {
  beforeEach(async () => {
    // 全局 setup.ts 已清库，这里无需再清理
  });
  afterEach(() => setTestUser(null));

  it("a) 无权限(非 asset.manage)被拒", async () => {
    nobody();
    const res = await getAssetLifecycleView();
    expect(res.success).toBe(false);
    expect(unwrapError(res)).toContain("没有查看设备生命周期的权限");
  });

  it("b) 有权限返回生命周期行并按 createdAt 降序", async () => {
    boss();
    const env = await seedEnv();
    await seedLogs(env);

    const data = unwrap(await getAssetLifecycleView()).data;
    expect(data).toHaveLength(4);
    // 降序：最早排最后
    expect(data[0].createdAt.getTime()).toBe(new Date("2026-09-04T10:00:00").getTime());
    expect(data[3].createdAt.getTime()).toBe(new Date("2026-09-01T10:00:00").getTime());
    // 行字段存在
    expect(data[0].assetNo).toBe("DN-1001");
    expect(data[0].assetName).toBe("研发电脑");
  });

  it("c) 按部门/人员/时间段/操作类型筛选生效", async () => {
    boss();
    const env = await seedEnv();
    await seedLogs(env);

    // 部门：研发部（ALLOCATED 属 empA；CREATED/UPGRADED 无人员快照，回退到资产持有人 empA 的部门）
    const byDept = unwrap(await getAssetLifecycleView({ departmentId: String(env.deptA.id) })).data;
    expect(byDept.map((r) => r.action).sort()).toEqual(["ALLOCATED", "CREATED", "UPGRADED"]);
    expect(byDept.every((r) => r.departmentName === "研发部")).toBe(true);
    // 部门：市场部（仅 RETURNED 属 empB）
    const byDeptB = unwrap(await getAssetLifecycleView({ departmentId: String(env.deptB.id) })).data;
    expect(byDeptB.map((r) => r.action)).toEqual(["RETURNED"]);
    expect(byDeptB.every((r) => r.departmentName === "市场部")).toBe(true);

    // 人员：李四（empB）
    const byEmp = unwrap(await getAssetLifecycleView({ employeeId: String(env.empB.id) })).data;
    expect(byEmp).toHaveLength(1);
    expect(byEmp[0].action).toBe("RETURNED");

    // 时间段：仅 09-02 当天
    const byDate = unwrap(
      await getAssetLifecycleView({ dateFrom: "2026-09-02", dateTo: "2026-09-02" })
    ).data;
    expect(byDate.map((r) => r.action)).toEqual(["ALLOCATED"]);

    // 操作类型：RETURNED
    const byAction = unwrap(await getAssetLifecycleView({ actions: ["RETURNED"] })).data;
    expect(byAction).toHaveLength(1);
    expect(byAction[0].action).toBe("RETURNED");
  });

  it("d) requestId 关联申请单 info 带出", async () => {
    boss();
    const env = await seedEnv();
    await seedLogs(env);

    const data = unwrap(await getAssetLifecycleView()).data;
    const withReq = data.find((r) => r.request != null);
    expect(withReq).toBeDefined();
    expect(withReq!.action).toBe("UPGRADED");
    expect(withReq!.request!.requestNo).toBe("AP-TEST-001");
    expect(withReq!.request!.businessType).toBe("ASSET_UPGRADE");
    expect(withReq!.request!.title).toBe("研发电脑升级");
    expect(withReq!.request!.status).toBe("APPROVED");
  });

  it("e) 服务端分页：返回 total 且 data 只含当页", async () => {
    boss();
    const env = await seedEnv();
    // 造 4+ 条日志以触发分页
    await seedLogs(env); // 4 条
    await prisma.lifecycleLog.create({
      data: {
        assetId: env.asset.id,
        action: "TRANSFERRED",
        operator: "管理员C",
        employeeId: env.empA.id,
        createdAt: new Date("2026-09-05T10:00:00"),
      },
    });

    const page1 = unwrap(await getAssetLifecycleView({ page: 1, pageSize: 3 }));
    expect(page1.total).toBe(5);
    expect(page1.data).toHaveLength(3);
    // 降序，第一页应为最新 3 条（09-05 / 09-04 / 09-03）
    expect(page1.data[0].action).toBe("TRANSFERRED");

    const page2 = unwrap(await getAssetLifecycleView({ page: 2, pageSize: 3 }));
    expect(page2.total).toBe(5);
    expect(page2.data).toHaveLength(2);

    // 热新操作类型在前（DB 分页与部门过滤应一致，跨页不重复）
    const allActions = [...page1.data, ...page2.data].map((r) => r.action);
    expect(new Set(allActions).size).toBe(5);
  });

  it("f) 服务端分页：部门过滤下沉到 DB，total 正确", async () => {
    boss();
    const env = await seedEnv();
    await seedLogs(env); // 研发部 3 条（ALLOCATED/CREATED/UPGRADED），市场部 1 条（RETURNED）

    const byDept = unwrap(await getAssetLifecycleView({ departmentId: String(env.deptA.id) }));
    expect(byDept.total).toBe(3);
    expect(byDept.data.every((r) => r.departmentId === env.deptA.id)).toBe(true);
    expect(byDept.data.map((r) => r.action).sort()).toEqual(["ALLOCATED", "CREATED", "UPGRADED"]);

    // 部门过滤 + 分页组合：研发部第 1 页每页 2 条 → 2 条 + total 3
    const paged = unwrap(
      await getAssetLifecycleView({ departmentId: String(env.deptA.id), page: 1, pageSize: 2 })
    );
    expect(paged.total).toBe(3);
    expect(paged.data).toHaveLength(2);
  });
});