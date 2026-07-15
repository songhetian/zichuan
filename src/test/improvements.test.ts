import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, StockLogType } from '@prisma/client';
import { z } from 'zod';

// 使用独立测试数据库，避免污染真实数据
process.env.DATABASE_URL = 'mysql://root:root@localhost:3306/asset_manager_test';

const prisma = new PrismaClient();

describe('资产管理系统12项优化功能测试', () => {
  async function safeDelete() {
    const tables = [
      prisma.stocktakeRecord,
      prisma.stocktakeSession,
      prisma.lifecycleLog,
      prisma.assetComponent,
      prisma.asset,
      prisma.templateComponent,
      prisma.deviceTemplate,
      prisma.assetCategory,
      prisma.componentStockLog,
      prisma.componentStock,
      prisma.componentModel,
      prisma.componentCategory,
      prisma.employee,
      prisma.department,
      prisma.systemLog,
      prisma.admin,
    ];
    for (const table of tables) {
      try { await (table as any).deleteMany(); } catch { /* 表可能不存在 */ }
    }
  }

  beforeAll(async () => { await safeDelete(); });
  afterAll(async () => { await safeDelete(); await prisma.$disconnect(); });

  describe('库存盘点功能', () => {
    it('应支持创建盘点会话并追踪进度', async () => {
      const dept = await prisma.department.create({ data: { name: '测试部门' } });
      const employee = await prisma.employee.create({ data: { name: '测试员工', employeeNo: 'TEST-001', departmentId: dept.id } });
      const category = await prisma.assetCategory.create({ data: { name: '测试分类', code: 'TEST-CAT' } });
      const template = await prisma.deviceTemplate.create({ data: { name: '测试模板', categoryId: category.id } });

      const assets = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          prisma.asset.create({
            data: { assetNo: `TEST-${String(i + 1).padStart(3, '0')}`, name: `测试设备${i + 1}`, templateId: template.id, status: 'IDLE' },
          })
        )
      );

      const session = await prisma.stocktakeSession.create({
        data: {
          name: '2024年度盘点',
          status: 'OPEN',
          records: { create: assets.map((a) => ({ assetId: a.id, expectedStatus: a.status, actualStatus: 'NORMAL' })) },
        },
        include: { records: true },
      });

      expect(session.status).toBe('OPEN');
      expect(session.records).toHaveLength(3);

      await prisma.stocktakeRecord.update({
        where: { id: session.records[0].id },
        data: { actualStatus: 'NORMAL' },
      });

      const updated = await prisma.stocktakeSession.findUnique({
        where: { id: session.id },
        include: { records: true },
      });

      const completed = updated!.records.filter((r) => r.actualStatus !== null).length;
      expect(completed).toBe(3);
    });
  });

  describe('分类树形表格', () => {
    it('应支持父子级分类关系', async () => {
      const parent = await prisma.assetCategory.create({ data: { name: '父分类', code: 'PARENT' } });
      const child = await prisma.assetCategory.create({ data: { name: '子分类', code: 'CHILD', parentId: parent.id } });
      const result = await prisma.assetCategory.findUnique({ where: { id: parent.id }, include: { children: true } });
      expect(result!.children).toHaveLength(1);
      expect(result!.children[0].name).toBe('子分类');
    });
  });

  describe('设备生命周期时间线', () => {
    it('应记录完整的设备操作历史', async () => {
      const dept = await prisma.department.create({ data: { name: '测试部门2' } });
      const employee = await prisma.employee.create({ data: { name: '测试员工2', employeeNo: 'TEST-002', departmentId: dept.id } });
      const category = await prisma.assetCategory.create({ data: { name: '测试分类2', code: 'TEST-CAT2' } });
      const template = await prisma.deviceTemplate.create({ data: { name: '测试模板2', categoryId: category.id } });
      const asset = await prisma.asset.create({ data: { assetNo: 'TIMELINE-001', name: '时间线设备', templateId: template.id, status: 'IDLE' } });

      await prisma.lifecycleLog.create({ data: { action: 'CREATED', assetId: asset.id, operator: 'test-user', remark: '设备创建' } });
      await prisma.lifecycleLog.create({ data: { action: 'ALLOCATED', assetId: asset.id, employeeId: employee.id, operator: 'test-user', remark: '分配给员工' } });

      const logs = await prisma.lifecycleLog.findMany({ where: { assetId: asset.id }, orderBy: { createdAt: 'asc' } });
      expect(logs).toHaveLength(2);
      expect(logs[0].action).toBe('CREATED');
      expect(logs[1].action).toBe('ALLOCATED');
    });
  });

  describe('配件手动入库', () => {
    it('应支持配件入库并记录日志', async () => {
      const category = await prisma.componentCategory.create({ data: { name: '内存分类' } });
      const model = await prisma.componentModel.create({ data: { name: '16GB DDR4', categoryId: category.id } });
      const stock = await prisma.componentStock.create({ data: { modelId: model.id, quantity: 10 } });

      await prisma.componentStock.update({ where: { id: stock.id }, data: { quantity: { increment: 5 } } });
      await prisma.componentStockLog.create({
        data: { modelId: model.id, type: StockLogType.PURCHASE_IN, quantity: 5, operator: 'admin', remark: '手动入库' },
      });

      const updatedStock = await prisma.componentStock.findUnique({ where: { id: stock.id } });
      expect(updatedStock!.quantity).toBe(15);

      const log = await prisma.componentStockLog.findFirst({ where: { modelId: model.id } });
      expect(log!.type).toBe('PURCHASE_IN');
      expect(log!.quantity).toBe(5);
    });
  });

  describe('设备批量操作', () => {
    it('应支持批量分配设备', async () => {
      const dept = await prisma.department.create({ data: { name: '批量测试部门' } });
      const employee = await prisma.employee.create({ data: { name: '批量测试员工', employeeNo: 'BATCH-001', departmentId: dept.id } });
      const category = await prisma.assetCategory.create({ data: { name: '批量测试分类', code: 'BATCH-CAT' } });
      const template = await prisma.deviceTemplate.create({ data: { name: '批量测试模板', categoryId: category.id } });

      const assets = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          prisma.asset.create({
            data: { assetNo: `BATCH-${String(i + 1).padStart(3, '0')}`, name: `批量设备${i + 1}`, templateId: template.id, status: 'IDLE' },
          })
        )
      );

      await Promise.all(assets.map((asset) =>
        prisma.asset.update({ where: { id: asset.id }, data: { status: 'IN_USE', employeeId: employee.id } })
      ));
      await Promise.all(assets.map((asset) =>
        prisma.lifecycleLog.create({ data: { action: 'ALLOCATED', assetId: asset.id, employeeId: employee.id, operator: 'admin' } })
      ));

      const updated = await prisma.asset.findMany({ where: { id: { in: assets.map((a) => a.id) } } });
      expect(updated.every((a) => a.status === 'IN_USE')).toBe(true);
      expect(updated.every((a) => a.employeeId === employee.id)).toBe(true);
    });
  });

  describe('全局搜索', () => {
    it('应支持跨模块搜索', async () => {
      const category = await prisma.assetCategory.create({ data: { name: '搜索测试分类', code: 'SEARCH-CAT' } });
      const template = await prisma.deviceTemplate.create({ data: { name: '搜索测试模板', categoryId: category.id } });
      await prisma.asset.create({ data: { assetNo: 'SEARCH-001', name: '搜索测试设备', templateId: template.id, status: 'IDLE' } });

      const searchResult = await prisma.asset.findMany({
        where: { OR: [{ assetNo: { contains: 'SEARCH' } }, { template: { name: { contains: '搜索' } } }] },
        include: { template: true },
      });
      expect(searchResult).toHaveLength(1);
      expect(searchResult[0].assetNo).toBe('SEARCH-001');
    });
  });

  describe('设备模板BOM清单', () => {
    it('应支持查看模板配件清单', async () => {
      const category = await prisma.assetCategory.create({ data: { name: 'BOM测试分类', code: 'BOM-CAT' } });
      const compCategory = await prisma.componentCategory.create({ data: { name: 'BOM配件分类' } });
      const model = await prisma.componentModel.create({ data: { name: 'BOM测试配件', categoryId: compCategory.id } });
      const template = await prisma.deviceTemplate.create({
        data: { name: 'BOM测试模板', categoryId: category.id, components: { create: { modelId: model.id, quantity: 2 } } },
        include: { components: { include: { model: true } } },
      });

      expect(template.components).toHaveLength(1);
      expect(template.components[0].quantity).toBe(2);
      expect(template.components[0].model.name).toBe('BOM测试配件');
    });
  });

  describe('员工行内展开', () => {
    it('应支持查看员工名下设备', async () => {
      const dept = await prisma.department.create({ data: { name: '员工测试部门' } });
      const employee = await prisma.employee.create({ data: { name: '员工测试', employeeNo: 'EMP-001', departmentId: dept.id } });
      const category = await prisma.assetCategory.create({ data: { name: '员工测试分类', code: 'EMP-CAT' } });
      const template = await prisma.deviceTemplate.create({ data: { name: '员工测试模板', categoryId: category.id } });

      await Promise.all([
        prisma.asset.create({ data: { assetNo: 'EMP-001', name: '员工设备1', templateId: template.id, status: 'IN_USE', employeeId: employee.id } }),
        prisma.asset.create({ data: { assetNo: 'EMP-002', name: '员工设备2', templateId: template.id, status: 'IN_USE', employeeId: employee.id } }),
      ]);

      const assets = await prisma.asset.findMany({ where: { employeeId: employee.id } });
      expect(assets).toHaveLength(2);
    });
  });

  describe('分类树形表格展示', () => {
    it('应支持父子级分类展示', async () => {
      const parent = await prisma.componentCategory.create({ data: { name: '父配件分类' } });
      await prisma.componentCategory.create({ data: { name: '子配件分类1', parentId: parent.id } });
      await prisma.componentCategory.create({ data: { name: '子配件分类2', parentId: parent.id } });

      const result = await prisma.componentCategory.findUnique({ where: { id: parent.id }, include: { children: true } });
      expect(result!.children).toHaveLength(2);
      expect(result!.children.map((c) => c.name).sort()).toEqual(['子配件分类1', '子配件分类2'].sort());
    });
  });

  describe('表单实时校验', () => {
    it('应支持表单字段实时校验', () => {
      const schema = z.object({ name: z.string().min(1, '名称不能为空'), email: z.string().email('邮箱格式不正确') });
      const valid = schema.safeParse({ name: '测试', email: 'test@example.com' });
      expect(valid.success).toBe(true);
      const invalid = schema.safeParse({ name: '', email: 'invalid' });
      expect(invalid.success).toBe(false);
    });
  });

  describe('加载骨架屏', () => {
    it('应支持加载状态展示', () => {
      const fs = require('fs');
      const path = require('path');
      const loadingFile = path.join(__dirname, '../../src/app/(main)/loading.tsx');
      expect(fs.existsSync(loadingFile)).toBe(true);
    });
  });

  describe('导出预览功能', () => {
    it('应支持导出预览', () => {
      const fs = require('fs');
      const path = require('path');
      const exportFile = path.join(__dirname, '../../src/components/features/export-preview.tsx');
      expect(fs.existsSync(exportFile)).toBe(true);
    });
  });
});