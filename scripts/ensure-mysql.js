/**
 * dev 环境前置检查：确保 MySQL 可用
 *
 * 逻辑：
 *   1. 先探测 DATABASE_URL 里的 host:port，能连通就直接跳过（本地/外部 MySQL 均适用）
 *   2. 连不通时按 DB_MODE 分流：
 *        - local  用本机已装的 MySQL → 只报错提示启动它，绝不启动 Docker
 *        - docker 由脚本拉起容器：容器已存在 → docker start；不存在 → compose up -d
 *   3. 轮询等待就绪（最多 120s），失败给出明确指引
 */
import { execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, ROOT } from "./load-env.js";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 目标容器/服务/ compose 参数可由调用方注入（dev-start.js 用它指向开发库容器）
const CONTAINER = process.env.MYSQL_CONTAINER || "zichuan-mysql";
const SERVICE = process.env.MYSQL_SERVICE || "mysql";
const COMPOSE_ARGS = (process.env.MYSQL_COMPOSE_ARGS || "").trim();
/** local = 用本机已装的 MySQL（不启动 Docker）/ docker = 由脚本拉起容器 */
const DB_MODE = (process.env.DB_MODE || "docker").toLowerCase();
const IS_LOCAL = DB_MODE === "local";
const WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 1_500;

const dbUrl = process.env.DATABASE_URL || "";
const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);

if (!match) {
  console.error("[mysql] 无法解析 DATABASE_URL，请检查 .env 文件");
  process.exit(1);
}

const [, , , host, port, dbName] = match;
const PORT = Number(port);

function tryConnect(timeout = 1_000) {
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
    socket.connect(PORT, host);
  });
}

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf-8",
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function silentTry(cmd) {
  try {
    return { ok: true, out: run(cmd) };
  } catch (e) {
    return { ok: false, out: (e.stderr || e.message || "").toString().trim() };
  }
}

async function waitForReady() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (await isReady()) return true;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * 容器健康状态：
 *   healthy / starting / unhealthy / none(无健康检查) / absent(容器不存在)
 */
function containerHealth() {
  const r = silentTry(
    `docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" ${CONTAINER}`
  );
  if (!r.ok) return "absent";
  return r.out || "unknown";
}

/** 容器内 mysqladmin ping：能 ping 通才算真的能握手 */
function mysqladminPing() {
  return silentTry(`docker exec ${CONTAINER} mysqladmin ping -uroot -proot --silent`).ok;
}

/**
 * 「真的就绪」判定。
 * 注意：端口能连上 ≠ MySQL 就绪——首次初始化时端口先开，握手会被拒，
 * 所以优先等 healthcheck 变 healthy，没有健康检查时才退回 ping / TCP。
 *
 * 本地模式（DB_MODE=local）特殊处理：数据库是你本机的 MySQL，与 Docker 无关。
 * 此时若去 docker inspect，既慢（Docker 忙时会卡住不动）又会拿错对象——
 * 开发容器存在且 healthy 并不代表 3306 上的库可用。故本地模式只用 TCP 探测。
 */
async function isReady() {
  if (IS_LOCAL) return await tryConnect();

  const health = containerHealth();

  if (health === "healthy") return true;
  if (health === "starting" || health === "unhealthy") return false;

  if (health === "none" || health === "unknown") {
    return mysqladminPing();
  }

  // 容器不存在（比如用的是本机/外部 MySQL）→ 只能靠端口判断
  return await tryConnect();
}

async function main() {
  console.log(`[mysql] 目标数据库: ${host}:${PORT}/${dbName}`);

  // 1. 已就绪 → 无需任何启动动作
  if (await isReady()) {
    console.log(
      IS_LOCAL
        ? "[mysql] 本机 MySQL 已就绪"
        : "[mysql] 数据库已就绪，跳过 Docker 启动"
    );
    return;
  }

  // 2. 本地模式：数据库由用户自己的 MySQL 提供，脚本只负责探测与提示，绝不启动 Docker
  if (IS_LOCAL) {
    console.error("");
    console.error(`[mysql] 连接不上 ${host}:${PORT}（当前 DB_MODE=local，不会启动 Docker 容器）`);
    console.error("[mysql] 请先启动你本机的 MySQL 服务（FlyEnv / Windows 服务 / 其它），再重试。");
    console.error("[mysql] 若想改由脚本自动拉起 Docker 容器：把 .env.dev 的 DB_MODE 改成 docker。");
    console.error("");
    process.exit(1);
  }

  console.log("[mysql] 数据库未就绪，尝试通过 Docker 启动...");

  // 2. 探测 Docker
  if (!silentTry("docker version --format {{.Server.Version}}").ok) {
    console.error("[mysql] Docker 未运行或不可用，请先启动 Docker Desktop");
    console.error(`[mysql] 或手动准备 ${host}:${PORT} 上的 MySQL 后重试`);
    process.exit(1);
  }

  // 3. 兼容 docker compose / docker-compose 两种命令
  const composeCmd = silentTry("docker compose version").ok
    ? "docker compose"
    : silentTry("docker-compose version").ok
      ? "docker-compose"
      : null;

  const inspect = silentTry(`docker inspect -f "{{.State.Status}}" ${CONTAINER}`);

  if (inspect.ok) {
    if (inspect.out === "running") {
      console.log(`[mysql] 容器 ${CONTAINER} 运行中，等待端口就绪`);
    } else {
      console.log(`[mysql] 启动已存在的容器 ${CONTAINER} ...`);
      const started = silentTry(`docker start ${CONTAINER}`);
      if (!started.ok) {
        console.error(`[mysql] 启动容器失败: ${started.out}`);
        process.exit(1);
      }
    }
  } else {
    if (!composeCmd) {
      console.error("[mysql] 未找到 docker compose / docker-compose 命令");
      process.exit(1);
    }
    const composeBase = `${composeCmd} ${COMPOSE_ARGS}`.trim();
    console.log(`[mysql] 通过 ${composeBase} up -d ${SERVICE} 创建并启动容器...`);
    const up = silentTry(`${composeBase} up -d ${SERVICE}`);
    if (!up.ok) {
      console.error(`[mysql] 启动失败: ${up.out}`);
      process.exit(1);
    }
  }

  // 4. 等待端口
  process.stdout.write("[mysql] 等待数据库就绪");
  const ready = await waitForReady();
  process.stdout.write("\n");

  if (!ready) {
    console.error(`[mysql] 等待超时（${WAIT_MS / 1000}s），数据库仍未就绪`);
    console.error(`[mysql] 排查: docker logs ${CONTAINER}`);
    process.exit(1);
  }

  console.log("[mysql] 数据库已就绪");
}

main();
