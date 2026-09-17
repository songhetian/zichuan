/**
 * 一键启动隔离开发环境
 *
 *   npm run dev:start
 *
 * 做的事（顺序执行，任一步失败即停止）：
 *   1. 载入 .env，再用 .env.dev 覆盖 → DATABASE_URL 指向开发库
 *   2. 安全闸门：库名必须以 -dev 结尾，否则拒绝启动（防止误连真实库）
 *   3. 确保开发库可用（DB_MODE=local 探测本机 MySQL；docker 则拉起容器）
 *   4. 创建开发库
 *   5. 应用数据库迁移（migrate deploy，永不重置）
 *   6. 生成 Prisma Client
 *   7. 填充种子数据（有数据自动跳过）
 *   8. 启动 Next.js 开发服务器（前后端同一进程，带 HMR）
 *
 * 真实数据在 3308 / asset-manage（Docker），本脚本绝不触碰。
 * 自检模式：DEV_NO_LAUNCH=1（只做 1~7，不启动前端）
 */
import { spawn, spawnSync } from "node:child_process";
import { ROOT } from "./load-env.js";
import { DEV_CONTAINER, buildDevChildEnv, loadDevConfig } from "./dev-config.js";
import { freePort } from "./free-port.js";

const PORT = Number(process.env.PORT || 3000);

// ---------- 1~2. 配置 + 安全闸门 ----------

const cfg = loadDevConfig();

if (cfg.error) {
  console.error("");
  console.error("  已阻止启动（安全闸门）");
  console.error(`  ${cfg.error}`);
  console.error("");
  process.exit(1);
}

const childEnv = buildDevChildEnv(cfg.dbUrl, cfg.mode);

console.log("");
console.log("============================================================");
console.log("  开发环境（隔离库）");
console.log("============================================================");
console.log(`  开发库      ${cfg.host}:${cfg.port}/${cfg.dbName}   ← 随便折腾`);
console.log(
  cfg.isLocal
    ? "  数据库来源  本机 MySQL（DB_MODE=local，不启动 Docker）"
    : `  数据库来源  ${DEV_CONTAINER} 容器`
);
console.log("  真实库      localhost:3308/asset-manage（Docker）← 本脚本不触碰");
console.log("============================================================");
console.log("");

// ---------- 0. 释放端口（只清理占着 3000 的旧进程，不动其它 Node 项目） ----------

const steps = [
  [cfg.isLocal ? "检查本机 MySQL" : "启动开发库容器", "node scripts/ensure-mysql.js"],
  ["创建开发库", "node scripts/db-init.js"],
  ["应用数据库迁移", "npx prisma migrate deploy"],
  ["生成 Prisma Client", "npx prisma generate"],
  ["填充种子数据", "npx tsx prisma/seed.ts"],
];
const TOTAL = steps.length + 1;

console.log(`[dev] (1/${TOTAL}) 释放端口 ${PORT} ...`);
freePort(PORT);

// ---------- 1~5. 前置步骤 ----------

for (let i = 0; i < steps.length; i++) {
  const [label, cmd] = steps[i];
  console.log(`\n[dev] (${i + 2}/${TOTAL}) ${label} ...`);

  const r = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    cwd: ROOT,
    env: childEnv,
  });

  if (r.status !== 0) {
    console.error(`\n[dev] 失败于：${label}`);
    console.error(`[dev] 命令：${cmd}`);
    if (!cfg.isLocal) console.error(`[dev] 排查：docker logs ${DEV_CONTAINER}`);
    process.exit(r.status ?? 1);
  }
}

// ---------- 6. 启动前端 ----------

console.log("\n============================================================");
console.log("  开发库就绪，启动 Next.js 开发服务器 ...");
console.log(`  访问地址      http://localhost:${PORT}`);
console.log("  重置开发库    npm run dev:db:reset   ← 只删开发库，真实数据安全");
console.log(
  cfg.isLocal
    ? "  开发库归属    你本机的 MySQL，停不停由你决定"
    : "  停掉开发库    npm run dev:db:down"
);
console.log("============================================================\n");

if (process.env.DEV_NO_LAUNCH === "1") {
  console.log("[dev] DEV_NO_LAUNCH=1：已跳过启动前端（仅做环境自检）");
  process.exit(0);
}

const dev = spawn(`npx next dev -p ${PORT}`, {
  shell: true,
  stdio: "inherit",
  cwd: ROOT,
  env: childEnv,
});

dev.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      dev.kill(sig);
    } catch {
      /* ignore */
    }
  });
}
