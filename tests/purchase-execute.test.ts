import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { submitApprovalRequest, getMyTodoTasks, approveTask } from "@/actions/approval.actions";
import {
  executePurchaseOnApproval,
  purchasePayloadSchema,
} from "@/lib/approval-execute";

// ============================================================
// 提交（submitApprovalRequest）+ 终审自动入库（approveTask → executePurchaseOnApproval）
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
      create: { key: p, module: "approval", name: p },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedAccount(username: string, roleKey: string, permissions: string[], employeeId?: number) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({ data: { username, password: "x", roleId: role.id, employeeId } });
}

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
}

async function seedPurchaseEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id, managerId: mgrEmp.id },
  });

  const initiator = await seedAccount("buyer", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const model = await prisma.componentModel.create({
    data: { name: "DDR4-16G", categoryId: compCat.id },
  });
  await prisma.componentStock.create({ data: { modelId: model.id, quantity: 2 } });

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_PURCHASE",
      name: "加购配件流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      nodes: {
        create: [
          { nodeKey: "n1", name: "部门主管审批", type: "APPROVAL", sortOrder: 0, assigneeType: "DEPT_MANAGER" },
          { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
        ],
      },
    },
  });

  return { initiator, deptMgr, assetMgr, compCat, model, def, emp, dept };
}

async function approveNext() {
  const mine = await getMyTodoTasks();
  if (!mine.success) throw new Error("取待办失败");
  const task = mine.data[0];
  if (!task) throw new Error("无待办");
  const a = await approveTask({ taskId: task.id, comment: "同意" });
  if (!a.success) throw new Error(`审批失败：${a.error}`);
}

// ============================================================
// 加购配件（ASSET_PURCHASE）终审通过后自动入库
// ============================================================

