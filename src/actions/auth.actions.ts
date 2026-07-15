"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const loginSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
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
      data: { username: "admin", password: hashed },
    });
  }
}

export async function login(
  input: z.infer<typeof loginSchema>
): Promise<ActionResult<{ username: string }>> {
  const validated = loginSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  try {
    await ensureAdminExists();

    const admin = await prisma.admin.findUnique({
      where: { username: validated.data.username },
    });
    if (!admin) {
      return { success: false, error: "用户名或密码错误" };
    }

    const valid = await bcrypt.compare(validated.data.password, admin.password);
    if (!valid) {
      return { success: false, error: "用户名或密码错误" };
    }

    return { success: true, data: { username: admin.username } };
  } catch (e) {
    return { success: false, error: "登录失败，请稍后重试" };
  }
}

export async function changePassword(
  input: z.infer<typeof changePasswordSchema>
): Promise<ActionResult<{ success: true }>> {
  const validated = changePasswordSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  try {
    const admin = await prisma.admin.findFirst();
    if (!admin) {
      return { success: false, error: "管理员不存在" };
    }

    const valid = await bcrypt.compare(validated.data.oldPassword, admin.password);
    if (!valid) {
      return { success: false, error: "旧密码不正确" };
    }

    const hashed = await bcrypt.hash(validated.data.newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashed },
    });

    return { success: true, data: { success: true } };
  } catch (e) {
    return { success: false, error: "修改密码失败，请稍后重试" };
  }
}
