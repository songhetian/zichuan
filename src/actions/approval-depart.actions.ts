"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { visibleRequestWhere } from "@/lib/approval-scope";
import { hasPermission, guardPermission } from "@/lib/permissions";
import { departPayloadSchema } from "@/lib/approval-execute";
import { ActionResult } from "@/lib/types";
import type { EmployeeWithDept, EmployeeAsset } from "./employee.actions";

// ============================================================
// 离职交接的「核对设备」上下文
//
// 离职流程 = 部门主管审批 → 资产管理员审批（见 prisma/seed.ts 的默认两节点流程）。
// 两个节点的审批人都必须在通过前看清「这名员工名下有哪些设备」。
//
// 为什么不复用 /employees/[id]：部门主管与资产管理员都**不持有 `employee.view`**
// （见 src/lib/permissions.ts 的 ROLE_PERMISSION_MATRIX），而 /employees 前缀
// 要求 employee.view，跳过去只会看到「无权限」。若为此放开该路由，等于让所有
// 普通员工都能翻同事的设备与联系方式。
//
// 所以核对视图的数据出口单独做，授权口径 = 「你是这张单的相关人」，
// 与 getApprovalRequestById 完全同源（visibleRequestWhere），不新开范围判据。
// ============================================================

export interface DepartureCheckInfo {
  employee: EmployeeWithDept;
  assets: EmployeeAsset[];
}

/** 定位并校验「离职单」上下文：可见性 + 业务类型 + payload 解析，三关一起过 */
async function loadDepartRequest(
  requestId: number,
  adminId: number
): Promise<{ requestId: number; targetEmployeeId: number } | { error: string }> {
  if (!Number.isInteger(requestId) || requestId <= 0) return { error: "参数无效" };

  const scope = await visibleRequestWhere(adminId);
  const req = await prisma.approvalRequest.findFirst({
    where: { id: requestId, ...scope },
    select: { id: true, businessType: true, payload: true },
  });
  // 数据范围外统一返回「不存在」，避免泄露申请单是否存在（与单据详情同口径）
  if (!req) return { error: "申请单不存在" };
  if (req.businessType !== "ASSET_DEPART") {
    return { error: "该申请单不是离职交接单，无法核对设备" };
  }

  let raw: unknown = req.payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: "申请内容格式错误" };
    }
  }
  const parsed = departPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: "申请内容格式错误" };

  return { requestId: req.id, targetEmployeeId: parsed.data.targetEmployeeId };
}

/**
 * 离职核对上下文：离职员工身份 + 名下全部设备。
 *
 * 审批人据此在「通过」之前完成实物核对；返回结构与 `/employees/[id]` 的
 * 预览页同形，直接喂给同一个展示组件，避免两套渲染两套口径。
 */
export async function getDepartureCheckInfo(
  requestId: number
): Promise<ActionResult<DepartureCheckInfo>> {
  const user = await requireAuth();
  const ctx = await loadDepartRequest(requestId, user.id);
  if ("error" in ctx) return { success: false, error: ctx.error };

  const employee = await prisma.employee.findUnique({
    where: { id: ctx.targetEmployeeId },
    include: {
      department: { select: { name: true } },
      _count: { select: { assets: true } },
    },
  });
  if (!employee) return { success: false, error: "离职员工不存在" };

  const assets = await prisma.asset.findMany({
    where: { employeeId: ctx.targetEmployeeId },
    select: {
      id: true,
      assetNo: true,
      name: true,
      status: true,
      location: true,
      purchaseDate: true,
      warrantyMonths: true,
      notes: true,
      template: { select: { name: true, category: { select: { name: true } } } },
    },
    orderBy: { id: "asc" },
  });

  return {
    success: true,
    data: {
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: employee.name,
        departmentId: employee.departmentId,
        departmentName: employee.department?.name ?? "",
        phone: employee.phone ?? null,
        email: employee.email ?? null,
        assetCount: employee._count.assets,
        createdAt: employee.createdAt.toISOString(),
      },
      assets: assets.map((a) => ({
        id: a.id,
        assetNo: a.assetNo,
        name: a.name,
        status: a.status,
        templateName: a.template.name,
        categoryName: a.template.category.name,
        location: a.location,
        purchaseDate: a.purchaseDate,
        warrantyMonths: a.warrantyMonths,
        notes: a.notes,
      })),
    },
  };
}

