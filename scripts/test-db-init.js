/**
 * 初始化测试库（asset-manage-test）
 *
 *   npm run db test:init
 *   （等价于 npm run test 前的必要准备；测试库不存在时先跑这个）
 *
 * 测试库与开发库同实例、不同库名；测试会清空所有表，所以必须与真实库隔离。
 * 数据库来源由 .env.dev 的 DB_MODE 决定（local = 本机 MySQL / docker = 独立容器）。
 *
 * 做的事：确保数据库可用 → 建测试库 → 应用迁移
 */
import { spawnSync } from "node:child_process";
import { ROOT } from "./load-env.js";
import {
  DEV_CONTAINER,
  TEST_DB_NAME,
  buildDevChildEnv,
  buildTestDbUrl,
  loadDevConfig,
} from "./dev-config.js";

const cfg = loadDevConfig();
if (cfg.error) {
  console.error("");
  console.error("  已阻止执行（安全闸门）");
  console.error(`  ${cfg.error}`);
  console.error("");
  process.exit(1);
}

const testUrl = buildTestDbUrl(cfg);

console.log("");
console.log("============================================================");
console.log("  初始化测试库");
console.log("============================================================");
console.log(`  测试库      ${cfg.host}:${cfg.port}/${TEST_DB_NAME}`);
console.log(
  cfg.isLocal
    ? "  数据库来源  本机 MySQL（DB_MODE=local，不启动 Docker）"
    : `  数据库来源  ${DEV_CONTAINER} 容器`
);
console.log("  真实库      localhost:3308/asset-manage   ← 不会被触碰");
console.log("============================================================");
console.log("");

// 测试库与开发库同实例同端口，所以 ensure-mysql 用开发库 URL 探测即可
const baseEnv = buildDevChildEnv(cfg.dbUrl, cfg.mode);

const steps = [
  [cfg.isLocal ? "检查本机 MySQL" : "启动开发库容器", "node scripts/ensure-mysql.js", baseEnv],
  ["创建测试库", "node scripts/db-init.js", { ...baseEnv, DATABASE_URL: testUrl }],
  ["应用迁移到测试库", "npx prisma migrate deploy", { ...baseEnv, DATABASE_URL: testUrl }],
];

for (let i = 0; i < steps.length; i++) {
  const [label, cmd, env] = steps[i];
  console.log(`[test-db] (${i + 1}/${steps.length}) ${label} ...`);

  const r = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ROOT, env });
  if (r.status !== 0) {
    console.error(`\n[test-db] 失败于：${label}`);
    process.exit(r.status ?? 1);
  }
}

console.log("");
console.log(`[test-db] 测试库 ${TEST_DB_NAME} 已就绪`);
console.log(`[test-db] 位置： ${cfg.host}:${cfg.port}`);
console.log("");
