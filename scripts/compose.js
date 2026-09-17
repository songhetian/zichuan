/**
 * 解析可用的 compose 命令
 * 优先 `docker compose`（Docker CLI 插件），回退 `docker-compose`（独立 CLI）。
 * 沙箱环境常常缺 cli-plugins，故两处都要试。
 */
import { spawnSync } from "node:child_process";
import { ROOT } from "./load-env.js";

export function resolveCompose({ required = true } = {}) {
  for (const cmd of ["docker compose", "docker-compose"]) {
    const r = spawnSync(`${cmd} version`, { shell: true, stdio: "ignore", cwd: ROOT });
    if (r.status === 0) return cmd;
  }

  if (!required) return null;

  console.error("[compose] 未找到 docker compose / docker-compose，请先安装并启动 Docker。");
  process.exit(1);
}
