import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  getMyCcRecords,
  getCcRecordFilterOptions,
  getApprovalRequestById,
} from "@/actions/approval.actions";
import { exportCcRecordsToExcel } from "@/actions/excel.actions";
import * as XLSX from "xlsx";

// ============================================================
// 「我的抄送」(/approvals/cc)
// Seam：getMyCcRecords / getCcRecordFilterOptions / exportCcRecordsToExcel
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
  return prisma.admin.create({
    data: { username, password: "x", roleId: role.id, employeeId },
  });
}

/** 最小环境：一个部门 + 发起人 + 抄送查看人 + 抄送导出人 + 无关账号 + 配件类型 */
async function seedEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id },
  });
  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  // 仅单点授权，避免模块级权限展开带出其他权限
  const ccViewer = await seedAccount("ccviewer", "CC_VIEWER", ["approval.cc.view"]);
  const ccExporter = await seedAccount("ccexporter", "CC_EXPORTER", [
    "approval.cc.view",
    "approval.cc.export",
  ]);
  const outsider = await seedAccount("outsider", "OUTSIDER", ["approval.submit"]);
  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  return { dept, emp, initiator, ccViewer, ccExporter, outsider, compCat };
}

async function defFor(businessType: string) {
  const found = await prisma.workflowDefinition.findFirst({
    where: { businessType: businessType as never, version: 1 },
  });
  if (found) return found;
  return prisma.workflowDefinition.create({
    data: {
      businessType: businessType as never,
      name: `${businessType} 流程`,
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
}

/** 造一张申请单（不写通知），返回申请单 */
async function seedRequest(opts: {
  initiatorId: number;
  requestNo: string;
  title: string;
  businessType?: string;
  componentCategoryId?: number | null;
  status?: string;
}) {
  const def = await defFor(opts.businessType ?? "ASSET_SCRAP");
  return prisma.approvalRequest.create({
    data: {
      requestNo: opts.requestNo,
      definitionId: def.id,
      businessType: (opts.businessType ?? "ASSET_SCRAP") as never,
      title: opts.title,
      status: (opts.status ?? "PENDING") as never,
      componentCategoryId: opts.componentCategoryId ?? null,
      payload: {} as never,
      initiatorId: opts.initiatorId,
    },
  });
}

/** 造一条抄送通知（同一单可造多条，模拟逐节点抄送） */
async function seedCc(requestId: number, adminId: number, createdAt: Date) {
  return prisma.notification.create({
    data: {
      adminId,
      requestId,
      type: "APPROVAL_CC",
      title: "审批抄送",
      content: "（知会）",
      createdAt,
    },
  });
}

async function cleanup() {
  await prisma.notification.deleteMany();
  await prisma.approvalTask.deleteMany();
  await prisma.approvalLog.deleteMany();
  await prisma.lifecycleLog.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.assetComponent.deleteMany();
  await prisma.componentStockLog.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.deviceTemplate.deleteMany();
  await prisma.assetCategory.deleteMany();
  await prisma.componentStock.deleteMany();
  await prisma.componentModel.deleteMany();
  await prisma.componentCategory.deleteMany();
  await prisma.workflowNode.deleteMany();
  await prisma.workflowDefinition.deleteMany();
  await prisma.adminDepartment.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
}

beforeEach(cleanup);
afterEach(() => setTestUser(null));

describe("我的抄送：getMyCcRecords 按单去重 + 抄送时间取最早", () => {
  it("无 approval.cc.view 权限 → 拒绝", async () => {
    const { outsider } = await seedEnv();
    setTestUser({ id: outsider.id, username: outsider.username });
    const r = await getMyCcRecords();
    expect(r.success).toBe(false);
  });

  it("同一单被多节点抄送：只出现一行，抄送时间取最早", async () => {
    const { initiator, ccViewer } = await seedEnv();
    const req = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0001", title: "报废电脑" });
    await seedCc(req.id, ccViewer.id, new Date("2026-09-10T09:00:00"));
    await seedCc(req.id, ccViewer.id, new Date("2026-09-12T15:00:00"));

    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getMyCcRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0].requestId).toBe(req.id);
    expect(new Date(r.data[0].ccAt).toISOString()).toBe(new Date("2026-09-10T09:00:00").toISOString());
  });

  it("只返回抄送给我的单：抄送给别人的不出现", async () => {
    const { initiator, ccViewer, outsider } = await seedEnv();
    const mine = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0002", title: "抄送给我" });
    const other = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0003", title: "抄送给他" });
    await seedCc(mine.id, ccViewer.id, new Date("2026-09-11T10:00:00"));
    await seedCc(other.id, outsider.id, new Date("2026-09-11T10:00:00"));

    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getMyCcRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.map((x) => x.requestId)).toEqual([mine.id]);
  });

  it("行内带出单号/标题/业务类型/状态/发起人/部门/配件类型", async () => {
    const { initiator, ccViewer, compCat, dept } = await seedEnv();
    const req = await seedRequest({
      initiatorId: initiator.id,
      requestNo: "AP-CC-0004",
      title: "升级内存",
      businessType: "ASSET_UPGRADE",
      componentCategoryId: compCat.id,
      status: "APPROVED",
    });
    await seedCc(req.id, ccViewer.id, new Date("2026-09-13T10:00:00"));

    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getMyCcRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    const row = r.data[0];
    expect(row.requestNo).toBe("AP-CC-0004");
    expect(row.title).toBe("升级内存");
    expect(row.businessType).toBe("ASSET_UPGRADE");
    expect(row.status).toBe("APPROVED");
    expect(row.initiatorName).toBe("申请员工");
    expect(row.departmentId).toBe(dept.id);
    expect(row.departmentName).toBe("技术部");
    expect(row.componentCategoryName).toBe("内存");
  });
});

