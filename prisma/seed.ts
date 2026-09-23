import { PrismaClient } from "@prisma/client";
import {
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSION_MATRIX,
} from "@/lib/permissions";
import { bootstrapOrgData, ORG_BOOTSTRAP_DEFAULT_PASSWORD } from "@/lib/org-bootstrap";

const prisma = new PrismaClient();

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
  ASSET_MANAGER: "资产管理员",
  DEPT_MANAGER: "部门主管",
  EMPLOYEE: "普通员工",
};

/** 幂等：权限点 + 四默认角色 + 权限矩阵（数据源 src/lib/permissions.ts） */
async function seedRoles() {
  // 权限点
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, name: p.name },
      create: { key: p.key, module: p.module, name: p.name },
    });
  }
  const permMap = new Map(
    (await prisma.permission.findMany()).map((p) => [p.key, p.id])
  );

  // 角色：仅在角色【尚无任何权限关联】时初始化默认矩阵。
  // 这样不会覆盖运行中在 UI 对角色权限做过的调整（重复部署 db-init 安全）。
  for (const key of ROLE_KEYS) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: ROLE_NAMES[key], isSystem: true },
      create: { key, name: ROLE_NAMES[key], isSystem: true },
    });
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (existing > 0) {
      console.log(`角色 ${key} 已有 ${existing} 条权限，跳过矩阵重置（保留运行时改动）`);
      continue;
    }
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSION_MATRIX[key].map((p) => ({
        roleId: role.id,
        permissionId: permMap.get(p)!,
      })),
    });
  }
  console.log("四默认角色 + 权限矩阵已就绪");
}

/** 默认升级配件流程（决策10）：员工 → 部门主管 → 资产管理员 → 自动执行；幂等 */
async function seedDefaultWorkflow() {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { businessType: "ASSET_UPGRADE" },
  });
  if (existing) {
    console.log("默认升级配件流程已存在，跳过创建");
    return;
  }
  await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_UPGRADE",
      name: "申请升级配件流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      nodes: {
        create: [
          {
            nodeKey: "n1",
            name: "部门主管审批",
            type: "APPROVAL",
            sortOrder: 0,
            assigneeType: "DEPT_MANAGER",
            ccType: "NONE",
            // spec §5.1：抄送发起人本人 + 资产管理员（多规则并集）
            ccRules: [
              { type: "INITIATOR" },
              { type: "ROLE", roleKey: "ASSET_MANAGER" },
            ],
          },
          {
            nodeKey: "n2",
            name: "资产管理员审批",
            type: "APPROVAL",
            sortOrder: 1,
            assigneeType: "ROLE",
            assigneeRole: "ASSET_MANAGER",
            ccType: "INITIATOR",
          },
        ],
      },
    },
  });
  console.log("创建默认升级配件流程（v1，已发布）");
}

/** 默认资产报废流程：员工 → 部门主管 → 资产管理员 → 自动执行报废；幂等 */
async function seedDefaultScrapWorkflow() {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { businessType: "ASSET_SCRAP" },
  });
  if (existing) {
    console.log("默认资产报废流程已存在，跳过创建");
    return;
  }
  await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_SCRAP",
      name: "申请资产报废流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      nodes: {
        create: [
          {
            nodeKey: "n1",
            name: "部门主管审批",
            type: "APPROVAL",
            sortOrder: 0,
            assigneeType: "DEPT_MANAGER",
            ccType: "NONE",
            ccRules: [{ type: "INITIATOR" }, { type: "ROLE", roleKey: "ASSET_MANAGER" }],
          },
          {
            nodeKey: "n2",
            name: "资产管理员审批",
            type: "APPROVAL",
            sortOrder: 1,
            assigneeType: "ROLE",
            assigneeRole: "ASSET_MANAGER",
            ccType: "INITIATOR",
          },
        ],
      },
    },
  });
  console.log("创建默认资产报废流程（v1，已发布）");
}

