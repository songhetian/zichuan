import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { getHandoverOrders } from "@/actions/approval-depart.actions";

// ============================================================
// 离职交接「对账」列表：资产管理员集中看待对账 / 已回收的交接单。
//
// 背景：终审通过后系统生成 PENDING 交接单，但此前只有「从离职单详情页进去」
// 才能看到它 —— 资产管理员得先知道是哪张单，等于要他挨个翻申请单。
// 这个列表页是回收流程的入口（权限点 asset.depart.handover.view）。
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, isSystem: true },
  });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "asset", name: p },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedAccount(username: string, roleKey: string, permissions: string[]) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({ data: { username, password: "x", roleId: role.id } });
}

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
  return admin;
}

/** 终止离职单 + 交接单（列表页只关心交接单本身，不必走完整审批链） */
async function seedHandover(opts: {
  orderNo: string;
  requestNo: string;
  employeeName: string;
  employeeNo: string;
  deptName: string;
  snapshot: { assetId: number; assetNo: string; name: string; status: string }[];
  status?: "PENDING" | "COLLECTED";
  createdAt?: Date;
}) {
  const dept = await prisma.department.upsert({
    where: { name: opts.deptName },
    update: {},
    create: { name: opts.deptName },
  });
  const emp = await prisma.employee.create({
    data: { employeeNo: opts.employeeNo, name: opts.employeeName, departmentId: dept.id },
  });
  const admin = await prisma.admin.findFirstOrThrow();
  const def =
    (await prisma.workflowDefinition.findFirst({ where: { businessType: "ASSET_DEPART" } })) ??
    (await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_DEPART",
        name: "离职流程",
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    }));
  const req = await prisma.approvalRequest.create({
    data: {
      requestNo: opts.requestNo,
      definitionId: def.id,
      businessType: "ASSET_DEPART",
      title: "员工离职交接",
      payload: { targetEmployeeId: emp.id, reason: "个人原因" },
      status: "APPROVED",
      initiatorId: admin.id,
      targetEmployeeId: emp.id,
      finishedAt: new Date(),
    },
  });
  const order = await prisma.handoverOrder.create({
    data: {
      orderNo: opts.orderNo,
      employeeId: emp.id,
      requestId: req.id,
      status: opts.status ?? "PENDING",
      assetSnapshot: opts.snapshot,
      createdAt: opts.createdAt,
    },
  });
  return { order, emp, dept, req };
}

describe("离职交接对账列表 getHandoverOrders", () => {
  beforeEach(async () => {
    await prisma.handoverOrder.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  it("列出待对账交接单：单号、离职员工与部门、应回收台数", async () => {
    const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
      "asset.manage",
      "asset.depart.view",
    ]);
    await seedHandover({
      orderNo: "HO-202609-0001",
      requestNo: "AP-202609-0001",
      employeeName: "张三",
      employeeNo: "E-001",
      deptName: "技术部",
      snapshot: [
        { assetId: 1, assetNo: "ZC-0001", name: "MacBook Pro 14", status: "IN_USE" },
        { assetId: 2, assetNo: "ZC-0002", name: "Dell U2723QE", status: "IN_USE" },
      ],
    });

    await login(assetMgr);
    const res = await getHandoverOrders();

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      orderNo: "HO-202609-0001",
      requestId: expect.any(Number),
      employeeName: "张三",
      employeeNo: "E-001",
      departmentName: "技术部",
      status: "PENDING",
      assetCount: 2,
      canConfirm: true,
    });
  });

  it("没有交接单查看权限的人被拒（对账单含他人设备明细，不放开给普通员工）", async () => {
    const staff = await seedAccount("staff", "EMPLOYEE", ["asset.view.own"]);
    await seedHandover({
      orderNo: "HO-202609-0002",
      requestNo: "AP-202609-0002",
      employeeName: "李四",
      employeeNo: "E-002",
      deptName: "技术部",
      snapshot: [{ assetId: 9, assetNo: "ZC-0009", name: "ThinkPad X1", status: "IN_USE" }],
    });

    await login(staff);
    const res = await getHandoverOrders();

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("权限");
  });

  it("可按状态筛：待对账只看 PENDING，已回收只看 COLLECTED", async () => {
    const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
      "asset.manage",
      "asset.depart.view",
    ]);
    await seedHandover({
      orderNo: "HO-202609-0003",
      requestNo: "AP-202609-0003",
      employeeName: "王五",
      employeeNo: "E-003",
      deptName: "技术部",
      snapshot: [{ assetId: 5, assetNo: "ZC-0005", name: "MacBook Air", status: "IN_USE" }],
      status: "PENDING",
    });
    await seedHandover({
      orderNo: "HO-202609-0004",
      requestNo: "AP-202609-0004",
      employeeName: "赵六",
      employeeNo: "E-004",
      deptName: "市场部",
      snapshot: [{ assetId: 6, assetNo: "ZC-0006", name: "Dell 显示器", status: "IN_USE" }],
      status: "COLLECTED",
    });

    await login(assetMgr);
    const pending = await getHandoverOrders({ status: "PENDING" });
    const collected = await getHandoverOrders({ status: "COLLECTED" });
    const all = await getHandoverOrders();

    expect(pending.success && pending.data.map((o) => o.orderNo)).toEqual(["HO-202609-0003"]);
    expect(collected.success && collected.data.map((o) => o.orderNo)).toEqual(["HO-202609-0004"]);
    expect(all.success && all.data).toHaveLength(2);
  });

  it("每行带交接单快照清单（管理员就地核对实物，不必跳详情页）", async () => {
    const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
      "asset.manage",
      "asset.depart.view",
    ]);
    await seedHandover({
      orderNo: "HO-202609-0007",
      requestNo: "AP-202609-0007",
      employeeName: "吴九",
      employeeNo: "E-009",
      deptName: "技术部",
      snapshot: [
        { assetId: 31, assetNo: "ZC-0031", name: "MacBook Pro 16", status: "IN_USE" },
        { assetId: 32, assetNo: "ZC-0032", name: "Dell U2723QE", status: "IN_MAINTENANCE" },
      ],
    });

    await login(assetMgr);
    const res = await getHandoverOrders();

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data[0].items.map((i) => i.assetNo)).toEqual(["ZC-0031", "ZC-0032"]);
    expect(res.data[0].items[1]).toMatchObject({ assetId: 32, name: "Dell U2723QE", status: "IN_MAINTENANCE" });
  });

  it("最新生成的交接单排在最前（管理员先处理新单）", async () => {
    const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
      "asset.manage",
      "asset.depart.view",
    ]);
    await seedHandover({
      orderNo: "HO-202609-0005",
      requestNo: "AP-202609-0005",
      employeeName: "孙七",
      employeeNo: "E-007",
      deptName: "技术部",
      snapshot: [{ assetId: 7, assetNo: "ZC-0007", name: "旧单设备", status: "IN_USE" }],
      createdAt: new Date("2026-09-01T02:00:00Z"),
    });
    await seedHandover({
      orderNo: "HO-202609-0006",
      requestNo: "AP-202609-0006",
      employeeName: "周八",
      employeeNo: "E-008",
      deptName: "技术部",
      snapshot: [{ assetId: 8, assetNo: "ZC-0008", name: "新单设备", status: "IN_USE" }],
      createdAt: new Date("2026-09-28T02:00:00Z"),
    });

    await login(assetMgr);
    const res = await getHandoverOrders({ status: "PENDING" });

    expect(res.success && res.data.map((o) => o.orderNo)).toEqual([
      "HO-202609-0006",
      "HO-202609-0005",
    ]);
  });
});
