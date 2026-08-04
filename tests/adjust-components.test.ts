import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { adjustAssetComponents } from "@/actions/lifecycle.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

// ============================================================
// 测试 seam：adjustAssetComponents — 设备配件配置调整
// 支持：增加配件（+）、减少配件（-）、批量调整
// 验证：配件配置变更、库存变动、生命周期日志、系统日志
// ============================================================

describe("设备配件配置调整", () => {
  let assetId: number;
  let cpuModelId: number;
  let memoryModelId: number;
  let monitorModelId: number;
  let extraMonitorModelId: number;

  beforeEach(async () => {
    setTestUser({ id: 1, username: "admin" });

    // 创建设备分类
    const category = await prisma.assetCategory.create({
      data: { name: "电脑主机", code: "PC" },
    });

    // 创建配件分类
    const cpuCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
    const memCat = await prisma.componentCategory.create({ data: { name: "内存" } });
    const monCat = await prisma.componentCategory.create({ data: { name: "显示器" } });

    // 创建配件型号 + 库存
    const cpu = await prisma.componentModel.create({
      data: { name: "i5-12400", brand: "Intel", categoryId: cpuCat.id, stock: { create: { quantity: 5 } } },
    });
    const memory = await prisma.componentModel.create({
      data: { name: "16GB DDR4", brand: "Samsung", categoryId: memCat.id, stock: { create: { quantity: 10 } } },
    });
    const monitor = await prisma.componentModel.create({
      data: { name: "24寸 IPS", brand: "Dell", categoryId: monCat.id, stock: { create: { quantity: 8 } } },
    });
    const monitor2 = await prisma.componentModel.create({
      data: { name: "27寸 4K", brand: "LG", categoryId: monCat.id, stock: { create: { quantity: 3 } } },
    });

    cpuModelId = cpu.id;
    memoryModelId = memory.id;
    monitorModelId = monitor.id;
    extraMonitorModelId = monitor2.id;

    // 创建设备模板
    const template = await prisma.deviceTemplate.create({
      data: { name: "测试配置", categoryId: category.id },
    });
    await prisma.templateComponent.createMany({
      data: [
        { templateId: template.id, modelId: cpu.id, quantity: 1 },
        { templateId: template.id, modelId: memory.id, quantity: 1 },
      ],
    });

    // 创建部门和员工
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { name: "张三", employeeNo: "EMP0001", departmentId: dept.id },
    });

    // 创建设备（带初始配置：1 CPU + 1 内存）
    const asset = await prisma.asset.create({
      data: {
        assetNo: "PC-0001",
        name: "张三的电脑主机",
        status: "IN_USE",
        templateId: template.id,
        employeeId: emp.id,
      },
    });
    assetId = asset.id;

    await prisma.assetComponent.createMany({
      data: [
        { assetId: asset.id, modelId: cpu.id, quantity: 1 },
        { assetId: asset.id, modelId: memory.id, quantity: 1 },
      ],
    });
  });

  afterEach(() => {
    setTestUser(null);
  });

  // ============================================================
  // 1. 增加配件
  // ============================================================
  describe("增加配件", () => {
    it("可以给设备增加一个显示器配件", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
        operator: "admin",
        remark: "增加一台显示器",
      });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.assetId).toBe(assetId);

      // 验证设备配件配置已增加
      const comp = await prisma.assetComponent.findUnique({
        where: { assetId_modelId: { assetId, modelId: monitorModelId } },
      });
      expect(comp).not.toBeNull();
      expect(comp!.quantity).toBe(1);
    });

    it("增加配件时扣减对应库存", async () => {
      const beforeStock = await prisma.componentStock.findUnique({
        where: { modelId: monitorModelId },
      });
      const beforeQty = beforeStock?.quantity ?? 0;

      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 2 }],
        operator: "admin",
      });

      const afterStock = await prisma.componentStock.findUnique({
        where: { modelId: monitorModelId },
      });
      expect(afterStock!.quantity).toBe(beforeQty - 2);
    });

    it("库存不足时增加配件失败", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: extraMonitorModelId, quantityDelta: 100 }],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存");
    });

    it("增加配件会写入库存出库流水", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
        operator: "admin",
        remark: "增加显示器",
      });

      const logs = await prisma.componentStockLog.findMany({
        where: { modelId: monitorModelId, type: "UPGRADE_USE" },
        orderBy: { createdAt: "desc" },
      });
      expect(logs.length).toBe(1);
      expect(logs[0].quantity).toBe(-1);
      expect(logs[0].operator).toBe("admin");
    });

    it("增加配件会写入设备生命周期日志", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
        operator: "admin",
        remark: "增加一台显示器",
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId, action: "UPGRADED" },
        orderBy: { createdAt: "desc" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].remark).toContain("增加一台显示器");
      expect(logs[0].operator).toBe("admin");
    });

    it("增加配件会写入系统日志", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
        operator: "admin",
        remark: "加显示器",
      });

      const sysLogs = await prisma.systemLog.findMany({
        where: { module: "配置变更" },
        orderBy: { createdAt: "desc" },
      });
      expect(sysLogs.length).toBeGreaterThanOrEqual(1);
      expect(sysLogs[0].operator).toBe("admin");
      expect(sysLogs[0].detail).toContain("PC-0001");
    });
  });

  // ============================================================
  // 2. 减少配件
  // ============================================================
  describe("减少配件", () => {
    it("可以从设备上减少一个内存配件", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: memoryModelId, quantityDelta: -1 }],
        operator: "admin",
        remark: "拆下一根内存",
      });

      expect(result.success).toBe(true);

      // 验证设备配件配置已删除（数量为0时删除）
      const comp = await prisma.assetComponent.findUnique({
        where: { assetId_modelId: { assetId, modelId: memoryModelId } },
      });
      expect(comp).toBeNull();
    });

    it("减少配件时回补对应库存", async () => {
      const beforeStock = await prisma.componentStock.findUnique({
        where: { modelId: memoryModelId },
      });
      const beforeQty = beforeStock?.quantity ?? 0;

      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: memoryModelId, quantityDelta: -1 }],
        operator: "admin",
      });

      const afterStock = await prisma.componentStock.findUnique({
        where: { modelId: memoryModelId },
      });
      expect(afterStock!.quantity).toBe(beforeQty + 1);
    });

    it("减少配件数量不能超过设备上现有数量", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: memoryModelId, quantityDelta: -5 }],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不足");
    });

    it("减少设备上不存在的配件会失败", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: -1 }],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不存在");
    });

    it("减少配件会写入库存入库流水", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: memoryModelId, quantityDelta: -1 }],
        operator: "admin",
      });

      const logs = await prisma.componentStockLog.findMany({
        where: { modelId: memoryModelId, type: "UPGRADE_RETURN" },
        orderBy: { createdAt: "desc" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].quantity).toBe(1);
      expect(logs[0].operator).toBe("admin");
    });

    it("减少配件会写入设备生命周期日志", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: memoryModelId, quantityDelta: -1 }],
        operator: "admin",
        remark: "拆下内存",
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId, action: "UPGRADED" },
        orderBy: { createdAt: "desc" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].remark).toContain("拆下内存");
    });
  });

  // ============================================================
  // 3. 批量调整（增加 + 减少 = 更换）
  // ============================================================
  describe("批量调整（更换配件）", () => {
    beforeEach(async () => {
      // 先给设备加一个显示器
      await prisma.assetComponent.create({
        data: { assetId, modelId: monitorModelId, quantity: 1 },
      });
    });

    it("可以在一个事务里完成更换：拆旧显示器 + 装新显示器", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [
          { modelId: monitorModelId, quantityDelta: -1 },       // 拆下旧的
          { modelId: extraMonitorModelId, quantityDelta: 1 },   // 装上新的
        ],
        operator: "admin",
        remark: "更换显示器：24寸戴尔 → 27寸LG",
      });

      expect(result.success).toBe(true);

      // 旧显示器已移除
      const oldComp = await prisma.assetComponent.findUnique({
        where: { assetId_modelId: { assetId, modelId: monitorModelId } },
      });
      expect(oldComp).toBeNull();

      // 新显示器已安装
      const newComp = await prisma.assetComponent.findUnique({
        where: { assetId_modelId: { assetId, modelId: extraMonitorModelId } },
      });
      expect(newComp).not.toBeNull();
      expect(newComp!.quantity).toBe(1);
    });

    it("批量调整时任一步失败则全部回滚（库存不足时）", async () => {
      const beforeOldStock = (await prisma.componentStock.findUnique({
        where: { modelId: monitorModelId },
      }))!.quantity;

      const result = await adjustAssetComponents({
        assetId,
        adjustments: [
          { modelId: monitorModelId, quantityDelta: -1 },          // 拆旧的（会成功）
          { modelId: extraMonitorModelId, quantityDelta: 999 },    // 装新的（库存不足，失败）
        ],
        operator: "admin",
      });

      expect(result.success).toBe(false);

      // 事务回滚：旧显示器仍在设备上
      const oldComp = await prisma.assetComponent.findUnique({
        where: { assetId_modelId: { assetId, modelId: monitorModelId } },
      });
      expect(oldComp).not.toBeNull();
      expect(oldComp!.quantity).toBe(1);

      // 库存未变动
      const afterOldStock = (await prisma.componentStock.findUnique({
        where: { modelId: monitorModelId },
      }))!.quantity;
      expect(afterOldStock).toBe(beforeOldStock);
    });

    it("批量调整会写入一条生命周期日志，remark 包含变更摘要", async () => {
      await adjustAssetComponents({
        assetId,
        adjustments: [
          { modelId: monitorModelId, quantityDelta: -1 },
          { modelId: extraMonitorModelId, quantityDelta: 1 },
        ],
        operator: "admin",
        remark: "更换显示器",
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId, action: "UPGRADED" },
        orderBy: { createdAt: "desc" },
      });
      // 应该只有一条日志（一笔事务，一条记录）
      const upgradeLogs = logs.filter((l) => l.remark?.includes("更换显示器"));
      expect(upgradeLogs.length).toBe(1);
    });
  });

  // ============================================================
  // 4. 参数校验
  // ============================================================
  describe("参数校验", () => {
    it("设备不存在时报错", async () => {
      const result = await adjustAssetComponents({
        assetId: 99999,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不存在");
    });

    it("调整列表为空时报错", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("空");
    });

    it("数量变化不能为 0", async () => {
      const result = await adjustAssetComponents({
        assetId,
        adjustments: [{ modelId: monitorModelId, quantityDelta: 0 }],
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });

    it("需要登录才能操作", async () => {
      setTestUser(null);

      await expect(
        adjustAssetComponents({
          assetId,
          adjustments: [{ modelId: monitorModelId, quantityDelta: 1 }],
          operator: "admin",
        })
      ).rejects.toThrow();
    });
  });
});