async function seedApprovedPurchase(overrides?: {
  payload?: Record<string, unknown>;
  existingQuantity?: number;
}) {
  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const existingModel = await prisma.componentModel.create({
    data: { name: "DDR4-16G", categoryId: compCat.id },
  });
  await prisma.componentStock.create({
    data: { modelId: existingModel.id, quantity: overrides?.existingQuantity ?? 0 },
  });

  const req = await prisma.approvalRequest.create({
    data: {
      requestNo: "AP-PUR-0001",
      definitionId: (await prisma.workflowDefinition.create({
        data: {
          businessType: "ASSET_PURCHASE",
          name: "加购配件流程",
          version: 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      })).id,
      businessType: "ASSET_PURCHASE",
      title: "申请加购内存",
      status: "APPROVED",
      payload: (overrides?.payload ??
        ({
          componentCategoryId: compCat.id,
          modelId: existingModel.id,
          quantity: 5,
          unitPrice: 20,
          reason: "库存不足",
        })) as never,
      initiatorId: (await prisma.admin.create({
        data: { username: "buyer", password: "x" },
      })).id,
    },
  });

  return { compCat, existingModel, req };
}

async function runExec(reqId: number, payload: unknown) {
  return prisma.$transaction((tx) => executePurchaseOnApproval(tx, reqId, payload as never));
}

describe("executePurchaseOnApproval：加购自动入库", () => {
  beforeEach(async () => {
    // setup.ts 已清空各表；这里再清一次购买留痕（依赖 order 已建）
    await prisma.purchaseRecord.deleteMany();
  });

  it("选择现有型号 → 库存累加 + PURCHASE_IN 流水 + 采购留痕(金额=数量×单价)", async () => {
    const { existingModel, req } = await seedApprovedPurchase();

    await runExec(req.id, {
      componentCategoryId: existingModel.categoryId,
      modelId: existingModel.id,
      quantity: 5,
      unitPrice: 20,
      reason: "库存不足",
    });

    const stock = await prisma.componentStock.findUniqueOrThrow({
      where: { modelId: existingModel.id },
    });
    expect(stock.quantity).toBe(5); // 原 0 + 5

    const log = await prisma.componentStockLog.findFirstOrThrow({
      where: { modelId: existingModel.id, type: "PURCHASE_IN" },
    });
    expect(log.quantity).toBe(5);
    expect(log.remark).toContain("AP-PUR-0001");

    const rec = await prisma.purchaseRecord.findFirstOrThrow({ where: { requestId: req.id } });
    expect(rec.modelId).toBe(existingModel.id);
    expect(rec.modelName).toBe("DDR4-16G");
    expect(rec.quantity).toBe(5);
    expect(rec.amount?.toString()).toBe("100"); // 5 × 20
    expect(rec.orderNo).toMatch(/^PU-\d{6}-\d{4}$/);
  });

  it("现有库存累加而非覆盖：原 3 + 5 = 8", async () => {
    const { existingModel, req } = await seedApprovedPurchase({ existingQuantity: 3 });

    await runExec(req.id, {
      componentCategoryId: existingModel.categoryId,
      modelId: existingModel.id,
      quantity: 5,
      reason: "补货",
    });

    const stock = await prisma.componentStock.findUniqueOrThrow({
      where: { modelId: existingModel.id },
    });
    expect(stock.quantity).toBe(8);
  });

  it("全新配件（无库存记录） → 自动登记型号 + 重建库存 + 入库", async () => {
    const { compCat, req } = await seedApprovedPurchase();

    await runExec(req.id, {
      componentCategoryId: compCat.id,
      newModelName: "DDR5-32G",
      quantity: 10,
      unitPrice: 50,
      reason: "采购新型号",
    });

    const model = await prisma.componentModel.findUniqueOrThrow({
      where: { categoryId_name_brand: { categoryId: compCat.id, name: "DDR5-32G", brand: "" } },
    });
    const stock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: model.id } });
    expect(stock.quantity).toBe(10);

    const log = await prisma.componentStockLog.findFirstOrThrow({
      where: { modelId: model.id, type: "PURCHASE_IN" },
    });
    expect(log.quantity).toBe(10);

    const rec = await prisma.purchaseRecord.findFirstOrThrow({ where: { requestId: req.id } });
    expect(rec.modelName).toBe("DDR5-32G");
    expect(rec.quantity).toBe(10);
  });

  it("同一单重复执行 → 幂等：库存只累加一次，留痕仍为一条", async () => {
    const { existingModel, req } = await seedApprovedPurchase();

    const payload = {
      componentCategoryId: existingModel.categoryId,
      modelId: existingModel.id,
      quantity: 5,
      reason: "补货",
    };
    await runExec(req.id, payload);
    await runExec(req.id, payload);

    const stock = await prisma.componentStock.findUniqueOrThrow({
      where: { modelId: existingModel.id },
    });
    expect(stock.quantity).toBe(5); // 仅第一次累加
    const recs = await prisma.purchaseRecord.findMany({ where: { requestId: req.id } });
    expect(recs).toHaveLength(1);
  });

  it("payload 非法（缺少配件对象） → 抛错阻断（不写任何数据）", async () => {
    const { existingModel, req } = await seedApprovedPurchase();

    await expect(
      runExec(req.id, { componentCategoryId: existingModel.categoryId, reason: "缺对象" })
    ).rejects.toThrow("申请内容格式错误");

    const stock = await prisma.componentStock.findUniqueOrThrow({
      where: { modelId: existingModel.id },
    });
    expect(stock.quantity).toBe(0);
    expect(await prisma.purchaseRecord.count()).toBe(0);
  });

  it("全员配件登记品牌：不同品牌同名型号互不冲突，各自登记并入库", async () => {
    const { compCat, req } = await seedApprovedPurchase();

    // 同分类同名、不同品牌的两个全新配件
    await runExec(req.id, {
      componentCategoryId: compCat.id,
      newModelName: "DDR5-32G",
      brand: "金士顿",
      quantity: 4,
      reason: "金士顿补货",
    });
    const otherReq = await prisma.approvalRequest.create({
      data: {
        requestNo: "AP-PUR-0002",
        definitionId: (await prisma.workflowDefinition.findFirst({
          where: { businessType: "ASSET_PURCHASE" },
        }))!.id,
        businessType: "ASSET_PURCHASE",
        title: "补货三星",
        status: "APPROVED",
        payload: {
          componentCategoryId: compCat.id,
          newModelName: "DDR5-32G",
          brand: "三星",
          quantity: 6,
          reason: "三星补货",
        } as never,
        initiatorId: (await prisma.admin.create({ data: { username: "buyer2", password: "x" } })).id,
      },
    });
    await runExec(otherReq.id, {
      componentCategoryId: compCat.id,
      newModelName: "DDR5-32G",
      brand: "三星",
      quantity: 6,
      reason: "三星补货",
    });

    // 品牌为「分类+型号+品牌」唯一：两个品牌各生成一条型号与库存记录
    const models = await prisma.componentModel.findMany({
      where: { categoryId: compCat.id, name: "DDR5-32G" },
    });
    expect(models.map((m) => m.brand).sort()).toEqual(["三星", "金士顿"]);
    for (const m of models) {
      const stock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: m.id } });
      expect(stock.quantity).toBe(m.brand === "金士顿" ? 4 : 6);
    }
  });

  it("purchasePayloadSchema：必须且只能提供 modelId 或 newModelName 之一", () => {
    expect(purchasePayloadSchema.safeParse({ quantity: 1, reason: "x" }).success).toBe(false); // 缺对象
    expect(
      purchasePayloadSchema.safeParse({
        modelId: 1,
        newModelName: "双份",
        quantity: 1,
        reason: "x",
      }).success
    ).toBe(false); // 同时给两者
    expect(
      purchasePayloadSchema.safeParse({ modelId: 1, quantity: 0, reason: "x" }).success
    ).toBe(false); // 数量必须为正
    expect(
      purchasePayloadSchema.safeParse({ newModelName: "新品", quantity: 1 }).success
    ).toBe(false); // 缺 reason
  });
});

