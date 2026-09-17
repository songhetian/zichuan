import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./load-env.js";

loadEnv();

// ---------- 安全闸门 ----------
// 本脚本会清空所有业务表。Prisma 默认读 .env，而 .env 指向真实库 3308/asset-manage，
// 所以必须显式限制：库名以 -dev / -test 结尾才允许执行。
const dbName = (process.env.DATABASE_URL || "").split("/").pop()?.split("?")[0] || "";

if (!/(?:-dev|-test)$/.test(dbName) && process.env.ALLOW_REAL_DB !== "1") {
  console.error("");
  console.error("  已阻止执行（安全闸门）");
  console.error(`  当前 DATABASE_URL 指向: ${dbName || "(未设置)"}`);
  console.error("  本脚本会清空所有业务表，只允许对隔离库（-dev / -test 结尾）执行。");
  console.error("");
  console.error("  清空开发库请用： npm run db reset");
  console.error("  确要清空真实库： ALLOW_REAL_DB=1 node scripts/db-empty.js");
  console.error("");
  process.exit(1);
}

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