import { describe, it, expect, beforeEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { login, changePassword } from "@/actions/auth.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser, assertActiveAccount, resolveSessionMaxAge } from "@/lib/auth";

describe("简单登录认证", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
  });

  describe("login", () => {
    it("默认密码 admin123 可以登录", async () => {
      const result = await login({ username: "admin", password: "admin123" });

      expect(result.success).toBe(true);
    });

    it("密码错误时登录失败", async () => {
      const result = await login({ username: "admin", password: "wrong" });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("密码错误");
    });

    it("用户名不存在时登录失败", async () => {
      const result = await login({ username: "nobody", password: "admin123" });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("工号或密码错误");
    });
  });

  describe("changePassword", () => {
    it("可以修改密码", async () => {
      await login({ username: "admin", password: "admin123" });
      const admin = await prisma.admin.findUniqueOrThrow({ where: { username: "admin" } });
      setTestUser({ id: admin.id, username: "admin" });

      const result = await changePassword({
        oldPassword: "admin123",
        newPassword: "newPass456",
      });

      expect(result.success).toBe(true);

      // 旧密码不再有效
      const oldLogin = await login({ username: "admin", password: "admin123" });
      expect(oldLogin.success).toBe(false);

      // 新密码有效
      const newLogin = await login({ username: "admin", password: "newPass456" });
      expect(newLogin.success).toBe(true);

      setTestUser(null);
    });

    it("旧密码不正确时修改失败", async () => {
      await login({ username: "admin", password: "admin123" });
      const admin = await prisma.admin.findUniqueOrThrow({ where: { username: "admin" } });
      setTestUser({ id: admin.id, username: "admin" });

      const result = await changePassword({
        oldPassword: "wrong",
        newPassword: "newPass456",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("旧密码");

      setTestUser(null);
    });

    it("新密码不能为空", async () => {
      // zod 先于查库校验，空密码在读取管理员前即返回，无需真实 admin
      setTestUser({ id: 999, username: "admin" });

      const result = await changePassword({
        oldPassword: "admin123",
        newPassword: "",
      });

      expect(result.success).toBe(false);

      setTestUser(null);
    });

    it("只修改当前登录账号的密码，而非数据库首条管理员", async () => {
      // 预置：先创建首条 admin，再创建第二个账号 second（各自独立密码）
      const adminLogin = await login({ username: "admin", password: "admin123" });
      expect(adminLogin.success).toBe(true);
      await prisma.admin.create({
        data: {
          username: "second",
          password: "$2b$10$PnNTS/jj8nXF9cwYbZoqqus7QCLnQ4DtFqSfeeGZ./svyeuRH1x5u", // = "second-pw"
        },
      });
      const second = await prisma.admin.findUniqueOrThrow({ where: { username: "second" } });
      // 以 second 身份登录（模拟当前登录账号就是 second）
      setTestUser({ id: second.id, username: "second" });

      const result = await changePassword({
        oldPassword: "second-pw",
        newPassword: "newSecond456",
      });
      expect(result.success).toBe(true);

      // second 的密码更新成功
      const secondLogin = await login({ username: "second", password: "newSecond456" });
      expect(secondLogin.success).toBe(true);

      // 首条 admin 的密码不应被改动（仍能用自己的旧密码登录）
      const adminOldPw = await login({ username: "admin", password: "admin123" });
      expect(adminOldPw.success).toBe(true);

      setTestUser(null);
    });
  });

  describe("assertActiveAccount", () => {
    beforeEach(async () => {
      await prisma.admin.deleteMany();
    });

    it("活动账号（isActive=true）校验通过", async () => {
      const admin = await prisma.admin.create({
        data: { username: "active", password: "x", isActive: true },
      });
      await expect(assertActiveAccount(admin.id)).resolves.toBeUndefined();
    });

    it("停用账号（isActive=false）抛 UNAUTHORIZED，拒绝其会话继续操作", async () => {
      const admin = await prisma.admin.create({
        data: { username: "disabled", password: "x", isActive: false },
      });
      await expect(assertActiveAccount(admin.id)).rejects.toThrow("UNAUTHORIZED");
    });

    it("账号不存在时抛 UNAUTHORIZED", async () => {
      await expect(assertActiveAccount(999999)).rejects.toThrow("UNAUTHORIZED");
    });
  });

  describe("resolveSessionMaxAge（记住我）", () => {
    it("勾选记住我 → cookie 时长 30 天（30*24*3600 秒）", () => {
      expect(resolveSessionMaxAge(true)).toBe(30 * 24 * 60 * 60);
    });

    it("未勾选记住我 → 保持常规 8 小时（8*3600 秒）", () => {
      expect(resolveSessionMaxAge(false)).toBe(8 * 60 * 60);
    });
  });
});
