import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  console.log("开始填充测试数据...");

  const existingCategories = await prisma.assetCategory.count();
  if (existingCategories === 0) {
    const computerCat = await prisma.assetCategory.create({ data: { name: "计算机设备", code: "DN" } });
    await prisma.assetCategory.create({ data: { name: "台式机", code: "DT", parentId: computerCat.id } });
    await prisma.assetCategory.create({ data: { name: "笔记本", code: "NB", parentId: computerCat.id } });

    const networkCat = await prisma.assetCategory.create({ data: { name: "网络设备", code: "WL" } });
    await prisma.assetCategory.create({ data: { name: "交换机", code: "SW", parentId: networkCat.id } });

    const officeCat = await prisma.assetCategory.create({ data: { name: "办公设备", code: "BG" } });
    await prisma.assetCategory.create({ data: { name: "打印机", code: "PR", parentId: officeCat.id } });
    console.log("创建设备分类完成");
  } else {
    console.log("设备分类已存在，跳过创建");
  }

  const existingAdmin = await prisma.admin.findFirst();
  if (!existingAdmin) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash("admin123", 10);
    await prisma.admin.create({ data: { username: "admin", password: hash } });
    console.log("创建管理员账号 admin/admin123");
  } else {
    console.log("管理员账号已存在，跳过创建");
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

  console.log("测试数据填充完成！");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
