import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { login, changePassword, forceChangePassword } from "@/actions/auth.actions";
import { unwrapError } from "./helpers";

/**
 * 登录切片（TDD 三连桩点）
 * 背景：登录标识 = 工号（admin.username 即 employeeNo，唯一）；真实姓名仅展示；默认密码须首登强制改密。
 * S3a: 默认密码账号登录返回 mustChangePassword=true
 * S3b: 改密不能设回默认(123456/admin123)，成功即清 mustChangePassword
 * S3c: 登录返回真实姓名(employee.name)供展示
 */

const DEFAULT_PASSWORD = "123456";

async function seedAccount(opts?: {
  username?: string;
  password?: string;
  mustChangePassword?: boolean;
  employeeName?: string;
}) {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: {
      employeeNo: opts?.username ?? "E-10001",
      name: opts?.employeeName ?? "张三",
      departmentId: dept.id,
    },
  });
  return prisma.admin.create({
    data: {
      username: opts?.username ?? "E-10001",
      password: await bcrypt.hash(opts?.password ?? DEFAULT_PASSWORD, 4),
      employeeId: emp.id,
      isActive: true,
      mustChangePassword: opts?.mustChangePassword ?? false,
    },
  });
}

describe("登录切片 三连桩点", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  it("S3a 默认密码未改密账号登录 → 返回 mustChangePassword=true + 真实姓名", async () => {
    await seedAccount({ employeeName: "张三", mustChangePassword: true });
    const r = await login({ username: "E-10001", password: DEFAULT_PASSWORD });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.username).toBe("E-10001");
    expect(r.data.mustChangePassword).toBe(true);
    expect(r.data.displayName).toBe("张三");
  });

  it("S3c 已改密账号登录 → mustChangePassword=false + 姓名来自员工档案", async () => {
    await seedAccount({ employeeName: "李四", mustChangePassword: false });
    const r = await login({ username: "E-10001", password: DEFAULT_PASSWORD });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.mustChangePassword).toBe(false);
    expect(r.data.displayName).toBe("李四");
  });

  it("S3b 改密不能设回默认密码(123456) → 拒绝；设合法新密码成功后清 mustChangePassword", async () => {
    await seedAccount({ employeeName: "张三", mustChangePassword: true });
    const acc = await prisma.admin.findUniqueOrThrow({ where: { username: "E-10001" } });
    await setTestUser({ id: acc.id, username: acc.username });

    // 设回默认密码 → 拒绝
    const bad = await changePassword({ oldPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error).toContain("默认密码");

    // 设合法新密码 → 成功，且清除强制改密标记
    const ok = await changePassword({ oldPassword: DEFAULT_PASSWORD, newPassword: "NewPass2026!" });
    expect(ok.success).toBe(true);

    const after = await prisma.admin.findUniqueOrThrow({ where: { username: "E-10001" } });
    expect(after.mustChangePassword).toBe(false);
    // 新密码可正常登录
    expect(await bcrypt.compare("NewPass2026!", after.password)).toBe(true);
  });

  it("S3b 改密用错旧密码 → 拒绝", async () => {
    await seedAccount({ mustChangePassword: true });
    const acc = await prisma.admin.findUniqueOrThrow({ where: { username: "E-10001" } });
    await setTestUser({ id: acc.id, username: acc.username });
    const r = await changePassword({ oldPassword: "wrong-old", newPassword: "NewPass2026!" });
    expect(r.success).toBe(false);
  });

  it("S3d forceChangePassword 仅允许 mustChangePassword=true 的账号调用", async () => {
    // 未标记强制改密的账号直接调 forceChangePassword → 拒绝（服务端必须校验标记）
    await seedAccount({ mustChangePassword: false });
    const acc = await prisma.admin.findUniqueOrThrow({ where: { username: "E-10001" } });
    await setTestUser({ id: acc.id, username: acc.username });

    const r = await forceChangePassword({ newPassword: "NewPass2026!" });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("强制");
  });
});