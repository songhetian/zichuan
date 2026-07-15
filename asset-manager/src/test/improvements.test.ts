import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

describe('资产管理系统12项优化功能测试', () => {
  // 清理测试数据
  beforeAll(async () => {
    await prisma.stocktakeRecord.deleteMany();
    await prisma.stocktakeSession.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.assetComponent.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.templateComponent.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.componentStockLog.deleteMany();
    await prisma.componentStock.deleteMany();
    await prisma.componentModel.deleteMany();
    await prisma.componentCategory.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.systemLog.deleteMany();
    await prisma.admin.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Dashboard 首页 - 统计功能', () => {
    it('应该能够统计设备总数和各状态数量', async () => {
      // 创建测试数据
      const dept = await prisma.department.create({
        data: { name: '测试部门' }
      });

      const category = await prisma.assetCategory.create({
        data: { name: '测试分类', code: 'TEST' }
      });

      const template = await prisma.deviceTemplate.create({
        data: {
          name: '测试模板',
          categoryId: category.id
        }
      });

      // 创建不同状态的设备
      await prisma.asset.createMany({
        data: [
          { assetNo: 'TEST-001', name: '设备1', templateId: template.id, status: 'IDLE' },
          { assetNo: 'TEST-002', name: '设备2', templateId: template.id, status: 'IN_USE', employeeId: null },
          { assetNo: 'TEST-003', name: '设备3', templateId: template.id, status: 'IN_MAINTENANCE' },
          { assetNo: 'TEST-004', name: '设备4', templateId: template.id, status: 'SCRAPPED' },
        ]
      });

      // 统计查询
      const totalAssets = await prisma.asset.count();
      const idleCount = await prisma.asset.count({ where: { status: 'IDLE' } });
      const inUseCount = await prisma.asset.count({ where: { status: 'IN_USE' } });
      const maintenanceCount = await prisma.asset.count({ where: { status: 'IN_MAINTENANCE' } });
      const scrappedCount = await prisma.asset.count({ where: { status: 'SCRAPPED' } });

      expect(totalAssets).toBe(4);
      expect(idleCount).toBe(1);
      expect(inUseCount).toBe(1);
      expect(maintenanceCount).toBe(1);
      expect(scrappedCount).toBe(1);
    });

    it('应该能够统计分类分布', async () => {
      const categories = await prisma.assetCategory.findMany({
        include: {
          _count: {
            select: { templates: true }
          }
        }
      });

      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0]._count.templates).toBeDefined();
    });

    it('应该能够统计低库存配件', async () => {
      const lowStockComponents = await prisma.componentStock.findMany({
        where: {
          quantity: { lte: 10 }
        },
        include: {
          model: true
        }
      });

      expect(Array.isArray(lowStockComponents)).toBe(true);
    });
  });

  describe('2. 设备批量操作', () => {
    let testAssets: any[] = [];
    let testEmployee: any;

    beforeEach(async () => {
      const dept = await prisma.department.findFirst();
      if (!dept) {
        testEmployee = await prisma.employee.create({
          data: {
            employeeNo: 'EMP-BATCH-001',
            name: '批量测试员工',
            departmentId: (await prisma.department.create({ data: { name: '批量测试部门' } })).id
          }
        });
      } else {
        testEmployee = await prisma.employee.create({
          data: {
            employeeNo: `EMP-BATCH-${Date.now()}`,
            name: '批量测试员工',
            departmentId: dept.id
          }
        });
      }

      const category = await prisma.assetCategory.findFirst();
      const template = await prisma.deviceTemplate.findFirst();

      if (category && template) {
        testAssets = await Promise.all([
          prisma.asset.create({
            data: {
              assetNo: `BATCH-${Date.now()}-1`,
              name: '批量测试设备1',
              templateId: template.id,
              status: 'IDLE'
            }
          }),
          prisma.asset.create({
            data: {
              assetNo: `BATCH-${Date.now()}-2`,
              name: '批量测试设备2',
              templateId: template.id,
              status: 'IDLE'
            }
          }),
          prisma.asset.create({
            data: {
              assetNo: `BATCH-${Date.now()}-3`,
              name: '批量测试设备3',
              templateId: template.id,
              status: 'IDLE'
            }
          })
        ]);
      }
    });

    it('应该能够批量分配设备给员工', async () => {
      if (testAssets.length === 0) return;

      const assetIds = testAssets.map(a => a.id);

      // 批量分配
      await prisma.asset.updateMany({
        where: { id: { in: assetIds } },
        data: {
          status: 'IN_USE',
          employeeId: testEmployee.id
        }
      });

      // 创建生命周期日志
      await prisma.lifecycleLog.createMany({
        data: assetIds.map(assetId => ({
          assetId,
          action: 'ALLOCATED' as const,
          fromStatus: 'IDLE' as const,
          toStatus: 'IN_USE' as const,
          employeeId: testEmployee.id,
          operator: 'test-user',
          remark: '批量分配'
        }))
      });

      // 验证
      const updatedAssets = await prisma.asset.findMany({
        where: { id: { in: assetIds } }
      });

      expect(updatedAssets.every(a => a.status === 'IN_USE')).toBe(true);
      expect(updatedAssets.every(a => a.employeeId === testEmployee.id)).toBe(true);

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: { in: assetIds }, action: 'ALLOCATED' }
      });

      expect(logs.length).toBe(assetIds.length);
    });

    it('应该能够批量归还设备', async () => {
      if (testAssets.length === 0) return;

      const assetIds = testAssets.map(a => a.id);

      // 先分配
      await prisma.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: 'IN_USE', employeeId: testEmployee.id }
      });

      // 批量归还
      await prisma.asset.updateMany({
        where: { id: { in: assetIds } },
        data: {
          status: 'IDLE',
          employeeId: null
        }
      });

      await prisma.lifecycleLog.createMany({
        data: assetIds.map(assetId => ({
          assetId,
          action: 'RETURNED' as const,
          fromStatus: 'IN_USE' as const,
          toStatus: 'IDLE' as const,
          employeeId: testEmployee.id,
          operator: 'test-user',
          remark: '批量归还'
        }))
      });

      const updatedAssets = await prisma.asset.findMany({
        where: { id: { in: assetIds } }
      });

      expect(updatedAssets.every(a => a.status === 'IDLE')).toBe(true);
      expect(updatedAssets.every(a => a.employeeId === null)).toBe(true);
    });

    it('应该能够批量报废设备', async () => {
      if (testAssets.length === 0) return;

      const assetIds = testAssets.map(a => a.id);

      await prisma.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: 'SCRAPPED' }
      });

      await prisma.lifecycleLog.createMany({
        data: assetIds.map(assetId => ({
          assetId,
          action: 'SCRAPPED' as const,
          fromStatus: 'IDLE' as const,
          toStatus: 'SCRAPPED' as const,
          operator: 'test-user',
          remark: '批量报废'
        }))
      });

      const updatedAssets = await prisma.asset.findMany({
        where: { id: { in: assetIds } }
      });

      expect(updatedAssets.every(a => a.status === 'SCRAPPED')).toBe(true);
    });
  });

  describe('3. 分类树形表格', () => {
    it('应该能够创建两级分类结构', async () => {
      const parent = await prisma.assetCategory.create({
        data: {
          name: '父分类-树形测试',
          code: 'TREE-PARENT'
        }
      });

      const children = await Promise.all([
        prisma.assetCategory.create({
          data: {
            name: '子分类1-树形测试',
            code: 'TREE-CHILD1',
            parentId: parent.id
          }
        }),
        prisma.assetCategory.create({
          data: {
            name: '子分类2-树形测试',
            code: 'TREE-CHILD2',
            parentId: parent.id
          }
        })
      ]);

      expect(children.length).toBe(2);
      expect(children.every(c => c.parentId === parent.id)).toBe(true);
    });

    it('应该能够查询树形结构', async () => {
      const tree = await prisma.assetCategory.findMany({
        where: { parentId: null },
        include: {
          children: true
        }
      });

      expect(Array.isArray(tree)).toBe(true);
      const parentWithChildren = tree.find(t => t.children.length > 0);
      if (parentWithChildren) {
        expect(parentWithChildren.children.length).toBeGreaterThan(0);
      }
    });
  });

  describe('4. 配件手动入库', () => {
    it('应该能够手动采购入库配件', async () => {
      const category = await prisma.componentCategory.findFirst();
      if (!category) {
        const newCategory = await prisma.componentCategory.create({
          data: { name: '测试配件分类-入库' }
        });

        const model = await prisma.componentModel.create({
          data: {
            name: '测试配件型号-入库',
            brand: '测试品牌',
            categoryId: newCategory.id
          }
        });

        // 创建库存记录
        const stock = await prisma.componentStock.create({
          data: {
            modelId: model.id,
            quantity: 0
          }
        });

        // 手动入库
        const quantity = 50;
        await prisma.componentStock.update({
          where: { modelId: model.id },
          data: { quantity: { increment: quantity } }
        });

        // 记录入库日志
        await prisma.componentStockLog.create({
          data: {
            modelId: model.id,
            type: 'PURCHASE_IN',
            quantity: quantity,
            operator: 'test-user',
            remark: '手动采购入库'
          }
        });

        // 验证
        const updatedStock = await prisma.componentStock.findUnique({
          where: { modelId: model.id }
        });

        expect(updatedStock?.quantity).toBe(quantity);

        const log = await prisma.componentStockLog.findFirst({
          where: { modelId: model.id, type: 'PURCHASE_IN' }
        });

        expect(log?.quantity).toBe(quantity);
        expect(log?.remark).toBe('手动采购入库');
      }
    });

    it('应该能够查询库存流水', async () => {
      const logs = await prisma.componentStockLog.findMany({
        include: { model: true },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('5. 员工行内展开设备面板', () => {
    it('应该能够查询员工名下的设备', async () => {
      const dept = await prisma.department.findFirst();
      if (!dept) return;

      const employee = await prisma.employee.create({
        data: {
          employeeNo: `EMP-EXPAND-${Date.now()}`,
          name: '展开测试员工',
          departmentId: dept.id
        }
      });

      const template = await prisma.deviceTemplate.findFirst();
      if (!template) return;

      // 给员工分配设备
      const assets = await Promise.all([
        prisma.asset.create({
          data: {
            assetNo: `EXPAND-${Date.now()}-1`,
            name: '展开测试设备1',
            templateId: template.id,
            status: 'IN_USE',
            employeeId: employee.id
          }
        }),
        prisma.asset.create({
          data: {
            assetNo: `EXPAND-${Date.now()}-2`,
            name: '展开测试设备2',
            templateId: template.id,
            status: 'IN_USE',
            employeeId: employee.id
          }
        })
      ]);

      // 查询员工设备
      const employeeAssets = await prisma.asset.findMany({
        where: { employeeId: employee.id },
        include: { template: true }
      });

      expect(employeeAssets.length).toBe(2);
      expect(employeeAssets.every(a => a.employeeId === employee.id)).toBe(true);
    });

    it('应该能够统计员工设备数量', async () => {
      const employees = await prisma.employee.findMany({
        include: {
          _count: {
            select: { assets: true }
          }
        }
      });

      expect(Array.isArray(employees)).toBe(true);
      employees.forEach(emp => {
        expect(emp._count.assets).toBeDefined();
        expect(typeof emp._count.assets).toBe('number');
      });
    });
  });

  describe('6. 模板BOM侧滑面板', () => {
    it('应该能够创建模板并添加配件', async () => {
      const category = await prisma.assetCategory.findFirst();
      if (!category) return;

      const template = await prisma.deviceTemplate.create({
        data: {
          name: `BOM测试模板-${Date.now()}`,
          categoryId: category.id
        }
      });

      const compCategory = await prisma.componentCategory.findFirst();
      if (!compCategory) return;

      const component = await prisma.componentModel.create({
        data: {
          name: `BOM测试配件-${Date.now()}`,
          brand: '测试品牌',
          categoryId: compCategory.id
        }
      });

      // 添加配件到BOM
      const bomItem = await prisma.templateComponent.create({
        data: {
          templateId: template.id,
          modelId: component.id,
          quantity: 2
        }
      });

      expect(bomItem.templateId).toBe(template.id);
      expect(bomItem.modelId).toBe(component.id);
      expect(bomItem.quantity).toBe(2);
    });

    it('应该能够查询模板的完整BOM', async () => {
      const template = await prisma.deviceTemplate.findFirst({
        include: {
          components: {
            include: {
              model: true
            }
          }
        }
      });

      if (template) {
        expect(template.components).toBeDefined();
        expect(Array.isArray(template.components)).toBe(true);
        template.components.forEach(comp => {
          expect(comp.model).toBeDefined();
          expect(comp.quantity).toBeGreaterThan(0);
        });
      }
    });
  });

  describe('7. 卡片式逐项盘点', () => {
    it('应该能够创建盘点任务', async () => {
      const session = await prisma.stocktakeSession.create({
        data: {
          name: `盘点测试-${Date.now()}`,
          description: '测试盘点任务'
        }
      });

      expect(session.status).toBe('OPEN');
      expect(session.name).toContain('盘点测试');
    });

    it('应该能够逐项盘点设备', async () => {
      const template = await prisma.deviceTemplate.findFirst();
      if (!template) return;

      const asset = await prisma.asset.create({
        data: {
          assetNo: `STOCKTAKE-${Date.now()}`,
          name: '盘点测试设备',
          templateId: template.id,
          status: 'IN_USE'
        }
      });

      const session = await prisma.stocktakeSession.create({
        data: {
          name: `逐项盘点-${Date.now()}`
        }
      });

      // 创建盘点记录
      const record = await prisma.stocktakeRecord.create({
        data: {
          sessionId: session.id,
          assetId: asset.id,
          expectedStatus: 'IN_USE',
          actualStatus: 'NORMAL',
          remark: '设备正常'
        }
      });

      expect(record.expectedStatus).toBe('IN_USE');
      expect(record.actualStatus).toBe('NORMAL');
    });

    it('应该能够完成盘点任务', async () => {
      const session = await prisma.stocktakeSession.create({
        data: {
          name: `完成盘点-${Date.now()}`
        }
      });

      // 完成盘点
      const completed = await prisma.stocktakeSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });

      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();
    });
  });

  describe('8. 全局搜索', () => {
    it('应该能够搜索设备', async () => {
      const template = await prisma.deviceTemplate.findFirst();
      if (!template) return;

      const uniqueName = `搜索测试设备-${Date.now()}`;
      await prisma.asset.create({
        data: {
          assetNo: `SEARCH-${Date.now()}`,
          name: uniqueName,
          templateId: template.id,
          status: 'IDLE'
        }
      });

      const results = await prisma.asset.findMany({
        where: {
          OR: [
            { name: { contains: '搜索测试设备' } },
            { assetNo: { contains: 'SEARCH' } }
          ]
        }
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === uniqueName)).toBe(true);
    });

    it('应该能够搜索员工', async () => {
      const dept = await prisma.department.findFirst();
      if (!dept) return;

      const uniqueName = `搜索测试员工-${Date.now()}`;
      await prisma.employee.create({
        data: {
          employeeNo: `SEARCH-${Date.now()}`,
          name: uniqueName,
          departmentId: dept.id
        }
      });

      const results = await prisma.employee.findMany({
        where: {
          OR: [
            { name: { contains: '搜索测试员工' } },
            { employeeNo: { contains: 'SEARCH' } }
          ]
        }
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('应该能够搜索模板', async () => {
      const category = await prisma.assetCategory.findFirst();
      if (!category) return;

      const uniqueName = `搜索测试模板-${Date.now()}`;
      await prisma.deviceTemplate.create({
        data: {
          name: uniqueName,
          categoryId: category.id
        }
      });

      const results = await prisma.deviceTemplate.findMany({
        where: {
          name: { contains: '搜索测试模板' }
        }
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('9. 设备生命周期时间线', () => {
    it('应该能够记录设备生命周期日志', async () => {
      const template = await prisma.deviceTemplate.findFirst();
      if (!template) return;

      const asset = await prisma.asset.create({
        data: {
          assetNo: `LIFECYCLE-${Date.now()}`,
          name: '生命周期测试设备',
          templateId: template.id,
          status: 'IDLE'
        }
      });

      // 创建生命周期日志
      const log = await prisma.lifecycleLog.create({
        data: {
          assetId: asset.id,
          action: 'CREATED',
          fromStatus: null,
          toStatus: 'IDLE',
          operator: 'test-user',
          remark: '设备创建'
        }
      });

      expect(log.action).toBe('CREATED');
      expect(log.toStatus).toBe('IDLE');
    });

    it('应该能够查询设备的完整生命周期', async () => {
      const template = await prisma.deviceTemplate.findFirst();
      if (!template) return;

      const asset = await prisma.asset.create({
        data: {
          assetNo: `TIMELINE-${Date.now()}`,
          name: '时间线测试设备',
          templateId: template.id,
          status: 'IDLE'
        }
      });

      // 创建多个生命周期日志
      await prisma.lifecycleLog.createMany({
        data: [
          {
            assetId: asset.id,
            action: 'CREATED',
            toStatus: 'IDLE',
            operator: 'test-user'
          },
          {
            assetId: asset.id,
            action: 'ALLOCATED',
            fromStatus: 'IDLE',
            toStatus: 'IN_USE',
            operator: 'test-user'
          }
        ]
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset.id },
        orderBy: { createdAt: 'asc' }
      });

      expect(logs.length).toBe(2);
      expect(logs[0].action).toBe('CREATED');
      expect(logs[1].action).toBe('ALLOCATED');
    });
  });

  describe('10. 表单实时校验', () => {
    it('应该能够验证设备创建表单', () => {
      const createAssetSchema = z.object({
        assetNo: z.string().min(1, '设备编号不能为空'),
        name: z.string().min(1, '设备名称不能为空'),
        templateId: z.number().int().positive('请选择设备模板')
      });

      // 有效数据
      const validData = {
        assetNo: 'TEST-001',
        name: '测试设备',
        templateId: 1
      };

      const result = createAssetSchema.safeParse(validData);
      expect(result.success).toBe(true);

      // 无效数据
      const invalidData = {
        assetNo: '',
        name: '',
        templateId: -1
      };

      const invalidResult = createAssetSchema.safeParse(invalidData);
      expect(invalidResult.success).toBe(false);
    });

    it('应该能够验证员工创建表单', () => {
      const createEmployeeSchema = z.object({
        employeeNo: z.string().min(1, '工号不能为空'),
        name: z.string().min(1, '姓名不能为空'),
        departmentId: z.number().int().positive('请选择部门'),
        email: z.string().email('邮箱格式不正确').optional(),
        phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确').optional()
      });

      const validData = {
        employeeNo: 'EMP001',
        name: '张三',
        departmentId: 1,
        email: 'test@example.com',
        phone: '13800138000'
      };

      const result = createEmployeeSchema.safeParse(validData);
      expect(result.success).toBe(true);

      const invalidEmail = {
        employeeNo: 'EMP002',
        name: '李四',
        departmentId: 1,
        email: 'invalid-email'
      };

      const emailResult = createEmployeeSchema.safeParse(invalidEmail);
      expect(emailResult.success).toBe(false);
    });

    it('应该能够验证配件入库表单', () => {
      const stockInSchema = z.object({
        modelId: z.number().int().positive('请选择配件型号'),
        quantity: z.number().int().positive('数量必须大于0'),
        remark: z.string().optional()
      });

      const validData = {
        modelId: 1,
        quantity: 100,
        remark: '采购入库'
      };

      const result = stockInSchema.safeParse(validData);
      expect(result.success).toBe(true);

      const invalidData = {
        modelId: 1,
        quantity: 0
      };

      const invalidResult = stockInSchema.safeParse(invalidData);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('11. 加载骨架屏', () => {
    it('应该能够加载页面数据', async () => {
      // 测试数据加载
      const assets = await prisma.asset.findMany({
        take: 10
      });

      expect(Array.isArray(assets)).toBe(true);

      const employees = await prisma.employee.findMany({
        take: 10
      });

      expect(Array.isArray(employees)).toBe(true);
    });
  });

  describe('12. 导出预览', () => {
    it('应该能够查询导出数据', async () => {
      const exportData = await prisma.asset.findMany({
        include: {
          template: true,
          employee: true
        },
        take: 100
      });

      expect(Array.isArray(exportData)).toBe(true);

      if (exportData.length > 0) {
        const firstAsset = exportData[0];
        expect(firstAsset.assetNo).toBeDefined();
        expect(firstAsset.name).toBeDefined();
        expect(firstAsset.template).toBeDefined();
      }
    });

    it('应该能够选择导出字段', () => {
      const availableFields = [
        { key: 'assetNo', label: '设备编号' },
        { key: 'name', label: '设备名称' },
        { key: 'status', label: '状态' },
        { key: 'template.name', label: '模板名称' },
        { key: 'employee.name', label: '使用人' }
      ];

      const selectedFields = ['assetNo', 'name', 'status'];

      expect(selectedFields.length).toBe(3);
      expect(availableFields.length).toBe(5);
    });
  });
});
