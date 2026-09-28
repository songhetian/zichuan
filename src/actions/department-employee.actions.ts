"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, SessionUser } from "@/lib/auth";
import { hasPermission, resolveDepartmentScope } from "@/lib/permissions";
import { generateEmployeeNo } from "@/lib/employee-no";
import { handleUniqueViolation } from "@/lib/prisma-error";
import bcrypt from "bcryptjs";

// ============================================================
// 员工管理（部门主管弹窗）：添加/修改/分配设备编码/标记离职
// 数据范围守卫：
//   - 拥有「账号与权限管理」(system.account.manage) → 不受部门限制
//   - 设置了账号级部门范围（SPEC/EXACT）或拥有 asset.manage → 走统一口径 resolveDepartmentScope
//   - 否则必须拥有「本部门数据可见」(dept.data.view)，且目标员工必须在本人主管的部门内
// 离职联动：Employee.status→LEFT、绑定账号停用、名下设备立即自动回收写 RETURNED 日志
// ============================================================

const createSchema = z.object({
  departmentId: z.number(),
  name: z.string().min(1, "姓名不能为空"),
  employeeNo: z.string().min(1, "工号不能为空").optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1, "姓名不能为空").optional(),
  employeeNo: z.string().min(1, "工号不能为空").optional(),
  departmentId: z.number().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const querySchema = z.object({
  keyword: z.string().optional(),
});

type EmployeeWithDept = {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  phone: string | null;
  email: string | null;
  assetCount: number;
  hasAccount: boolean;
  createdAt: string;
};

type PrismaEmployee = {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  createdAt: Date;
  department: { name: string } | null;
  phone: string | null;
  email: string | null;
  account?: { id: number } | null;
  _count?: { assets: number };
};

function formatEmployee(emp: PrismaEmployee): EmployeeWithDept {
  return {
    id: emp.id,
    employeeNo: emp.employeeNo,
    name: emp.name,
    departmentId: emp.departmentId,
    departmentName: emp.department?.name ?? "",
    phone: emp.phone ?? null,
    email: emp.email ?? null,
    assetCount: emp._count?.assets ?? 0,
    hasAccount: !!emp.account,
    createdAt: emp.createdAt.toISOString(),
  };
}

/**
 * 解析当前账号可操作的部门集合。
 * 返回 null = 不受部门限制；否则为可操作的部门 id 列表（命中为空数组即什么都不可操作）。
 *
 * 口径（与 permissions.ts 的统一口径对齐）：
 *  - 拥有 system.account.manage → 不限（null）
 *  - 账号设置了 departmentScope='SPEC' / 'EXACT' → 交给 resolveDepartmentScope 解析
 *    （SPEC = 本部门 + 扩展部门「追加」，禁止仅取扩展部门替换；EXACT = 精确限定，空则回退 ALL）
 *  - 拥有 asset.manage → 同样走 resolveDepartmentScope（无部门归属回退 ALL=不限），
 *    与 resolveEmployeeScope / resolveAssetScope 保持一致，避免「列表可见但操作被拒」的错位
 *  - 否则须拥有 dept.data.view → 仅本人担任主管的部门（managedDepartments）；
 *    无该权限时一律拒绝（fail-closed），不沿用统一口径的「回退 ALL」，避免越权
 */
async function resolveAllowedDeptIds(user: { id: number }): Promise<number[] | null> {
  if (await hasPermission(user, "system.account.manage")) return null;

  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    include: {
      departmentLinks: { select: { departmentId: true } },
      employee: { select: { managedDepartments: { select: { id: true } } } },
    },
  });

  // 账号显式限定了部门范围，或为资产管理员：统一交给 resolveDepartmentScope（单一权威口径）
  const needsUnifiedScope =
    admin?.departmentScope === "SPEC" ||
    admin?.departmentScope === "EXACT" ||
    (await hasPermission(user, "asset.manage"));
  if (needsUnifiedScope) {
    const scope = await resolveDepartmentScope(user);
    return scope === "ALL" ? null : scope;
  }

  // 部门主管：仅本人担任主管的部门；无 dept.data.view 一律拒绝
  if (!(await hasPermission(user, "dept.data.view"))) throw new Error("NO_DEPT_ACCESS");
  return (admin?.employee?.managedDepartments ?? []).map((d) => d.id);
}

