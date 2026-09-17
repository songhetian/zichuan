/**
 * 生产容器统一入口
 * 原先十几个 docker:* 命令收在这里，package.json 只留一个 `docker`。
 *
 *   npm run docker                 查看用法
 *   npm run docker deploy          构建 + 迁移 + 启动（幂等，日常发布用）
 *   npm run docker update          仅重建 app + nginx（不动数据库，最快）
 *   npm run docker mysql           只启动生产 MySQL 容器（备份 / 导出用）
 *   npm run docker down            停止服务（保留数据卷）
 *   npm run docker restart [服务]   重启（不传服务 = 全部，如 npm run docker restart nginx）
 *   npm run docker logs [服务]      实时日志（不传服务 = 全部）
 *   npm run docker ps              查看容器状态
 *   npm run docker migrate         只执行数据库迁移
 *   npm run docker seed            只填充种子数据（仅空库生效）
 *   npm run docker reset           ⚠️ 删除数据卷并重建（需输入 yes 确认）
 *
 * 数据安全：除 reset 外均不带 `-v`，named volume `mysql_data` 保留。
 */
import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { ROOT } from "./load-env.js";
import { resolveCompose } from "./compose.js";

const action = (process.argv[2] || "").toLowerCase();
const rest = process.argv.slice(3);

const compose = action ? resolveCompose() : null;

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ROOT });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
  return code;
}

function usage() {
  console.log("");
  console.log("  生产容器管理");
  console.log("============================================================");
  console.log("  npm run docker deploy          构建 + 迁移 + 启动（幂等）");
  console.log("  npm run docker update          仅重建 app + nginx（不动库）");
  console.log("  npm run docker mysql           只启动生产 MySQL（备份/导出）");
  console.log("  npm run docker down            停止服务（保留数据卷）");
  console.log("  npm run docker restart [服务]   重启（默认全部）");
  console.log("  npm run docker logs [服务]      实时日志（默认全部）");
  console.log("  npm run docker ps              查看容器状态");
  console.log("  npm run docker migrate         只执行数据库迁移");
  console.log("  npm run docker seed            只填充种子数据（仅空库生效）");
  console.log("  npm run docker reset           ⚠️ 删除数据卷并重建（需确认）");
  console.log("============================================================");
  console.log("");
}

async function confirmReset() {
  if (process.env.CONFIRM_RESET === "1") return true;

  if (!process.stdin.isTTY) {
    console.error("[docker] 非交互环境，拒绝执行。确认要删数据请设置 CONFIRM_RESET=1");
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('将删除数据卷 mysql_data（所有真实数据不可恢复），输入 "yes" 继续：', resolve));
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  switch (action) {
    case "deploy": {
      run(`${compose} build`);
      run(`${compose} up -d mysql`);
      run(`${compose} up db-init`);
      run(`${compose} up -d app nginx`);
      run(`${compose} ps`);
      break;
    }

    case "update": {
      run(`${compose} up -d --build --force-recreate app nginx`);
      run(`${compose} ps`);
      break;
    }

    // 只起真实库容器：备份 / 导出数据用，不启动应用
    case "mysql": {
      run(`${compose} up -d mysql`);
      break;
    }

    case "down": {
      run(`${compose} down`);
      break;
    }

    case "restart": {
      run(`${compose} restart ${rest.join(" ")}`.trim());
      break;
    }

    case "logs": {
      run(`${compose} logs -f ${rest.join(" ")}`.trim());
      break;
    }

    case "ps": {
      run(`${compose} ps`);
      break;
    }

    case "migrate": {
      run(`${compose} run --rm db-init npx prisma migrate deploy`);
      break;
    }

    case "seed": {
      run(`${compose} run --rm db-init npx tsx prisma/seed.ts`);
      break;
    }

    case "reset": {
      const ok = await confirmReset();
      if (!ok) {
        console.log("[docker] 已取消，未做任何改动。");
        process.exit(1);
      }
      run(`${compose} down -v`);
      run(`${compose} build`);
      run(`${compose} up -d mysql`);
      run(`${compose} up db-init`);
      run(`${compose} up -d app nginx`);
      run(`${compose} ps`);
      break;
    }

    default: {
      usage();
      if (action) process.exit(1);
      break;
    }
  }
}

main();
