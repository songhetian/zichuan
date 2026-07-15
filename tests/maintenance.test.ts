import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  maintenanceStart,
  maintenanceComplete,
} from "@/actions/lifecycle.actions";
import { prisma } from "@/lib/prisma";

// ============================================================
// 测试 seam：lifecycle actions — 送修 / 维修完成
// ============================================================

async function setupIdleAsset() {
  const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: {
      name: "标准办公电脑",
      categoryId: assetCat.id,
      components: { create: [{ modelId: cpu.id, quantity: 1 }] },
    },
  });
  const asset = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "电脑1", templateId: template.id, status: "IDLE" },
  });
  return { asset };
}

describe("送修", () => {
  describe("maintenanceStart — 送修设备", () => {
    it("闲置设备可以送修", async () => {
      const { asset } = await setupIdleAsset();

      const result = await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
        remark: "屏幕闪烁",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("IN_MAINTENANCE");

      const logs = await prisma.lifecycleLog.findMany({ where: { assetId: asset.id } });
      const startLog = logs.find((l) => l.action === "MAINTENANCE_START");
      expect(startLog).toBeDefined();
      expect(startLog!.fromStatus).toBe("IDLE");
      expect(startLog!.toStatus).toBe("IN_MAINTENANCE");
      expect(startLog!.remark).toBe("屏幕闪烁");
    });

    it("在用设备可以送修", async () => {
      const { asset } = await setupIdleAsset();
      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: emp.id },
      });

      const result = await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("IN_MAINTENANCE");
    });

    it("已报废设备不能送修", async () => {
      const { asset } = await setupIdleAsset();
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "SCRAPPED" },
      });

      const result = await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已报废");
    });

    it("维修中的设备不能重复送修", async () => {
      const { asset } = await setupIdleAsset();
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_MAINTENANCE" },
      });

      const result = await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("维修中");
    });

    it("可以批量送修多台设备", async () => {
      const { asset } = await setupIdleAsset();
      const asset2 = await prisma.asset.create({
        data: {
          assetNo: "DN-0002",
          name: "电脑2",
          templateId: asset.templateId,
          status: "IDLE",
        },
      });

      const result = await maintenanceStart({
        assetIds: [asset.id, asset2.id],
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).startedCount).toBe(2);
    });

    it("送修后自动生成系统日志", async () => {
      const { asset } = await setupIdleAsset();

      await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
      });

      const { getSystemLogs } = await import("@/actions/system-log.actions");
      const logs = await getSystemLogs({ module: "送修" });
      const log = unwrap(logs).find((l) => l.detail.includes(asset.assetNo));
      expect(log).toBeDefined();
    });
  });
});

describe("维修完成", () => {
  describe("maintenanceComplete — 维修完成", () => {
    it("维修中的设备可以标记完成", async () => {
      const { asset } = await setupIdleAsset();
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_MAINTENANCE" },
      });

      const result = await maintenanceComplete({
        assetIds: [asset.id],
        operator: "admin",
        remark: "更换屏幕",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("IDLE");

      const logs = await prisma.lifecycleLog.findMany({ where: { assetId: asset.id } });
      const completeLog = logs.find((l) => l.action === "MAINTENANCE_DONE");
      expect(completeLog).toBeDefined();
      expect(completeLog!.fromStatus).toBe("IN_MAINTENANCE");
      expect(completeLog!.toStatus).toBe("IDLE");
      expect(completeLog!.remark).toBe("更换屏幕");
    });

    it("非维修中的设备不能标记完成", async () => {
      const { asset } = await setupIdleAsset();
      // 状态是 IDLE

      const result = await maintenanceComplete({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("非维修中");
    });

    it("可以批量完成多台设备维修", async () => {
      const { asset } = await setupIdleAsset();
      const asset2 = await prisma.asset.create({
        data: {
          assetNo: "DN-0002",
          name: "电脑2",
          templateId: asset.templateId,
          status: "IN_MAINTENANCE",
        },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_MAINTENANCE" },
      });

      const result = await maintenanceComplete({
        assetIds: [asset.id, asset2.id],
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).completedCount).toBe(2);
    });

    it("维修完成后自动生成系统日志", async () => {
      const { asset } = await setupIdleAsset();
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_MAINTENANCE" },
      });

      await maintenanceComplete({
        assetIds: [asset.id],
        operator: "admin",
      });

      const { getSystemLogs } = await import("@/actions/system-log.actions");
      const logs = await getSystemLogs({ module: "维修完成" });
      const log = unwrap(logs).find((l) => l.detail.includes(asset.assetNo));
      expect(log).toBeDefined();
    });
  });
});
