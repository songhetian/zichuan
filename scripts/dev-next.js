/**
 * 安全版的 `next dev`
 *
 *   npm run dev
 *
 * 为什么需要它：
 *   裸跑 `next dev` 时 Next.js 会自动加载 `.env`，而 `.env` 是**生产配置**
 *   （DATABASE_URL 指向真实库 3308/asset-manage）。于是本地随手改个页面，
 *   所有操作都会静默写进真实数据 —— 这正是被删掉的 `dev:full` 的隐患。
 *
 *   本脚本先把 .env.dev 注入进程环境（注入值优先于 .env，实测 @next/env
 *   不会覆盖已存在的变量），再由 Next.js 启动，于是 `npm run dev` 与
 *   `dev:start` 一样只连开发库。
 *
 * 与 `dev:start` 的区别：
 *   dev:start = 建库 + 迁移 + 种子 + 启动前端（首次 / 换库时用）
 *   dev（本脚本）= 只做安全检查 + 启动前端（环境已就绪时快速重启用）
 *
 * 安全闸门：DATABASE_URL 的库名必须以 "-dev" 结尾，否则拒绝启动。
 * 自检模式：DEV_NO_LAUNCH=1（只打印将使用的库，不启动前端）
 */
import { spawn } from "node:child_process";
import { ROOT } from "./load-env.js";
import { buildDevChildEnv, loadDevConfig } from "./dev-config.js";
import { findPidsOnPort } from "./free-port.js";

const PORT = Number(process.env.PORT || 3000);

// ---------- 1. 载入 .env → .env.dev 覆盖 + 安全闸门 ----------

const cfg = loadDevConfig();

if (cfg.error) {
  console.error("");
  console.error("  已阻止启动（安全闸门）");
  console.error(`  ${cfg.error}`);
  console.error("");
  console.error("  如需完整重建开发环境，请用：npm run dev:start");
  console.error("");
  process.exit(1);
}

const childEnv = buildDevChildEnv(cfg.dbUrl, cfg.mode);

console.log("");
console.log("============================================================");
console.log("  开发模式（隔离库）");
console.log("============================================================");
console.log(`  开发库      ${cfg.host}:${cfg.port}/${cfg.dbName}   ← 随便折腾`);
console.log("  真实库      localhost:3308/asset-manage（Docker）← 本脚本不触碰");
console.log("============================================================");
console.log("");

if (process.env.DEV_NO_LAUNCH === "1") {
  console.log("[dev] DEV_NO_LAUNCH=1：已跳过启动前端（仅做环境自检）");
  process.exit(0);
}

// ---------- 2. 端口占用检查（只提示，不强杀：可能是另一个窗口的 dev 服务） ----------

const busy = findPidsOnPort(PORT);
if (busy.length > 0) {
  console.error(`  端口 ${PORT} 已被占用（PID: ${busy.join(", ")}）。`);
  console.error("  · 若那是已运行的开发服务 → 直接用浏览器访问，无需再启动");
  console.error(`  · 确实要重启 → 先执行：npm run kill-node（只释放 ${PORT}）`);
  console.error("");
  process.exit(1);
}

// ---------- 3. 启动前端 ----------

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