describe("我的抄送：筛选（关键字 / 部门 / 人员 / 配件类型 / 业务类型 / 日期区间）", () => {
  async function seedFilterRows() {
    const env = await seedEnv();
    const deptB = await prisma.department.create({ data: { name: "市场部" } });
    const empB = await prisma.employee.create({
      data: { employeeNo: "E-B", name: "市场员工", departmentId: deptB.id },
    });
    const initiatorB = await seedAccount("initiatorB", "EMPLOYEE_B", ["approval.submit"], empB.id);

    const upgrade = await seedRequest({
      initiatorId: env.initiator.id,
      requestNo: "AP-D-0001",
      title: "升级内存",
      businessType: "ASSET_UPGRADE",
      componentCategoryId: env.compCat.id,
    });
    const scrap = await seedRequest({
      initiatorId: initiatorB.id,
      requestNo: "AP-D-0002",
      title: "报废机箱",
      businessType: "ASSET_SCRAP",
    });
    await seedCc(upgrade.id, env.ccViewer.id, new Date("2026-09-05T10:00:00"));
    await seedCc(scrap.id, env.ccViewer.id, new Date("2026-09-20T10:00:00"));
    return { ...env, deptB, empB, initiatorB, upgrade, scrap };
  }

  it("按关键字（单号 / 标题）筛选", async () => {
    const { ccViewer, upgrade, scrap } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });

    const byNo = await getMyCcRecords({ keyword: "AP-D-0001" });
    expect(byNo.success).toBe(true);
    if (!byNo.success) return;
    expect(byNo.data.map((x) => x.requestId)).toEqual([upgrade.id]);

    const byTitle = await getMyCcRecords({ keyword: "机箱" });
    expect(byTitle.success).toBe(true);
    if (!byTitle.success) return;
    expect(byTitle.data.map((x) => x.requestId)).toEqual([scrap.id]);
  });

  it("按部门（发起人所属部门）与人员（发起人）筛选", async () => {
    const { ccViewer, initiator, deptB, upgrade, scrap } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });

    const byDept = await getMyCcRecords({ departmentId: deptB.id });
    expect(byDept.success).toBe(true);
    if (!byDept.success) return;
    expect(byDept.data.map((x) => x.requestId)).toEqual([scrap.id]);

    const byPerson = await getMyCcRecords({ initiatorId: initiator.id });
    expect(byPerson.success).toBe(true);
    if (!byPerson.success) return;
    expect(byPerson.data.map((x) => x.requestId)).toEqual([upgrade.id]);
  });

  it("按配件类型与业务类型筛选", async () => {
    const { ccViewer, compCat, upgrade, scrap } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });

    const byCat = await getMyCcRecords({ componentCategoryId: compCat.id });
    expect(byCat.success).toBe(true);
    if (!byCat.success) return;
    expect(byCat.data.map((x) => x.requestId)).toEqual([upgrade.id]);

    const byType = await getMyCcRecords({ businessType: "ASSET_SCRAP" });
    expect(byType.success).toBe(true);
    if (!byType.success) return;
    expect(byType.data.map((x) => x.requestId)).toEqual([scrap.id]);
  });

  it("按日期区间筛选（以抄送时间为准）", async () => {
    const { ccViewer, upgrade, scrap } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });

    const recent = await getMyCcRecords({ dateFrom: "2026-09-15" });
    expect(recent.success).toBe(true);
    if (!recent.success) return;
    expect(recent.data.map((x) => x.requestId)).toEqual([scrap.id]);

    const inRange = await getMyCcRecords({ dateFrom: "2026-09-01", dateTo: "2026-09-10" });
    expect(inRange.success).toBe(true);
    if (!inRange.success) return;
    expect(inRange.data.map((x) => x.requestId)).toEqual([upgrade.id]);
  });

  it("结果按抄送时间倒序", async () => {
    const { ccViewer, upgrade, scrap } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getMyCcRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.map((x) => x.requestId)).toEqual([scrap.id, upgrade.id]);
  });

  it("筛选下拉数据：部门 / 发起人 / 配件类型", async () => {
    const { ccViewer, initiator, dept, compCat } = await seedFilterRows();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getCcRecordFilterOptions();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.departments.map((d) => d.id)).toContain(dept.id);
    expect(r.data.initiators.map((i) => i.id)).toContain(initiator.id);
    expect(r.data.componentCategories.map((c) => c.id)).toContain(compCat.id);
    // 从未发起过申请单的账号不出现在下拉里
    expect(r.data.initiators.map((i) => i.name)).not.toContain("ccviewer");
  });

  it("无 approval.cc.view 权限 → 筛选下拉同样拒绝", async () => {
    const { outsider } = await seedFilterRows();
    setTestUser({ id: outsider.id, username: outsider.username });
    const r = await getCcRecordFilterOptions();
    expect(r.success).toBe(false);
  });
});

