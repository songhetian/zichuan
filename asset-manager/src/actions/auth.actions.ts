"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1, "新密码不能为空"),
});

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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
    return { success: false, error: "参数错误" };
  }

  await ensureAdminExists();

  const admin = await prisma.admin.findUnique({
    where: { username: validated.data.username },
  });
  if (!admin) {
    return { success: false, error: "用户不存在" };
  }

  const valid = await bcrypt.compare(validated.data.password, admin.password);
  if (!valid) {
    return { success: false, error: "密码错误" };
  }

  return { success: true, data: { username: admin.username } };
}

export async function changePassword(
  input: z.infer<typeof changePasswordSchema>
): Promise<ActionResult<{ success: true }>> {
  const validated = changePasswordSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

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
}
