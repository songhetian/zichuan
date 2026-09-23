"use server";

import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { LIFECYCLE_ACTION_LABEL_MAP } from "@/lib/constants";

// LifecycleAction 全量取值（含 REPLACED，与 schema 枚举对齐）
const LIFECYCLE_ACTIONS = [
  "CREATED",
  "ALLOCATED",
  "RETURNED",
  "TRANSFERRED",
  "UPGRADED",
  "MAINTENANCE_START",
  "MAINTENANCE_DONE",
  "SCRAPPED",
  "REPLACED",
] as const;

const querySchema = z.object({
  departmentId: z.string().optional(), // SearchableSelect 传字符串，这里 Number 化
  employeeId: z.string().optional(),
  dateFrom: z.string().optional(), // ISO 日期，如 2026-09-01
  dateTo: z.string().optional(),
  actions: z.array(z.enum(LIFECYCLE_ACTIONS, { message: "操作类型不合法" })).optional(),
  keyword: z.string().optional(), // 资产号/名称模糊
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

/** 生命周期聚合行 */
export interface LifecycleViewRow {
  id: number;
  assetNo: string | null;
  assetName: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string;
  employeeName: string | null;
  departmentName: string | null;
  departmentId: number | null;
  request: { requestNo: string; businessType: string; title: string; status: string } | null;
  remark: string | null;
  createdAt: Date;
}

export interface AssetLifecycleViewData {
  data: LifecycleViewRow[]; // createdAt 降序
  total: number; // 过滤后总条数（分页前）
  page: number;
  pageSize: number;
  departments: { id: number; name: string }[];
  employees: { id: number; name: string; departmentId: number }[];
  actionOptions: { value: string; label: string }[];
}

/**
 * 设备生命周期视图：聚合 LifecycleLog + 关联审批申请单。
 * 支持按部门 / 人员 / 时间段 / 操作类型 / 资产关键字筛选。
 * 仅资产管理员及以上（asset.manage）可见。
 */
export async function getAssetLifecycleView(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<AssetLifecycleViewData>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有查看设备生命周期的权限");
  if (denied) return denied;

  const validated = querySchema.safeParse(input);
  if (!validated.success) return { success: false, error: "参数错误" };

  const { departmentId, employeeId, dateFrom, dateTo, actions, keyword, page, pageSize } = validated.data;
  const currentPage = page ?? 1;
  const currentPageSize = pageSize ?? 20;

  // ---- 构造 where 子句：所有过滤都下沉到 DB 层，保证分页计数正确 ----
  const where: Prisma.LifecycleLogWhereInput = {};
  if (employeeId) where.employeeId = Number(employeeId);
  if (actions && actions.length) where.action = { in: [...actions] };
  if (keyword) {
    where.asset = {
      OR: [
        { assetNo: { contains: keyword } },
        { name: { contains: keyword } },
      ],
    };
  }
  if (dateFrom || dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (dateFrom) createdAt.gte = new Date(`${dateFrom}T00:00:00`);
    if (dateTo) createdAt.lte = new Date(`${dateTo}T23:59:59.999`);
    where.createdAt = createdAt;
  }
  // 部门过滤下沉 DB：LifecycleLog.employeeId 为标量字段，需先解析该部门全部员工 id。
  // 语义与派生行一致 —— 优先日志人员部门；仅当日志无人员快照时才回退资产当前持有人部门。
  if (departmentId) {
    const deptEmployees = await prisma.employee.findMany({
      where: { departmentId: Number(departmentId) },
      select: { id: true },
    });
    const deptEmpIds = deptEmployees.map((e) => e.id);
    const or: Prisma.LifecycleLogWhereInput[] = [];
    if (deptEmpIds.length) or.push({ employeeId: { in: deptEmpIds } });
    or.push({ employeeId: null, asset: { employee: { departmentId: Number(departmentId) } } });
    where.OR = or;
  }

  const [logs, total] = await Promise.all([
    prisma.lifecycleLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * currentPageSize,
      take: currentPageSize,
      // LifecycleLog.employeeId 仅为标量（非关系字段），员工/部门需按 id 手动补查
      include: {
        asset: {
          select: {
            assetNo: true,
            name: true,
            employee: {
              select: { id: true, name: true, departmentId: true },
            },
          },
        },
        request: { select: { requestNo: true, businessType: true, title: true, status: true } },
      },
    }),
    prisma.lifecycleLog.count({ where }),
  ]);

  // 收集涉及到的员工 id（生命周期人员 + 资产当前持有人），一次查询补全 员工姓名/部门
  const empIds = new Set<number>();
  for (const log of logs) {
    if (log.employeeId) empIds.add(log.employeeId);
    if (log.asset?.employee?.id) empIds.add(log.asset.employee.id);
  }
  const empRows = empIds.size
    ? await prisma.employee.findMany({
        where: { id: { in: [...empIds] } },
        select: { id: true, name: true, departmentId: true, department: { select: { id: true, name: true } } },
      })
    : [];
  const empMap = new Map(empRows.map((e) => [e.id, e]));

  // 组装行，并派生部门：优先 LifecycleLog.employee（人员快照），否则取资产当前持有人部门
  const rows = logs.map((log) => {
    const lifeEmp = log.employeeId ? empMap.get(log.employeeId) : undefined;
    const assetEmp = log.asset?.employee ? empMap.get(log.asset.employee.id) : undefined;
    const dept = lifeEmp?.department ?? assetEmp?.department ?? null;
    return {
      id: log.id,
      assetNo: log.asset?.assetNo ?? null,
      assetName: log.asset?.name ?? null,
      action: log.action,
      fromStatus: log.fromStatus as string | null,
      toStatus: log.toStatus as string | null,
      operator: log.operator,
      employeeName: lifeEmp?.name ?? null,
      departmentName: dept?.name ?? null,
      departmentId: dept?.id ?? null,
      request: log.request
        ? {
            requestNo: log.request.requestNo,
            businessType: log.request.businessType,
            title: log.request.title,
            status: log.request.status,
          }
        : null,
      remark: log.remark,
      createdAt: log.createdAt,
    };
  });

  // 下拉数据（部门 / 人员 / 操作类型）
  const [departments, employees] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.employee.findMany({
      select: { id: true, name: true, departmentId: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const actionOptions = LIFECYCLE_ACTIONS.map((a) => ({
    value: a,
    label: LIFECYCLE_ACTION_LABEL_MAP[a] ?? a,
  }));

  return {
    success: true,
    data: {
      data: rows,
      total,
      page: currentPage,
      pageSize: currentPageSize,
      departments,
      employees,
      actionOptions,
    },
  };
}