export interface HandoverOrderListItem {
  orderId: number;
  orderNo: string;
  /** 关联离职申请单（点进去看完整流转与实时设备明细） */
  requestId: number | null;
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  departmentName: string;
  status: string;
  /** 应回收台数 = 生成交接单时的快照台数 */
  assetCount: number;
  /** 交接单快照清单（对账依据，就地核对用） */
  items: DepartureHandoverItem[];
  createdAt: string;
  collectedAt: string | null;
  /** 当前账号能否执行回收（持有 asset.depart.execute） */
  canConfirm: boolean;
}

/**
 * 离职交接对账单列表（「交接对账」页）。
 *
 * 为什么要这个列表：终审通过只生成 PENDING 交接单，设备**还没回收**；
 * 但入口原先只长在离职单详情页里 —— 资产管理员得先知道是哪张单才能进去回收。
 * 这个列表把「待对账的单」直接摆到他面前。
 */
export async function getHandoverOrders(opts?: {
  status?: "PENDING" | "COLLECTED";
}): Promise<ActionResult<HandoverOrderListItem[]>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.depart.handover.view", "没有查看交接单的权限");
  if (denied) return denied;

  const [orders, canConfirm] = await Promise.all([
    prisma.handoverOrder.findMany({
      where: opts?.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            employeeNo: true,
            department: { select: { name: true } },
          },
        },
      },
    }),
    hasPermission(user, "asset.depart.execute"),
  ]);

  return {
    success: true,
    data: orders.map((o) => {
      const items = parseHandoverSnapshot(o.assetSnapshot);
      return {
        orderId: o.id,
        orderNo: o.orderNo,
        requestId: o.requestId,
        employeeId: o.employeeId,
        employeeName: o.employee.name,
        employeeNo: o.employee.employeeNo,
        departmentName: o.employee.department?.name ?? "",
        status: o.status,
        assetCount: items.length,
        items,
        createdAt: o.createdAt.toISOString(),
        collectedAt: o.collectedAt ? o.collectedAt.toISOString() : null,
        canConfirm,
      };
    }),
  };
}

export interface DepartureHandoverItem {
  assetId: number;
  assetNo: string;
  name: string;
  status: string;
}

/** 解析交接单快照 JSON（列列表与详情共用，避免两套口径）。非法行直接丢弃。 */
function parseHandoverSnapshot(raw: unknown): DepartureHandoverItem[] {
  const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
  return rows.flatMap((row) => {
    const r = row as Partial<DepartureHandoverItem>;
    if (typeof r?.assetId !== "number") return [];
    return [
      {
        assetId: r.assetId,
        assetNo: r.assetNo ?? "",
        name: r.name ?? "",
        status: r.status ?? "",
      },
    ];
  });
}

export interface DepartureHandoverInfo {
  orderId: number;
  orderNo: string;
  status: string;
  employeeId: number;
  /** 交接单快照清单（生成交接单那一刻冻结的「应回收设备」，对账依据） */
  items: DepartureHandoverItem[];
  /** 快照台数 = 应回收数量 */
  assetCount: number;
  confirmedAt: Date | null;
  collectedAt: Date | null;
  /** 当前账号是否有「对账确认回收」权限（前端据此决定是否渲染回收按钮） */
  canConfirm: boolean;
}

/**
 * 离职交接单（对账回收用）。
 *
 * 终审通过后 `executeDepartOnApproval` 生成 PENDING 交接单；设备**此时还没回收**，
 * 必须由资产管理员核对无误后调 `confirmHandover` 才真正回收。
 * 审批中 / 尚未生成交接单时返回 null，前端据此不渲染对账卡片。
 */
export async function getDepartureHandover(
  requestId: number
): Promise<ActionResult<DepartureHandoverInfo | null>> {
  const user = await requireAuth();
  const ctx = await loadDepartRequest(requestId, user.id);
  if ("error" in ctx) return { success: false, error: ctx.error };

  const order = await prisma.handoverOrder.findUnique({
    where: { requestId: ctx.requestId },
  });
  if (!order) return { success: true, data: null };

  const items = parseHandoverSnapshot(order.assetSnapshot);

  // 回收执行人 = 持有 asset.depart.execute（与 confirmHandover 的闸门同一权限点）
  const canConfirm = await hasPermission(user, "asset.depart.execute");

  return {
    success: true,
    data: {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      employeeId: order.employeeId,
      items,
      assetCount: items.length,
      confirmedAt: order.confirmedAt,
      collectedAt: order.collectedAt,
      canConfirm,
    },
  };
}
