/**
 * 创建目标数据库（CREATE DATABASE IF NOT EXISTS）
 *
 * 只做建库，不删库、不覆盖、不插数据。
 * 优先使用本机 mysql 客户端；找不到客户端时，若数据库跑在 Docker 容器里，
 * 则回退到 docker exec 执行（避免为了建库去装 mysql client）。
 *
 * SQL 统一通过 stdin 传入，避免在 cmd / bash / sh 之间反复转义引号与反引号。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { loadEnv, ROOT } from "./load-env.js";

loadEnv();

// 目标容器可由调用方注入（dev-start.js 用它指向开发库容器）
const CONTAINER = process.env.MYSQL_CONTAINER || "zichuan-mysql";

const dbUrl = process.env.DATABASE_URL || "mysql://root:root@localhost:3306/zichuan";

const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
if (!match) {
  console.error("[db-init] 无法解析 DATABASE_URL，请检查 .env 文件");
  process.exit(1);
}

const [, user, password, host, port, dbName] = match;

/** DB_INIT_DROP=1 时先删库再建（仅 dev:db:reset 使用，会清空该库数据） */
const drop = process.env.DB_INIT_DROP === "1";

console.log("[db-init] 数据库配置:");
console.log(`[db-init]   Host: ${host}:${port}`);
console.log(`[db-init]   User: ${user}`);
console.log(`[db-init]   Database: ${dbName}${drop ? "  【重置：先删除再重建】" : ""}`);

const sql = drop
  ? `DROP DATABASE IF EXISTS \`${dbName}\`;\nCREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`
  : `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;

function tryRun(cmd, input) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      cwd: ROOT,
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, out: (out || "").trim() };
  } catch (e) {
    return { ok: false, out: (e.stderr || e.message || "").toString().trim() };
  }
}

// ---- 候选执行方式：均为「从 stdin 读 SQL」 ----

const localClientPaths = [
  "D:\\Program Files\\FlyEnv-Data\\app\\mysql-8.2.0\\mysql-8.2.0-winx64\\bin\\mysql.exe",
  "D:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
  "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
];

const candidates = [];

for (const p of localClientPaths) {
  if (fs.existsSync(p)) {
    candidates.push({
      label: `本机客户端 ${p}`,
      cmd: `"${p}" -h ${host} -P ${port} -u ${user} -p${password} --default-character-set=utf8mb4`,
    });
  }
}

candidates.push({
  label: "PATH 中的 mysql 客户端",
  cmd: `mysql -h ${host} -P ${port} -u ${user} -p${password} --default-character-set=utf8mb4`,
});

// Docker 回退：仅当数据库就是本机端口映射的容器时适用
const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
const status = tryRun(`docker inspect -f "{{.State.Status}}" ${CONTAINER}`, "");

if (isLocalHost && status.ok && status.out === "running") {
  candidates.push({
    label: `docker exec ${CONTAINER}`,
    cmd: `docker exec -i ${CONTAINER} mysql -u${user} -p${password} --default-character-set=utf8mb4`,
  });
}

// ---- 依次尝试，首个成功即结束 ----

const errors = [];
for (const c of candidates) {
  const r = tryRun(c.cmd, sql);
  if (r.ok) {
    console.log(`[db-init] 执行方式: ${c.label}`);
    console.log(`[db-init] 数据库 ${dbName} 已就绪`);
    process.exit(0);
  }
  errors.push(`  - ${c.label}: ${r.out.split("\n").slice(-2).join(" ")}`);
}

console.error("[db-init] 创建数据库失败，以下方式均不可用:");
console.error(errors.join("\n"));
console.error("[db-init] 请确认: 1) MySQL 已启动  2) .env 中 DATABASE_URL 正确");
process.exit(1);
