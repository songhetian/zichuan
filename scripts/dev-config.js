/**
 * 隔离开发环境的共享配置
 * 供 dev-start.js / dev-db.js / test-db-init.js 复用，避免容器名、compose 参数在多处漂移。
 */
import { loadEnv } from "./load-env.js";

/** 开发库容器（仅 DB_MODE=docker 时使用；与真实库 zichuan-mysql 完全独立） */
export const DEV_CONTAINER = "zichuan-mysql-dev";
/** docker-compose.dev.yml 中的服务名 */
export const DEV_SERVICE = "mysql-dev";
/** compose 参数：独立文件 + 独立项目名 */
export const DEV_COMPOSE = "-f docker-compose.dev.yml -p zichuan-dev";
/** 开发库名后缀，作为「不是真实库」的安全标识 */
export const DEV_DB_SUFFIX = "-dev";

/** 测试库名：与开发库同实例、不同库，测试会清空所有表，故必须与真实库隔离 */
export const TEST_DB_NAME = "asset-manage-test";

/** 数据库来源：local = 用本机已装的 MySQL（脚本不起 Docker）/ docker = 由脚本拉起容器 */
export const DB_MODE_LOCAL = "local";

/**
 * 载入开发环境配置：.env 打底 → .env.dev 覆盖
 * 返回解析后的连接信息；解析失败或库名不像开发库时返回 { error }
 */
export function loadDevConfig() {
  loadEnv();
  loadEnv(".env.dev", { override: true });

  const mode = (process.env.DB_MODE || "docker").toLowerCase();
  const isLocal = mode === DB_MODE_LOCAL;

  const dbUrl = process.env.DATABASE_URL || "";
  const m = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);

  if (!m) {
    return { error: "无法解析 DATABASE_URL，请检查 .env.dev 文件" };
  }

  const [, user, password, host, port, dbName] = m;

  if (!dbName.endsWith(DEV_DB_SUFFIX)) {
    return {
      error:
        `DATABASE_URL 指向的不是开发库（${host}:${port}/${dbName}）。\n` +
        `库名必须以 "${DEV_DB_SUFFIX}" 结尾。真实数据在 3308/asset-manage，不要指向它。`,
    };
  }

  return {
    dbUrl,
    user,
    password,
    host,
    port: Number(port),
    dbName,
    mode,
    isLocal,
  };
}

/** 构造子进程环境：把开发库目标传给 ensure-mysql.js / db-init.js / prisma / next */
export function buildDevChildEnv(dbUrl, mode) {
  return {
    ...process.env,
    DATABASE_URL: dbUrl,
    DB_MODE: mode || process.env.DB_MODE || "docker",
    MYSQL_CONTAINER: DEV_CONTAINER,
    MYSQL_SERVICE: DEV_SERVICE,
    MYSQL_COMPOSE_ARGS: DEV_COMPOSE,
  };
}

/** 测试库连接串：与开发库同实例同端口，只是库名不同 */
export function buildTestDbUrl(cfg) {
  return `mysql://${cfg.user}:${cfg.password}@${cfg.host}:${cfg.port}/${TEST_DB_NAME}`;
}