/** 部门是否在当前可操作范围内（allowed=null 表示不限） */
function deptAllowed(allowed: number[] | null, deptId: number): boolean {
  return allowed === null || allowed.includes(deptId);
}

/** 在守卫函数间复用的范围校验：通过则返回 allowed，否则返回失败响应 */
async function guardDeptScope(
  user: SessionUser,
  targetDeptId: number
): Promise<{ allowed: number[] | null } | ActionResult<never>> {
  let allowed: number[] | null;
  try {
    allowed = await resolveAllowedDeptIds(user);
  } catch {
    return { success: false, error: "没有本部门数据权限" };
  }
  if (!deptAllowed(allowed, targetDeptId)) {
    return { success: false, error: "无权操作其他部门的员工" };
  }
  return { allowed };
}

// ============================================================
// S1 新增员工：本部门内新增 + 自动创建默认账号（首登强制改密）
// ============================================================
export async function createDepartmentEmployee(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  const user = await requireAuth();
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }
  const { departmentId, name, employeeNo: inputNo, phone, email } = validated.data;

  const scope = await guardDeptScope(user, departmentId);
  if (!("allowed" in scope)) return scope;

  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) return { success: false, error: "部门不存在" };

  let employeeNo = inputNo;
  if (!employeeNo) {
    const existingNos = await prisma.employee.findMany({ select: { employeeNo: true } });
    employeeNo = generateEmployeeNo(existingNos.map((e) => e.employeeNo));
  }

  try {
    const emp = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          employeeNo,
          name,
          departmentId,
          phone: phone ?? null,
          email: email ?? null,
        },
        include: { department: { select: { name: true } } },
      });
      // 自动建登录账号：username=工号、默认密码、首登强制改密
      const hashed = await bcrypt.hash("123456", 10);
      await tx.admin.create({
        data: { username: employeeNo, password: hashed, employeeId: created.id, mustChangePassword: true },
      });
      return created;
    });
    return { success: true, data: formatEmployee(emp) };
  } catch (e) {
    return handleUniqueViolation(e, { employeeNo: "工号已存在", username: "账号已存在" }, "创建失败");
  }
}

// ============================================================
// S2 修改员工：仅本部门，部门迁移只能指向本人主管的部门
// ============================================================
export async function updateDepartmentEmployee(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  const user = await requireAuth();
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "员工不存在" };

  const targetDeptId = validated.data.departmentId ?? existing.departmentId;
  const scope = await guardDeptScope(user, targetDeptId);
  if (!("allowed" in scope)) return scope;

  if (validated.data.departmentId != null) {
    const dept = await prisma.department.findUnique({ where: { id: validated.data.departmentId } });
    if (!dept) return { success: false, error: "目标部门不存在" };
  }

  try {
    const emp = await prisma.employee.update({
      where: { id },
      data: validated.data, // 只改传入字段，不改离职状态
      include: { department: { select: { name: true } } },
    });
    return { success: true, data: formatEmployee(emp) };
  } catch (e) {
    return handleUniqueViolation(e, { employeeNo: "工号已存在" }, "更新失败");
  }
}

// ============================================================
// S3 分配/解除设备编码：给本部门员工绑定或解除名下设备
//  assetId != null → 分配（设备须闲置/在库未分配）写 ALLOCATED
//  assetId == null → 解除该员工名下全部在用设备，置闲置写 RETURNED
// ============================================================
const setDeviceSchema = z.object({
  employeeId: z.number(),
  assetId: z.number().nullable(),
});

