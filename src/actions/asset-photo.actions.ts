"use server";

import { ActionResult } from "@/lib/types";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import {
  deleteOssObject,
  getOssSignedUrl,
  normalizePhotoKeys,
  ossAssetKey,
  ossConfigured,
  putOssObject,
} from "@/lib/oss";

/**
 * 资产现场照片（可选增强）：
 * - 上传/删除需「资产管理」权限；查看跟随资产可见范围（详情接口内联返回签名 URL）；
 * - 照片存 OSS 逐对象私有，key 记录在 Asset.photos（JSON 数组）；
 * - 未配置 OSS_* 时上传直接返回友好错误，系统其余功能不受影响。
 */

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 上传一张资产照片（每台资产上限 6 张） */
export async function uploadAssetPhoto(
  assetId: number,
  formData: FormData
): Promise<ActionResult<{ key: string; url: string; photos: { key: string; url: string }[] }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  try {
    if (!ossConfigured()) {
      return { success: false, error: "未配置对象存储（OSS_*），暂时无法上传照片" };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "请选择要上传的照片" };
    }
    if (file.size > MAX_SIZE) {
      return { success: false, error: "照片不能超过 5MB" };
    }
    const ext = MIME_EXT[file.type];
    if (!ext) {
      return { success: false, error: "仅支持 JPG / PNG / WebP 格式" };
    }

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, assetNo: true, photos: true },
    });
    if (!asset) {
      return { success: false, error: "设备不存在" };
    }

    const keys = normalizePhotoKeys(asset.photos);
    if (keys.length >= 6) {
      return { success: false, error: "每台设备最多 6 张照片，请先删除旧照片" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = ossAssetKey(asset.assetNo, ext);
    await putOssObject(key, buffer, file.type);

    keys.push(key);
    await prisma.asset.update({ where: { id: assetId }, data: { photos: keys } });

    await prisma.systemLog.create({
      data: {
        module: "资产管理",
        action: "上传设备照片",
        detail: `${asset.assetNo} 上传照片（第 ${keys.length} 张）`,
        operator: user.username,
      },
    });

    const photos = keys.map((k) => ({ key: k, url: getOssSignedUrl(k) }));
    return { success: true, data: { key, url: getOssSignedUrl(key), photos } };
  } catch (e) {
    console.error("[asset-photo] 上传照片异常", e);
    return { success: false, error: "上传照片失败，请稍后重试" };
  }
}

/** 删除一张资产照片（同时清理 OSS 对象，删除对象失败不阻断） */
export async function deleteAssetPhoto(
  assetId: number,
  key: string
): Promise<ActionResult<{ photos: { key: string; url: string }[] }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, assetNo: true, photos: true },
    });
    if (!asset) {
      return { success: false, error: "设备不存在" };
    }

    const keys = normalizePhotoKeys(asset.photos);
    if (!keys.includes(key)) {
      return { success: false, error: "照片不存在或已删除" };
    }

    const remaining = keys.filter((k) => k !== key);
    await prisma.asset.update({ where: { id: assetId }, data: { photos: remaining } });
    await deleteOssObject(key);

    await prisma.systemLog.create({
      data: {
        module: "资产管理",
        action: "删除设备照片",
        detail: `${asset.assetNo} 删除照片（剩余 ${remaining.length} 张）`,
        operator: user.username,
      },
    });

    return {
      success: true,
      data: { photos: remaining.map((k) => ({ key: k, url: getOssSignedUrl(k) })) },
    };
  } catch (e) {
    console.error("[asset-photo] 删除照片异常", e);
    return { success: false, error: "删除照片失败，请稍后重试" };
  }
}
