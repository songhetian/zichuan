"use server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";

/** 扫码瘦身页：按资产编号查询资产概要（含使用人/部门/位置），供二维码扫码展示与盘点核对。 */
export async function getQrAsset(
  assetNo: string
): Promise<
  ActionResult<{
    assetNo: string;
    name: string;
    status: string;
    employeeName: string;
    departmentName: string;
    location: string | null;
  }>
> {
  await requireAuth();

  const asset = await prisma.asset.findUnique({
    where: { assetNo },
    include: {
      employee: {
        include: { department: { select: { name: true } } },
      },
    },
  });

  if (!asset) {
    return { success: false, error: "未找到该资产" };
  }

  return {
    success: true,
    data: {
      assetNo: asset.assetNo,
      name: asset.name,
      status: asset.status,
      employeeName: asset.employee?.name ?? "",
      departmentName: asset.employee?.department?.name ?? "",
      location: asset.location,
    },
  };
}