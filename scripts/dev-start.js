/**
 * 一键启动开发环境（隔离开发库）
 *
 *   npm run dev
 *
 * 做的事（顺序执行，任一步失败即停止）：
 *   1. 释放 3000 端口（只终止占着该端口的进程，不动其它项目）
 *   2. 载入 .env，再用 .env.dev 覆盖 → DATABASE_URL 指向开发库
 *   3. 安全闸门：库名必须以 -dev 结尾，否则拒绝启动（防止误连真实库）
 *   4. 确保开发库可用（DB_MODE=local 只探测本机 MySQL；docker 则拉起容器）
 *   5. 创建开发库
 *   6. 应用数据库迁移（migrate deploy，永不重置）
 *   7. 生成 Prisma Client（schema 未变更时自动跳过，省 ~8 秒）
 *   8. 填充种子数据（有数据自动跳过）
 *   9. 启动 Next.js 开发服务器（前后端同一进程，带 HMR）
 *
 * 真实数据在 3308 / asset-manage（Docker），本脚本绝不触碰。
 * 自检模式：DEV_NO_LAUNCH=1（只做前置步骤，不启动前端）
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./load-env.js";
import { DEV_CONTAINER, buildDevChildEnv, loadDevConfig } from "./dev-config.js";
import { freePort, findPidsOnPort } from "./free-port.js";

const PORT = Number(process.env.PORT || 3000);

// ---------- 配置 + 安全闸门 ----------

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

// ---------- 前置步骤 ----------

/** Prisma Client 是否已是最新（schema.prisma 没比生成的 client 更新） */
function prismaClientFresh() {
  const schema = path.join(ROOT, "prisma", "schema.prisma");
  const marker = path.join(ROOT, "node_modules", ".prisma", "client", "index.d.ts");
  try {
    return fs.statSync(marker).mtimeMs >= fs.statSync(schema).mtimeMs;
  } catch {
    return false;
  }
}

const steps = [
  [cfg.isLocal ? "检查本机 MySQL" : "启动开发库容器", "node scripts/ensure-mysql.js"],
  ["创建开发库", "node scripts/db-init.js"],
  ["应用数据库迁移", "npx prisma migrate deploy"],
];
const skipGenerate = process.env.FORCE_PRISMA_GENERATE !== "1" && prismaClientFresh();
if (!skipGenerate) steps.push(["生成 Prisma Client", "npx prisma generate"]);
steps.push(["填充种子数据", "npx tsx prisma/seed.ts"]);

const TOTAL = steps.length + 1;

console.log(`[dev] (1/${TOTAL}) 释放端口 ${PORT} ...`);
freePort(PORT);

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

if (skipGenerate) {
  console.log("[dev] Prisma Client 已是最新，跳过生成（强制重生成：FORCE_PRISMA_GENERATE=1）");
}

// ---------- 启动前端 ----------

console.log("\n============================================================");
console.log("  开发库就绪，启动 Next.js 开发服务器 ...");
console.log(`  访问地址      http://localhost:${PORT}`);
console.log("  重置开发库    npm run db reset   ← 只删开发库，真实数据安全");
console.log(
  cfg.isLocal
    ? "  开发库归属    你本机的 MySQL，启停由你决定"
    : "  停掉开发库    npm run db down"
);
console.log("============================================================\n");

if (process.env.DEV_NO_LAUNCH === "1") {
  console.log("[dev] DEV_NO_LAUNCH=1：已跳过启动前端（仅做环境自检）");
  process.exit(0);
}

// 端口已被占用时不静默抢占：可能是另一个窗口正在跑的服务
const busy = findPidsOnPort(PORT);
if (busy.length > 0) {
  console.error(`  端口 ${PORT} 仍被占用（PID: ${busy.join(", ")}）。`);
  console.error("  请先关闭占用它的进程，再重新执行 npm run dev。");
  console.error("");
  process.exit(1);
}

// 自定义服务器（server.ts）：先挂 Socket.IO，再转发给 Next（修复 /api/socket 实时推送）
const dev = spawn(`npx tsx server.ts`, {
  shell: true,
  stdio: "inherit",
  cwd: ROOT,
  env: { ...childEnv, PORT: String(PORT), NODE_ENV: "development" },
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
