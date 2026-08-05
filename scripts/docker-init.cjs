#!/usr/bin/env node
"use strict";

/**
 * docker-init.cjs — 数据库初始化前置脚本（容器内运行）
 *
 * 职责：
 *   1. 等待 MySQL 端口真正可连接（取代 compose 中脆弱的 `sleep 10`）。
 *   2. 尽力执行一次 `CREATE DATABASE IF NOT EXISTS` 兜底，
 *      确保即使 compose 的 MYSQL_DATABASE 未生效也能建库。
 *
 * 使用 .cjs 后缀：本项目 package.json 为 "type": "module"，
 * 以 CommonJS 形式运行，避免 ESM 解析问题。
 * 不依赖外部 mysql 客户端，仅用 Node 内置模块 + @prisma/client。
 */

const net = require("net");
const { PrismaClient } = require("@prisma/client");

const rawUrl =
  process.env.DATABASE_URL || "mysql://root:root@mysql:3306/asset-manage";

function parseUrl(input) {
  const u = new URL(input);
  const dbName = decodeURIComponent((u.pathname || "").replace(/^\/+/, "")) || "asset-manage";
  const host = u.hostname || "mysql";
  const port = parseInt(u.port || "3306", 10);
  return { u, host, port, dbName };
}

function waitForPort(host, port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      sock.setTimeout(2000);
      const retry = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`等待 MySQL (${host}:${port}) 超时 ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 1000);
        }
      };
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        retry();
      });
      sock.once("timeout", () => {
        sock.destroy();
        retry();
      });
    };
    attempt();
  });
}

async function ensureDatabase(u, dbName) {
  const auth = u.username
    ? `${u.username}${u.password ? ":" + u.password : ""}@`
    : "";
  const serverUrl = `${u.protocol}//${auth}${u.host}/`;
  const prisma = new PrismaClient({ datasources: { db: { url: serverUrl } } });
  try {
    await prisma.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    console.log(`[docker-init] ✅ 数据库 ${dbName} 已就绪`);
  } catch (e) {
    // 多数情况下 MySQL 已通过 MYSQL_DATABASE 建库，这里仅作兜底，
    // 失败不阻断后续 migrate deploy。
    console.warn(
      `[docker-init] ⚠️ CREATE DATABASE 未执行（可能已存在，忽略）: ${e.message}`
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function main() {
  const { u, host, port, dbName } = parseUrl(rawUrl);
  console.log(`[docker-init] DATABASE_URL=${rawUrl}`);
  console.log(`[docker-init] 等待 MySQL 就绪 ${host}:${port} ...`);
  await waitForPort(host, port);
  console.log(`[docker-init] ✅ MySQL 端口可达`);

  await ensureDatabase(u, dbName);
  console.log(`[docker-init] ✅ 前置检查完成，准备执行 migrate deploy`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[docker-init] ❌ 初始化失败: ${e.message}`);
  process.exit(1);
});
