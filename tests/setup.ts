import { prisma } from "@/lib/prisma";
import { assertSafeTestDb } from "./db-guard";

// 最先执行：确认连的是测试库，否则整个测试运行直接失败
assertSafeTestDb();

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

  // 离职交接单（依赖 Employee/ApprovalRequest/Admin，先删）
  await prisma.handoverOrder.deleteMany();

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

  // 账号/角色/权限（有外键关联，RolePermission 先删）
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();

  // 站内通知（M6：依赖 Admin 与 ApprovalRequest，先删）
  await prisma.notification.deleteMany();

  // 审批运行（ApprovalTask/Log/Request 依赖 Admin 与 WorkflowNode，先删）
  await prisma.approvalTask.deleteMany();
  await prisma.approvalLog.deleteMany();
  await prisma.approvalRequest.deleteMany();

  // 审批流程（WorkflowEdge/Node 依赖 Definition，Definition.createdById 依赖 Admin）
  await prisma.workflowEdge.deleteMany();
  await prisma.workflowNode.deleteMany();
  await prisma.workflowDefinition.deleteMany();

  await prisma.admin.deleteMany();

  // 设备分类
  await prisma.assetCategory.deleteMany();

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1;");
});

afterAll(async () => {
  await prisma.$disconnect();
});