describe("ASSET_PURCHASE 提交 → 终审自动入库", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.purchaseRecord.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.componentStockLog.deleteMany();
    await prisma.componentStock.deleteMany();
    await prisma.componentModel.deleteMany();
    await prisma.componentCategory.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  it("提交加购（选现有型号）→ 逐节点通过 → 终审自动累加库存 + 留痕", async () => {
    const { initiator, deptMgr, assetMgr, compCat, model } = await seedPurchaseEnv();

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "申请加购内存",
      businessType: "ASSET_PURCHASE" as never,
      payload: { componentCategoryId: compCat.id, modelId: model.id, quantity: 5, unitPrice: 20, reason: "库存不足" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;
    expect(s.data.status).toBe("PENDING");

    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    // 终态 APPROVED + 自动型（finalNodeRole 空，不进待执行）+ EXECUTE 日志
    const full = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: s.data.id },
      include: { logs: true },
    });
    expect(full.status).toBe("APPROVED");
    expect(full.finalNodeRole).toBeNull();
    expect(full.logs.map((l) => l.action)).toContain("EXECUTE");

    // 库存自动累加：原 2 + 5 = 7
    const stock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: model.id } });
    expect(stock.quantity).toBe(7);
    const rec = await prisma.purchaseRecord.findFirstOrThrow({ where: { requestId: s.data.id } });
    expect(rec.quantity).toBe(5);
  });

  it("新建配件同名去重：名称已存在 → 拒绝提交并提示复用现有型号", async () => {
    const { initiator, compCat, model } = await seedPurchaseEnv();

    await login(initiator);
    const r = await submitApprovalRequest({
      title: "加购新名称实为旧型号",
      businessType: "ASSET_PURCHASE" as never,
      payload: { componentCategoryId: compCat.id, newModelName: model.name, quantity: 3, reason: "错觉" },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("已存在");
  });

  it("无已发布加购流程 → 拒绝提交", async () => {
    const { initiator, compCat, model } = await seedPurchaseEnv();
    await prisma.workflowDefinition.deleteMany({ where: { businessType: "ASSET_PURCHASE" } });

    await login(initiator);
    const r = await submitApprovalRequest({
      title: "加购",
      businessType: "ASSET_PURCHASE" as never,
      payload: { componentCategoryId: compCat.id, modelId: model.id, quantity: 1, reason: "无流程" },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("审批流程");
  });
});