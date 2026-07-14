import { prisma } from "@/lib/prisma";

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  // 每个测试前清空所有表
  // 按依赖顺序（子表先删），MySQL 需要临时禁用外键检查
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0;");

  // 盘点相关
  await prisma.stocktakeRecord.deleteMany();
  await prisma.stocktakeSession.deleteMany();

  // 系统日志
  await prisma.systemLog.deleteMany();

  // 资产相关（有外键关联）
  await prisma.lifecycleLog.deleteMany();
  await prisma.assetComponent.deleteMany();
  await prisma.asset.deleteMany();

  // 模板相关
  await prisma.templateComponent.deleteMany();
  await prisma.deviceTemplate.deleteMany();

  // 配件相关
  await prisma.componentStockLog.deleteMany();
  await prisma.componentStock.deleteMany();
  await prisma.componentModel.deleteMany();
  await prisma.componentCategory.deleteMany();

  // 员工相关
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();

  // 设备分类
  await prisma.assetCategory.deleteMany();

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1;");
});

afterAll(async () => {
  await prisma.$disconnect();
});