async function seed() {
  console.log("开始填充测试数据...");

  const existingCategories = await prisma.assetCategory.count();
  if (existingCategories === 0) {
    // 默认编号规则：前缀 + 6 位随机字符（排除易混淆字符，冲突概率极低）
    const defaultRule = "{prefix}-{R6}";

    const computerCat = await prisma.assetCategory.create({
      data: { name: "计算机设备", code: "DN", numberingRule: defaultRule },
    });
    await prisma.assetCategory.create({
      data: { name: "台式机", code: "DT", parentId: computerCat.id, numberingRule: defaultRule },
    });
    await prisma.assetCategory.create({
      data: { name: "笔记本", code: "NB", parentId: computerCat.id, numberingRule: defaultRule },
    });

    const networkCat = await prisma.assetCategory.create({
      data: { name: "网络设备", code: "WL", numberingRule: defaultRule },
    });
    await prisma.assetCategory.create({
      data: { name: "交换机", code: "SW", parentId: networkCat.id, numberingRule: defaultRule },
    });

    const officeCat = await prisma.assetCategory.create({
      data: { name: "办公设备", code: "BG", numberingRule: defaultRule },
    });
    await prisma.assetCategory.create({
      data: { name: "打印机", code: "PR", parentId: officeCat.id, numberingRule: defaultRule },
    });
    console.log("创建设备分类完成（默认编号规则：{prefix}-{R6}）");
  } else {
    console.log("设备分类已存在，跳过创建");
  }

  // 角色 + 权限矩阵必须先于账号（账号要绑角色）
  await seedRoles();

  // 管理员账号：按 username（'admin'）幂等处理，顺序无关、不重复创建、不覆盖迁移来的密码。
  // 已存在（含 import 迁移进来的旧 admin）→ 跳过创建；但若 roleId 为空一定是旧库账号，
  // 补绑 SUPER_ADMIN，避免被锁在系统外（否则全新库才创建 admin/admin123）。
  const superRole = await prisma.role.findUnique({
    where: { key: "SUPER_ADMIN" },
  });
  const adminAcct = await prisma.admin.findUnique({ where: { username: "admin" } });
  if (!adminAcct) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash("admin123", 10);
    await prisma.admin.create({
      data: {
        username: "admin",
        password: hash,
        displayName: "系统管理员",
        roleId: superRole?.id ?? null,
      },
    });
    console.log("创建管理员账号 admin/admin123（超级管理员）");
  } else {
    if (adminAcct.roleId === null && superRole) {
      await prisma.admin.update({
        where: { id: adminAcct.id },
        data: { roleId: superRole.id },
      });
      console.log(`已为账号 ${adminAcct.username} 补绑超级管理员角色`);
    }
    console.log("管理员账号 admin 已存在，跳过创建");
  }

  const existingLogs = await prisma.systemLog.count();
  if (existingLogs === 0) {
    await prisma.systemLog.createMany({
      data: [
        {
          module: "分配",
          action: "ALLOCATED",
          detail: "设备 DN-0001 分配给员工 张三",
          operator: "admin",
        },
        {
          module: "归还",
          action: "RETURNED",
          detail: "设备 DN-0004 由员工 李四 归还",
          operator: "admin",
        },
        {
          module: "调拨",
          action: "TRANSFERRED",
          detail: "设备 NB-0001 从技术部调拨到市场部",
          operator: "admin",
        },
        {
          module: "报废",
          action: "SCRAPPED",
          detail: "设备 DN-0002 已报废处理",
          operator: "admin",
        },
        {
          module: "分配",
          action: "ALLOCATED",
          detail: "设备 SW-0001 分配给员工 王五",
          operator: "admin",
        },
        {
          module: "归还",
          action: "RETURNED",
          detail: "设备 PR-0001 由员工 张三 归还",
          operator: "admin",
        },
      ],
    });
    console.log("创建 6 条系统日志完成");
  } else {
    console.log("系统日志已存在，跳过创建");
  }

  // 默认审批流程（依赖权限枚举，放在角色种子之后）
  await seedDefaultWorkflow();
  await seedDefaultScrapWorkflow();

  // 演示组织数据：部门 + 员工 + 主管指派 + 全员账号（幂等，已有员工则跳过）
  const org = await bootstrapOrgData([
    { name: "技术部", employeeCount: 24 },
    { name: "产品部", employeeCount: 18 },
    { name: "设计部", employeeCount: 16 },
    { name: "市场部", employeeCount: 18 },
    { name: "运营部", employeeCount: 18 },
    { name: "财务部", employeeCount: 16 },
    { name: "人事部", employeeCount: 14 },
    { name: "客服部", employeeCount: 18 },
  ]);
  if (org.skipped) {
    console.log("演示组织数据已存在，跳过创建");
  } else {
    console.log(
      `创建演示组织数据：${org.departments} 部门 / ${org.employees} 员工（含主管指派）/ ${org.admins} 个登录账号（用户名=工号，初始密码 ${ORG_BOOTSTRAP_DEFAULT_PASSWORD}）`
    );
  }

  console.log("测试数据填充完成！");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
