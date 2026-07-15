import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testConnection() {
  try {
    console.log("测试数据库连接...");
    await prisma.$connect();
    console.log("✅ 数据库连接成功");
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ 数据库连接失败:", error.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

testConnection();