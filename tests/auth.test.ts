import { describe, it, expect, beforeEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { login, changePassword } from "@/actions/auth.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

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
      expect(unwrapError(result)).toContain("用户名或密码错误");
    });
  });

  describe("changePassword", () => {
    it("可以修改密码", async () => {
      await login({ username: "admin", password: "admin123" });
      setTestUser({ id: 1, username: "admin" });

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
      setTestUser({ id: 1, username: "admin" });

      const result = await changePassword({
        oldPassword: "wrong",
        newPassword: "newPass456",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("旧密码");

      setTestUser(null);
    });

    it("新密码不能为空", async () => {
      setTestUser({ id: 1, username: "admin" });

      const result = await changePassword({
        oldPassword: "admin123",
        newPassword: "",
      });

      expect(result.success).toBe(false);

      setTestUser(null);
    });
  });
});
