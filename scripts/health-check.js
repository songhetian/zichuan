import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRISMA_ENGINE_PATH = path.join(
  __dirname,
  "..",
  "node_modules",
  ".prisma",
  "client",
  "query_engine-windows.dll.node"
);

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isFileLocked(filePath) {
  if (!fileExists(filePath)) return false;
  try {
    fs.renameSync(filePath, filePath);
    return false;
  } catch {
    return true;
  }
}

function checkPrismaClientHealth() {
  const prismaClientDir = path.join(
    __dirname,
    "..",
    "node_modules",
    "@prisma",
    "client"
  );

  if (!fileExists(path.join(prismaClientDir, "index.js"))) {
    console.log("[health-check] ⚠️  Prisma Client 未生成，需要执行 prisma generate");
    return false;
  }

  if (isFileLocked(PRISMA_ENGINE_PATH)) {
    console.log("[health-check] ⚠️  Prisma 引擎文件被锁定，可能有残留进程");
    console.log("[health-check] 💡 请运行: npm run kill-node");
    return false;
  }

  console.log("[health-check] ✅ Prisma Client 健康");
  return true;
}

function checkDatabaseConnection() {
  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();

    return prisma
      .$queryRaw`SELECT 1 as test`
      .then(() => {
        console.log("[health-check] ✅ 数据库连接正常");
        return prisma.$disconnect().then(() => true);
      })
      .catch((err) => {
        console.error("[health-check] ❌ 数据库连接失败:", err.message);
        return prisma.$disconnect().catch(() => {}).then(() => false);
      });
  } catch (err) {
    console.error("[health-check] ❌ 无法加载 Prisma Client:", err.message);
    return Promise.resolve(false);
  }
}

async function main() {
  console.log("=" .repeat(50));
  console.log("  资产管理系统 - 开发环境健康检查");
  console.log("=" .repeat(50));

  const prismaHealth = checkPrismaClientHealth();

  if (prismaHealth) {
    await checkDatabaseConnection();
  }

  console.log("=" .repeat(50));

  if (!prismaHealth) {
    console.log("\n💡 建议操作:");
    console.log("  1. npm run kill-node    # 清理残留进程");
    console.log("  2. npm run prisma:gen   # 重新生成 Prisma Client");
    console.log("  3. npm run dev          # 启动开发服务器");
    process.exit(1);
  }
}

main();