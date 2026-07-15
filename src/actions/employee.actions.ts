"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  employeeNo: z.string().min(1, "工号不能为空"),
  name: z.string().min(1, "姓名不能为空"),
  departmentId: z.number(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

const updateSchema = z.object({
  employeeNo: z.string().min(1, "工号不能为空").optional(),
  name: z.string().min(1, "姓名不能为空").optional(),
  departmentId: z.number().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const querySchema = z.object({
  departmentId: z.number().optional(),
  keyword: z.string().optional(),
});

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type EmployeeWithDept = {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  phone: string | null;
  email: string | null;
  assetCount: number;
};

function formatEmployee(emp: any): EmployeeWithDept {
  return {
    id: emp.id,
    employeeNo: emp.employeeNo,
    name: emp.name,
    departmentId: emp.departmentId,
    departmentName: emp.department?.name ?? "",
    phone: emp.phone ?? null,
    email: emp.email ?? null,
    assetCount: emp._count?.assets ?? 0,
  };
}

export async function createEmployee(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { employeeNo, name, departmentId, phone, email } = validated.data;

  // 检查部门是否存在
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) {
    return { success: false, error: "部门不存在" };
  }

  try {
    const emp = await prisma.employee.create({
      data: {
        employeeNo,
        name,
        departmentId,
        phone: phone ?? null,
        email: email ?? null,
      },
      include: { department: { select: { name: true } } },
    });
    return { success: true, data: formatEmployee(emp) };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "工号已存在" };
    }
    return { success: false, error: "创建失败" };
  }
}

export async function getEmployees(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<EmployeeWithDept[]>> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { departmentId, keyword } = validated.data;

  const where: any = {};
  if (departmentId != null) {
    where.departmentId = departmentId;
  }
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { employeeNo: { contains: keyword } },
    ];
  }

  const emps = await prisma.employee.findMany({
    where,
    orderBy: { id: "asc" },
    include: {
      department: { select: { name: true } },
      _count: { select: { assets: true } },
    },
  });

  return { success: true, data: emps.map(formatEmployee) };
}

export async function getEmployeeById(
  id: number
): Promise<ActionResult<EmployeeWithDept>> {
  const emp = await prisma.employee.findUnique({
    where: { id },
    include: { department: { select: { name: true } } },
  });
  if (!emp) {
    return { success: false, error: "员工不存在" };
  }
  return { success: true, data: formatEmployee(emp) };
}

export async function updateEmployee(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "员工不存在" };
  }

  // 如果改部门，检查新部门是否存在
  if (validated.data.departmentId != null) {
    const dept = await prisma.department.findUnique({
      where: { id: validated.data.departmentId },
    });
    if (!dept) {
      return { success: false, error: "目标部门不存在" };
    }
  }

  try {
    const emp = await prisma.employee.update({
      where: { id },
      data: validated.data,
      include: { department: { select: { name: true } } },
    });
    return { success: true, data: formatEmployee(emp) };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "工号已存在" };
    }
    return { success: false, error: "更新失败" };
  }
}

export type EmployeeAsset = {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  templateName: string;
  categoryName: string;
};

export async function getEmployeeAssets(
  employeeId: number
): Promise<ActionResult<EmployeeAsset[]>> {
  const assets = await prisma.asset.findMany({
    where: { employeeId },
    select: {
      id: true,
      assetNo: true,
      name: true,
      status: true,
      template: { select: { name: true, category: { select: { name: true } } } },
    },
    orderBy: { id: "asc" },
  });

  return {
    success: true,
    data: assets.map((a) => ({
      id: a.id,
      assetNo: a.assetNo,
      name: a.name,
      status: a.status,
      templateName: a.template.name,
      categoryName: a.template.category.name,
    })),
  };
}

export async function deleteEmployee(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "员工不存在" };
  }

  // 检查是否有关联设备
  const assetCount = await prisma.asset.count({
    where: { employeeId: id },
  });
  if (assetCount > 0) {
    return { success: false, error: "该员工有关联设备，无法删除" };
  }

  await prisma.employee.delete({ where: { id } });
  return { success: true, data: { id } };
}
