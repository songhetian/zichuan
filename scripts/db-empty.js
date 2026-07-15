import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function emptyDatabase() {
  console.log("[db-empty] 开始清空数据库...");

  const models = [
    "systemLog",
    "lifecycleLog",
    "assetComponent",
    "componentStockLog",
    "componentStock",
    "componentModel",
    "componentCategory",
    "templateComponent",
    "deviceTemplate",
    "asset",
    "assetCategory",
    "employee",
    "department",
    "admin",
  ];

  for (const model of models) {
    try {
      await prisma[model].deleteMany({});
      console.log(`[db-empty] ✅ 清空 ${model}`);
    } catch (error) {
      console.log(`[db-empty] ⚠️  ${model} 清空失败或为空:`, error.message);
    }
  }

  await prisma.$disconnect();
  console.log("[db-empty] ✅ 数据库清空完成");
}

emptyDatabase().catch((err) => {
  console.error("[db-empty] ❌ 清空数据库失败:", err);
  process.exit(1);
});