export async function setEmployeeDevice(
  input: z.infer<typeof setDeviceSchema>
): Promise<ActionResult<{ employeeId: number }>> {
  const user = await requireAuth();
  const validated = setDeviceSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }
  const { employeeId, assetId } = validated.data;

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return { success: false, error: "员工不存在" };

  const scope = await guardDeptScope(user, emp.departmentId);
  if (!("allowed" in scope)) return scope;

  try {
    if (assetId != null) {
      const asset = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset) return { success: false, error: "设备不存在" };
      // 已分配给自己 → 幂等成功
      if (asset.employeeId === employeeId) return { success: true, data: { employeeId } };
      if (asset.employeeId !== null) return { success: false, error: "该设备已分配给他人" };
      if (asset.status !== "IDLE") {
        return { success: false, error: "该设备不在可用状态" };
      }
      await prisma.$transaction([
        prisma.asset.update({ where: { id: asset.id }, data: { status: "IN_USE", employeeId } }),
        prisma.lifecycleLog.create({
          data: {
            assetId: asset.id,
            action: "ALLOCATED",
            fromStatus: asset.status,
            toStatus: "IN_USE",
            employeeId,
            operator: user.username,
            operatorId: user.id,
            remark: "部门主管分配设备",
          },
        }),
      ]);
    } else {
      // 解除该员工名下全部在用设备
      const assets = await prisma.asset.findMany({ where: { employeeId } });
      await prisma.$transaction(async (tx) => {
        for (const a of assets) {
          await tx.lifecycleLog.create({
            data: {
              assetId: a.id,
              action: "RETURNED",
              fromStatus: a.status,
              toStatus: "IDLE",
              employeeId,
              operator: user.username,
              operatorId: user.id,
              remark: "部门主管解除设备",
            },
          });
          await tx.asset.update({ where: { id: a.id }, data: { status: "IDLE", employeeId: null } });
        }
      });
    }
    return { success: true, data: { employeeId } };
  } catch (e) {
    return { success: false, error: "操作失败" };
  }
}

// ============================================================
// S4 标记离职：本部门离职 → 员工置 LEFT、停用账号、立即自动回收名下设备
// ============================================================
export async function markEmployeeDepart(
  id: number,
  reason?: string
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return { success: false, error: "员工不存在" };

  const scope = await guardDeptScope(user, emp.departmentId);
  if (!("allowed" in scope)) return scope;

  // 已离职 → 幂等成功，不做重复回收
  if (emp.status === "LEFT") return { success: true, data: { id } };

  try {
    await prisma.$transaction(async (tx) => {
      // 1) 员工置离职
      await tx.employee.update({ where: { id }, data: { status: "LEFT" } });
      // 2) 停用绑定账号（离职即停用）
      await tx.admin.updateMany({ where: { employeeId: id }, data: { isActive: false } });
      // 3) 立即自动回收名下全部设备
      const assets = await tx.asset.findMany({ where: { employeeId: id } });
      for (const a of assets) {
        await tx.lifecycleLog.create({
          data: {
            assetId: a.id,
            action: "RETURNED",
            fromStatus: a.status,
            toStatus: "IDLE",
            employeeId: id,
            operator: user.username,
            operatorId: user.id,
            remark: reason ? `离职回收：${reason}` : "离职回收",
          },
        });
        await tx.asset.update({
          where: { id: a.id },
          data: { status: "IDLE", employeeId: null, reservedByRequestId: null, reservedFromStatus: null },
        });
      }
    });
    return { success: true, data: { id } };
  } catch (e) {
    return { success: false, error: "离职处理失败" };
  }
}

// ============================================================
// 部门主管可见的本部门员工列表（仅在职，不可跨部门）
// ============================================================
export async function getDepartmentEmployees(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<EmployeeWithDept[]>> {
  const user = await requireAuth();
  const validated = querySchema.safeParse(input);
  if (!validated.success) return { success: false, error: "参数错误" };

  let allowed: number[] | null;
  try {
    allowed = await resolveAllowedDeptIds(user);
  } catch {
    return { success: false, error: "没有本部门数据权限" };
  }

  const keyword = validated.data.keyword;
  const where: Record<string, unknown> = { status: "ACTIVE" };
  if (allowed !== null) where.departmentId = { in: allowed };
  if (keyword) where.OR = [{ name: { contains: keyword } }, { employeeNo: { contains: keyword } }];

  const emps = await prisma.employee.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { name: true } },
      account: { select: { id: true } },
      _count: { select: { assets: true } },
    },
  });
  return { success: true, data: emps.map(formatEmployee) };
}