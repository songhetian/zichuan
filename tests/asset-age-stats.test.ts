import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { getAssetAgeStats } from "@/actions/stats.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupAssets() {
  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准电脑", categoryId: assetCat.id },
  });
  const now = Date.now();
  const a1 = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "旧设备",
      templateId: template.id,
      status: "IDLE",
      createdAt: new Date(now - 120 * 86400000),
    },
  });
  const a2 = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "新设备",
      templateId: template.id,
      status: "IN_USE",
      createdAt: new Date(now - 10 * 86400000),
    },
  });
  return { template, a1, a2 };
}

describe("库龄/呆滞统计", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("getAssetAgeStats — 呆滞判定", () => {
    it("闲置/库存设备按最近活动（无活动则建档日）距今天数判定呆滞，非空置设备不计呆滞", async () => {
      const assetCat = await prisma.assetCategory.create({
        data: { name: "计算机", code: "DN" },
      });
      const template = await prisma.deviceTemplate.create({
        data: { name: "标准电脑", categoryId: assetCat.id },
      });
      const now = Date.now();
      // A：闲置 200 天无任何流转 → 呆滞
      const a = await prisma.asset.create({
        data: {
          assetNo: "DN-0001",
          name: "长期闲置机",
          templateId: template.id,
          status: "IDLE",
          createdAt: new Date(now - 200 * 86400000),
        },
      });
      // B：闲置但 20 天前刚归还 → 未达呆滞阈值
      const b = await prisma.asset.create({
        data: {
          assetNo: "DN-0002",
          name: "刚归还机",
          templateId: template.id,
          status: "IDLE",
          createdAt: new Date(now - 200 * 86400000),
        },
      });
      await prisma.lifecycleLog.create({
        data: {
          assetId: b.id,
          action: "RETURNED",
          fromStatus: "IN_USE",
          toStatus: "IDLE",
          operator: "admin",
          createdAt: new Date(now - 20 * 86400000),
        },
      });
      // C：在用 → 不计呆滞
      await prisma.asset.create({
        data: {
          assetNo: "DN-0003",
          name: "在用机",
          templateId: template.id,
          status: "IN_USE",
          createdAt: new Date(now - 5 * 86400000),
        },
      });

      const result = await getAssetAgeStats();
      expect(result.success).toBe(true);
      const data = unwrap(result);

      const rowA = data.rows.find((r) => r.assetNo === "DN-0001")!;
      expect(rowA.status).toBe("IDLE");
      expect(rowA.idleDays).toBe(200);
      expect(rowA.isStagnant).toBe(true);

      const rowB = data.rows.find((r) => r.assetNo === "DN-0002")!;
      expect(rowB.idleDays).toBe(20);
      expect(rowB.isStagnant).toBe(false);

      const rowC = data.rows.find((r) => r.assetNo === "DN-0003")!;
      expect(rowC.status).toBe("IN_USE");
      expect(rowC.idleDays).toBeNull();
      expect(rowC.isStagnant).toBe(false);

      // 默认阈值 90 天，仅 A 呆滞
      expect(data.stagnantCount).toBe(1);
      expect(data.thresholdDays).toBe(90);
    });
  });

  describe("getAssetAgeStats — 库龄", () => {
    it("按资产建档日期(createdAt)计算每台设备的库龄（天）", async () => {
      await setupAssets();

      const result = await getAssetAgeStats();

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.total).toBe(2);
      const old = data.rows.find((r) => r.assetNo === "DN-0001")!;
      expect(old.ageDays).toBe(120);
      const fresh = data.rows.find((r) => r.assetNo === "DN-0002")!;
      expect(fresh.ageDays).toBe(10);
    });
  });
});