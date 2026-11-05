import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  judgeDevice,
  type DeviceCheckInput,
  type DeviceKind,
} from "@/lib/device-check";

/**
 * 设备核对 API（现场 PowerShell 工具调用，无登录态）。
 *
 * 安全口径：
 *  - 只读接口：仅按设备编号查询台账并回传核对结论，不写业务数据；
 *  - 默认限内网使用；若设置环境变量 DEVICE_CHECK_TOKEN，则必须携带
 *    同值请求头 x-device-token，否则 401；
 *  - 每次调用写一条 SystemLog（operator = 现场主机名），可追溯。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 20;

export async function POST(req: NextRequest) {
  const expected = process.env.DEVICE_CHECK_TOKEN?.trim();
  if (expected) {
    const got = req.headers.get("x-device-token")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "令牌不匹配" }, { status: 401 });
    }
  }

  let body: { hostname?: string; items?: DeviceCheckInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      assetNo: String(it?.assetNo ?? "").trim(),
      kind: (it?.kind === "monitor" ? "monitor" : "host") as DeviceKind,
      detectedModel: it?.detectedModel ? String(it.detectedModel) : null,
      detectedSerial: it?.detectedSerial ? String(it.detectedSerial) : null,
    }))
    .filter((it) => it.assetNo);

  if (!items.length) {
    return NextResponse.json({ error: "没有可核对的设备编号" }, { status: 400 });
  }

  try {
    const rows = await prisma.asset.findMany({
      where: { assetNo: { in: items.map((i) => i.assetNo) } },
      select: {
        assetNo: true,
        brand: true,
        model: true,
        status: true,
        employee: { select: { name: true } },
        template: { select: { category: { select: { name: true } } } },
      },
    });
    const byNo = new Map(rows.map((r) => [r.assetNo, r]));

    const results = items.map((it) => {
      const row = byNo.get(it.assetNo);
      const asset = row
        ? {
            assetNo: row.assetNo,
            category: row.template.category.name,
            brand: row.brand,
            model: row.model,
            status: row.status,
            holder: row.employee?.name ?? null,
          }
        : null;
      return judgeDevice(it, asset);
    });

    const hostname = String(body.hostname ?? "").slice(0, 100) || "未知主机";
    const summary = results
      .map((r) => `${r.assetNo}[${r.verdict}]`)
      .join(", ");
    // 日志失败不影响核对结果
    await prisma.systemLog
      .create({
        data: {
          module: "设备核对",
          action: "现场核对",
          detail: `来自 ${hostname}：${summary}`,
          operator: hostname,
        },
      })
      .catch(() => {});

    return NextResponse.json({ results });
  } catch (e) {
    console.error("[设备核对] 查询台账失败", e);
    return NextResponse.json({ error: "查询台账失败，请稍后重试" }, { status: 500 });
  }
}
