"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { ActionResult } from "@/lib/types";

// ============================================================
// 加购留痕（ASSET_PURCHASE）：终审通过自动入库后生成的采购对账记录
// ============================================================

export type PurchaseRecordItem = {
  id: number;
  orderNo: string;
  requestNo: string;
  modelName: string;
  categoryName: string;
  quantity: number;
  unitPrice: string | null;
  amount: string | null;
  initiatorName: string;
  createdAt: Date;
};

/** 查询采购留痕（可筛选配件名称/分类），按时间倒序；用于采购对账 + 导出 */
export async function listPurchaseRecords(opts?: {
  keyword?: string;
  categoryId?: number;
  page?: number;
  pageSize?: number;
}): Promise<
  ActionResult<{ items: PurchaseRecordItem[]; total: number }>
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.purchase.view", "没有查看采购留痕的权限");
  if (denied) return denied;

  const page = Math.max(opts?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 20, 1), 100);

  const where = {
    ...(opts?.keyword
      ? {
          OR: [
            { modelName: { contains: opts.keyword } },
            { orderNo: { contains: opts.keyword } },
          ],
        }
      : {}),
    ...(opts?.categoryId ? { model: { categoryId: opts.categoryId } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.purchaseRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        request: { select: { requestNo: true } },
        model: { select: { category: { select: { name: true } } } },
        initiator: { select: { username: true, displayName: true } },
      },
    }),
    prisma.purchaseRecord.count({ where }),
  ]);

  return {
    success: true,
    data: {
      total,
      items: rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        requestNo: r.request.requestNo,
        modelName: r.modelName,
        categoryName: r.model.category.name,
        quantity: r.quantity,
        unitPrice: r.unitPrice?.toString() ?? null,
        amount: r.amount?.toString() ?? null,
        initiatorName: r.initiator.displayName || r.initiator.username,
        createdAt: r.createdAt,
      })),
    },
  };
}