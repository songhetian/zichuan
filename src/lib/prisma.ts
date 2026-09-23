import { PrismaClient } from "@prisma/client";

/**
 * 从分解字段（RDS_HOST/RDS_PORT/RDS_DATABASE/RDS_USER/RDS_PASSWORD）组合出
 * DATABASE_URL。仅当进程里没有 DATABASE_URL 时才兜底（docker-compose 已用字段
 * 自动组合并注入，这里覆盖宿主机直接跑 next/prisma 脚本的场景）。
 */
function buildDbUrlFromParts(): string | undefined {
  const { RDS_HOST, RDS_PORT, RDS_DATABASE, RDS_USER, RDS_PASSWORD } = process.env;
  if (!RDS_HOST || !RDS_USER || !RDS_PASSWORD) return undefined;
  // 密码/用户含特殊字符的环境变量名不会带，但值可能含 @ : / # 等，需转义
  const esc = (s: string) => encodeURIComponent(s);
  return `mysql://${esc(RDS_USER)}:${esc(RDS_PASSWORD)}@${RDS_HOST}:${
    RDS_PORT || "3306"
  }/${RDS_DATABASE || "asset-manage"}`;
}

if (!process.env.DATABASE_URL) {
  const composed = buildDbUrlFromParts();
  if (composed) process.env.DATABASE_URL = composed;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "test" ? [] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
