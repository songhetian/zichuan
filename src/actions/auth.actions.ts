"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createSession, destroySession, requireAuth } from "@/lib/auth";

const loginSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
  remember: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "旧密码不能为空"),
  newPassword: z.string().min(1, "新密码不能为空"),
});

async function ensureAdminExists(): Promise<void> {
  const count = await prisma.admin.count();
  if (count === 0) {
    const hashed = await bcrypt.hash("admin123", 10);
    await prisma.admin.create({
      data: { username: "admin", password: hashed, mustChangePassword: true },
    });
  }
}

/** 不允许被设置回默认密码（首登强制改密：不能停留在默认密码上） */
const DEFAULT_PASSWORDS = new Set(["123456", "admin123"]);

export async function login(
  input: z.infer<typeof loginSchema>
): Promise<ActionResult<{ username: string; displayName: string; mustChangePassword: boolean }>> {
  const validated = loginSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  try {
    await ensureAdminExists();

    const admin = await prisma.admin.findUnique({
      where: { username: validated.data.username },
      include: { employee: { select: { name: true } } },
    });
    if (!admin) {
      return { success: false, error: "用户名或密码错误" };
    }
    if (!admin.isActive) {
      return { success: false, error: "账号已停用，请联系管理员" };
    }

    const valid = await bcrypt.compare(validated.data.password, admin.password);
    if (!valid) {
      return { success: false, error: "用户名或密码错误" };
    }

    await createSession(admin.id, admin.username, validated.data.remember === true);

    const displayName = admin.displayName ?? admin.employee?.name ?? admin.username;
    return {
      success: true,
      data: {
        username: admin.username,
        displayName,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  } catch (e) {
    return { success: false, error: "登录失败，请稍后重试" };
  }
}

export async function logout(): Promise<ActionResult<{ success: true }>> {
  await requireAuth();
  await destroySession();
  return { success: true, data: { success: true } };
}

export async function changePassword(
  input: z.infer<typeof changePasswordSchema>
): Promise<ActionResult<{ success: true }>> {
  await requireAuth();
  const validated = changePasswordSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  try {
    // 仅允许修改当前登录账号的密码，避免 findFirst 误改他人/首条管理员
    const user = await requireAuth();
    const admin = await prisma.admin.findUnique({ where: { id: user.id } });
    if (!admin) {
      return { success: false, error: "管理员不存在" };
    }

    const valid = await bcrypt.compare(validated.data.oldPassword, admin.password);
    if (!valid) {
      return { success: false, error: "旧密码不正确" };
    }

    // 不允许停留在默认密码上（首登强制改密）
    if (DEFAULT_PASSWORDS.has(validated.data.newPassword)) {
      return { success: false, error: "新密码不能与默认密码相同" };
    }

    const hashed = await bcrypt.hash(validated.data.newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashed, mustChangePassword: false },
    });

    return { success: true, data: { success: true } };
  } catch (e) {
    return { success: false, error: "修改密码失败，请稍后重试" };
  }
}
