import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizePhotoKeys,
  ossAssetKey,
  ossConfigured,
  putOssObject,
} from "@/lib/oss";

/**
 * 现场登记照片上传 API（tools/device-register exe 调用，无登录态）。
 *
 * 现场登记完成后，exe 把现场拍的照片经此接口转存 OSS 并挂到资产
 * Asset.photos（与网页端照片墙同一份数据，签名后回显）。
 *
 * 安全口径：
 *  - 可选令牌闸门：设置 DEVICE_CHECK_TOKEN 后必须携带同值请求头 x-device-token；
 *  - multipart: assetNo（必填）、kind（host/monitor，标记主机/显示器照片）、
 *    hostname（可选，写日志）、file（单张）；
 *  - 与 uploadAssetPhoto 同限制：单张 ≤5MB，仅 JPG/PNG/WebP，每台 ≤6 张；
 *  - 每次调用写 SystemLog（operator = 现场主机名）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: NextRequest) {
  const expected = process.env.DEVICE_CHECK_TOKEN?.trim();
  if (expected) {
    const got = req.headers.get("x-device-token")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "令牌不匹配" }, { status: 401 });
    }
  }

  if (!ossConfigured()) {
    return NextResponse.json(
      { error: "服务器未配置对象存储（OSS_*），暂时无法上传照片" },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "请求必须是 multipart/form-data" },
      { status: 400 }
    );
  }

  const assetNo = String(form.get("assetNo") ?? "").trim().toUpperCase();
  const kind = String(form.get("kind") ?? "").trim(); // host / monitor（缺省 = 未标记）
  const hostname = String(form.get("hostname") ?? "").slice(0, 100) || "未知主机";
  const file = form.get("file");

  if (!assetNo) {
    return NextResponse.json({ error: "缺少设备编号（assetNo）" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择要上传的照片" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "照片不能超过 5MB" }, { status: 400 });
  }
  const ext = MIME_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "仅支持 JPG / PNG / WebP 格式" },
      { status: 400 }
    );
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { assetNo },
      select: { id: true, assetNo: true, photos: true },
    });
    if (!asset) {
      return NextResponse.json(
        { error: `编号 ${assetNo} 在台账中不存在，请先登记入库` },
        { status: 404 }
      );
    }

    const keys = normalizePhotoKeys(asset.photos);
    if (keys.length >= 6) {
      return NextResponse.json(
        { error: "每台设备最多 6 张照片" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = ossAssetKey(asset.assetNo, ext, kind);
    await putOssObject(key, buffer, file.type);

    keys.push(key);
    await prisma.asset.update({ where: { id: asset.id }, data: { photos: keys } });

    await prisma.systemLog
      .create({
        data: {
          module: "设备核对",
          action: "现场登记照片",
          detail: `${asset.assetNo} 上传照片（第 ${keys.length} 张，来自现场登记工具）`,
          operator: hostname,
        },
      })
      .catch(() => {});

    return NextResponse.json({ key, count: keys.length });
  } catch (e) {
    console.error("[设备登记] 上传现场照片失败", e);
    return NextResponse.json({ error: "上传照片失败，请稍后重试" }, { status: 500 });
  }
}
