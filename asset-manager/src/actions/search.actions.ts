"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

const searchSchema = z.object({
  keyword: z.string().min(1, "搜索关键词不能为空"),
  limit: z.number().int().positive().max(50).default(10),
});

type SearchResult = {
  id: number;
  type: "asset" | "employee" | "template" | "component";
  title: string;
  subtitle: string;
  href: string;
};

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function globalSearch(
  input: z.infer<typeof searchSchema>
): Promise<ActionResult<SearchResult[]>> {
  const validated = searchSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { keyword, limit } = validated.data;
  const results: SearchResult[] = [];

  try {
    // 搜索设备
    const assets = await prisma.asset.findMany({
      where: {
        OR: [
          { assetNo: { contains: keyword } },
          { name: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        assetNo: true,
        name: true,
        status: true,
        employee: { select: { name: true } },
      },
      take: limit,
    });

    results.push(
      ...assets.map((a) => ({
        id: a.id,
        type: "asset" as const,
        title: `${a.assetNo} - ${a.name}`,
        subtitle: `状态: ${a.status}${a.employee?.name ? ` | 使用人: ${a.employee.name}` : ""}`,
        href: `/assets/${a.id}`,
      }))
    );

    // 搜索员工
    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          { employeeNo: { contains: keyword } },
          { name: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        department: { select: { name: true } },
      },
      take: limit,
    });

    results.push(
      ...employees.map((e) => ({
        id: e.id,
        type: "employee" as const,
        title: `${e.employeeNo} - ${e.name}`,
        subtitle: `部门: ${e.department.name}`,
        href: `/employees`,
      }))
    );

    // 搜索设备模板
    const templates = await prisma.deviceTemplate.findMany({
      where: {
        name: { contains: keyword },
      },
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
      },
      take: limit,
    });

    results.push(
      ...templates.map((t) => ({
        id: t.id,
        type: "template" as const,
        title: t.name,
        subtitle: `分类: ${t.category.name}`,
        href: `/templates`,
      }))
    );

    // 搜索配件型号
    const components = await prisma.componentModel.findMany({
      where: {
        OR: [
          { name: { contains: keyword } },
          { brand: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        name: true,
        brand: true,
        category: { select: { name: true } },
      },
      take: limit,
    });

    results.push(
      ...components.map((c) => ({
        id: c.id,
        type: "component" as const,
        title: c.brand ? `${c.name} (${c.brand})` : c.name,
        subtitle: `分类: ${c.category.name}`,
        href: `/components/models`,
      }))
    );

    return { success: true, data: results };
  } catch (error) {
    console.error("全局搜索失败:", error);
    return { success: false, error: "搜索失败，请稍后重试" };
  }
}