describe("申请单详情：抄送人可查看（IDOR 守卫放行）", () => {
  it("仅被抄送的账号可查看该申请单详情", async () => {
    const { initiator, ccViewer } = await seedEnv();
    const req = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0005", title: "抄送可看" });
    await seedCc(req.id, ccViewer.id, new Date("2026-09-14T10:00:00"));

    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await getApprovalRequestById(req.id);
    expect(r.success).toBe(true);
  });

  it("无关账号仍拒绝（不泄露申请单是否存在）", async () => {
    const { initiator, outsider } = await seedEnv();
    const req = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0006", title: "无关不可看" });

    setTestUser({ id: outsider.id, username: outsider.username });
    const r = await getApprovalRequestById(req.id);
    expect(r.success).toBe(false);
  });

  it("仅持待办/结果通知（非抄送）不构成查看依据", async () => {
    const { initiator, outsider } = await seedEnv();
    const req = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0007", title: "非抄送通知" });
    await prisma.notification.create({
      data: { adminId: outsider.id, requestId: req.id, type: "APPROVAL_RESULT", title: "审批结果" },
    });

    setTestUser({ id: outsider.id, username: outsider.username });
    const r = await getApprovalRequestById(req.id);
    expect(r.success).toBe(false);
  });
});

describe("导出：approval.cc.export 权限 + xlsx 产出", () => {
  it("无 approval.cc.export 权限 → 拒绝导出", async () => {
    const { ccViewer } = await seedEnv();
    setTestUser({ id: ccViewer.id, username: ccViewer.username });
    const r = await exportCcRecordsToExcel();
    expect(r.success).toBe(false);
  });

  it("有导出权限 → 产出 xlsx，含抄送给我的单", async () => {
    const { initiator, ccExporter } = await seedEnv();
    const req = await seedRequest({ initiatorId: initiator.id, requestNo: "AP-CC-0008", title: "导出抄送单" });
    await seedCc(req.id, ccExporter.id, new Date("2026-09-16T10:00:00"));

    setTestUser({ id: ccExporter.id, username: ccExporter.username });
    const r = await exportCcRecordsToExcel();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.fileName).toContain("抄送");

    const wb = XLSX.read(Buffer.from(r.data.buffer), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["单号"]).toBe("AP-CC-0008");
  });
});
