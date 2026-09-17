/**
 * 开发库 / 测试库管理（只操作隔离库，绝不触碰真实数据）
 *
 *   npm run db               查看开发库状态（默认）
 *   npm run db status        查看开发库状态
 *   npm run db up            确保开发库可用 + 建库（不跑迁移/种子）
 *   npm run db migrate       在开发库上创建新迁移（改了 schema.prisma 后）
 *   npm run db reset         重置开发库（清空重建 + 迁移 + 种子）
 *   npm run db test:init     初始化隔离测试库 asset-manage-test
 *   npm run db logs          跟踪开发库日志（仅 DB_MODE=docker）
 *   npm run db down          停止开发库（仅 DB_MODE=docker）
 *
 * 数据库来源由 .env.dev 的 DB_MODE 决定：
 *   local  用本机已装的 MySQL，脚本不启动 Docker（down / logs 不适用）
 *   docker 由脚本拉起独立容器（docker-compose.dev.yml）
 */
import { spawnSync } from "node:child_process";
import net from "node:net";
import { ROOT } from "./load-env.js";
import { DEV_COMPOSE, DEV_CONTAINER, buildDevChildEnv, loadDevConfig } from "./dev-config.js";
import { resolveCompose } from "./compose.js";

// 不带子命令时默认查状态（无副作用）
const action = (process.argv[2] || "status").toLowerCase();

const cfg = loadDevConfig();
if (cfg.error && action !== "logs" && action !== "status") {
  console.error("");
  console.error("  已阻止执行（安全闸门）");
  console.error(`  ${cfg.error}`);
  console.error("");
  process.exit(1);
}

const env = buildDevChildEnv(cfg.dbUrl || "", cfg.mode);

function run(cmd, { extraEnv = {} } = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    cwd: ROOT,
    env: { ...env, ...extraEnv },
  });
  return r.status ?? 1;
}

function tryConnect(timeout = 1_500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(cfg.port, cfg.host);
  });
}

async function main() {
  switch (action) {
    case "up": {
      if (cfg.isLocal) console.log("[db] 本机 MySQL 模式：检查连接并建库 ...");
      let code = run("node scripts/ensure-mysql.js");
      if (code !== 0) process.exit(code);
      code = run("node scripts/db-init.js");
      process.exit(code);
    }

    // 建新迁移：显式注入开发库环境，避免 Prisma CLI 读 .env 连上真实库
    case "migrate": {
      console.log(`[db] 在开发库 ${cfg.host}:${cfg.port}/${cfg.dbName} 上创建新迁移 ...`);
      process.exit(run(`npx prisma migrate dev --name ${process.argv[3] || "change"}`));
    }

    case "reset": {
      if (cfg.isLocal) {
        console.log(`[db] 重置开发库：删除并重建 ${cfg.dbName}（真实库在 3308，不受影响）...`);
        let code = run("node scripts/db-init.js", { extraEnv: { DB_INIT_DROP: "1" } });
        if (code !== 0) process.exit(code);
        code = run("npx prisma migrate deploy");
        if (code !== 0) process.exit(code);
        process.exit(run("npx tsx prisma/seed.ts"));
      }
      const compose = resolveCompose();
      console.log("[db] 重置开发库：删除开发库数据卷（真实数据不受影响）...");
      const code = run(`${compose} ${DEV_COMPOSE} down -v`);
      if (code !== 0) process.exit(code);
      const up = run("node scripts/ensure-mysql.js");
      if (up !== 0) process.exit(up);
      process.exit(run("node scripts/db-init.js"));
    }

    case "test:init": {
      process.exit(run("node scripts/test-db-init.js"));
    }

    case "logs": {
      if (cfg.isLocal) {
        console.log("[db] 当前为本机 MySQL 模式，容器日志不适用；请查看你本机 MySQL 的日志文件。");
        process.exit(0);
      }
      process.exit(run(`docker logs -f ${DEV_CONTAINER}`));
    }

    case "status": {
      if (cfg.isLocal) {
        const ok = await tryConnect();
        console.log("");
        console.log("  开发库状态（本机 MySQL 模式）");
        console.log("============================================================");
        console.log(`  地址     ${cfg.host}:${cfg.port}`);
        console.log(`  开发库   ${cfg.dbName}`);
        console.log(`  连通性   ${ok ? "可连接" : "连接失败（请检查本机 MySQL 是否启动）"}`);
        console.log("============================================================");
        console.log("");
        process.exit(ok ? 0 : 1);
      }
      process.exit(run(`docker ps -a --filter name=${DEV_CONTAINER}`));
    }

    case "down": {
      if (cfg.isLocal) {
        console.log("[db] 当前为本机 MySQL 模式（DB_MODE=local），开发库随你本机 MySQL 服务启停。");
        console.log("[db] 想清空开发库请用： npm run db reset");
        process.exit(0);
      }
      const compose = resolveCompose();
      console.log("[db] 停止开发库容器（数据卷保留）...");
      process.exit(run(`${compose} ${DEV_COMPOSE} down`));
    }

    default: {
      console.log("用法： npm run db <命令>");
      console.log("  status     查看开发库状态（默认）");
      console.log("  up         确保开发库可用 + 建库");
      console.log("  migrate    在开发库上创建新迁移（改了 schema.prisma 后）");
      console.log("  reset      重置开发库（清空重建 + 迁移 + 种子）");
      console.log("  test:init  初始化隔离测试库 asset-manage-test");
      console.log("  logs       跟踪开发库日志（仅 DB_MODE=docker）");
      console.log("  down       停止开发库（仅 DB_MODE=docker）");
      process.exit(1);
    }
  }
}

main();
