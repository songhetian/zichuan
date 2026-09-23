/**
 * 开发/生产隔离的「不变量」回归测试
 *
 * 背景：历史上 `npm run dev` = 裸 `next dev`，会加载 .env（生产配置）→ 静默连真实库；
 * 被删掉的 `npm run dev:full`、`setup` 也是同一类隐患。这些不变量一旦被改回去
 * 不会有任何报错，只会在某天发现真实数据被写脏，所以用测试钉住。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf-8");
const pkg = () => JSON.parse(read("package.json")) as { scripts: Record<string, string> };

describe("开发/生产隔离 - 命令入口", () => {
  it("npm run dev 必须走安全包装器，而不能是裸 next dev", () => {
    const dev = pkg().scripts.dev;
    expect(dev, "dev 脚本缺失").toBeDefined();
    expect(dev).toContain("scripts/dev-start.js");
    expect(
      dev.startsWith("next dev"),
      "裸 next dev 会加载 .env（生产配置）并连上真实库，必须经由 scripts/dev-start.js 注入 .env.dev"
    ).toBe(false);
  });

  it("scripts/dev-start.js 应复用 loadDevConfig 的覆盖逻辑与安全闸门", () => {
    const file = join(ROOT, "scripts", "dev-start.js");
    expect(existsSync(file)).toBe(true);

    const src = readFileSync(file, "utf-8");
    expect(src).toContain("loadDevConfig");
    expect(src).toContain("buildDevChildEnv");
  });

  it("危险/冗余命令不应复活（dev:full / setup / prod / kill-node / dev:db）", () => {
    const scripts = pkg().scripts;
    const removed = ["dev:full", "setup", "prod", "kill-node", "dev:db"];

    // setup = `prisma migrate dev` + 默认 .env → 会在真实库上交互式重置
    // dev:full = dev 形态 + 真实库 → 与生产容器端口不冲突，会静默双写
    for (const name of removed) {
      expect(name in scripts, `${name} 会造成误连真实库或属已合并的冗余入口`).toBe(false);
    }
  });

  it("数据库与生产容器各自只有一个统一入口（db / docker）", () => {
    const scripts = pkg().scripts;
    expect(scripts.db).toContain("scripts/dev-db.js");
    expect(scripts.docker).toContain("scripts/docker.js");

    const dbSubCommands = Object.keys(scripts).filter((k) => k.startsWith("db:"));
    const dockerSubCommands = Object.keys(scripts).filter((k) => k.startsWith("docker:"));
    expect(dbSubCommands, "开发库操作应收进 npm run db <子命令>").toEqual([]);
    expect(dockerSubCommands, "生产容器操作应收进 npm run docker <子命令>").toEqual([]);
  });
});

describe("开发/生产隔离 - 脚本内部闸门", () => {
  it("npm run db migrate 必须注入开发库环境，不能裸跑 prisma migrate dev", () => {
    const src = read("scripts/dev-db.js");
    expect(src).toContain("buildDevChildEnv");
    expect(src).toContain("prisma migrate dev");
  });

  it("npm run docker reset 必须确认，且不得 down -v 删库（RDS 无本地数据卷）", () => {
    const src = read("scripts/docker.js");
    expect(src).toContain("CONFIRM_RESET");
    // reset 必须走 confirmReset 确认
    expect(src.indexOf("confirmReset")).toBeGreaterThan(-1);
    // 数据库是 RDS：reset 绝不能 down -v / 删 mysql_data，防止误清真实数据
    expect(src).not.toContain("down -v");
    expect(src).not.toContain("mysql_data");
  });

  it("seed 账号按 username 幂等，且 import 不反向清空超管角色（账号冲突治理）", () => {
    const seedSrc = read("prisma/seed.ts");
    // seed：admin 账号按 username 定位（而非 findFirst 任意一条），避免唯一键冲突
    expect(seedSrc).toContain('findUnique({ where: { username: "admin" } }');
    // seed：已存在但 roleId 为空 → 补绑 SUPER_ADMIN
    expect(seedSrc).toContain("补绑超级管理员角色");
    // import：admin 更新时保护已绑定角色，不把 roleId 清成 null
    const importSrc = read("scripts/import-legacy.mjs");
    expect(importSrc).toContain('model === "admin" && rest.roleId == null');
    expect(importSrc).toContain("delete rest.roleId");
  });
});

describe("开发/生产隔离 - 配置文件", () => {
  it(".env.dev 指向的必须是开发库（库名以 -dev 结尾）", () => {
    const envDev = read(".env.dev");
    const m = envDev.match(/^DATABASE_URL\s*=\s*"?mysql:\/\/[^/]+\/([^"\s]+)/m);
    expect(m, ".env.dev 中缺少 DATABASE_URL").not.toBeNull();
    expect(m![1].endsWith("-dev")).toBe(true);
  });

  it(".dockerignore 必须排除 .env（standalone 产物会带上它，否则密钥进镜像层）", () => {
    const patterns = read(".dockerignore")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    expect(patterns).toContain(".env");
    expect(patterns.some((p) => p === ".env.*" || p === ".env*")).toBe(true);
  });

  it("docker-compose 应显式固定 NODE_ENV=production，并对必填变量做「缺失即失败」", () => {
    const compose = read("docker-compose.yml");

    const appBlock = compose.match(/ {2}app:[\s\S]*?(?=\n {2}\w+:)/);
    expect(appBlock).not.toBeNull();
    expect(appBlock![0]).toContain("NODE_ENV: production");

    // 空 SESSION_SECRET 会让 auth.ts 静默回退到写死的默认密钥
    expect(compose).toMatch(/SESSION_SECRET:\s*\$\{SESSION_SECRET:\?/);
    // DATABASE_URL 由 RDS_* 字段自动组合，缺 RDS_USER / RDS_PASSWORD / RDS_HOST 时「缺失即失败」
    expect(compose).toMatch(/DATABASE_URL:\s*mysql:\/\/\$\{RDS_USER:\?/);
    expect(compose).toMatch(/\$\{RDS_PASSWORD:\?/);
    expect(compose).toMatch(/\$\{RDS_HOST:\?/);
  });

  it(".gitignore 不得整目录忽略 scripts/ 或 tests/（否则源码会静默不进版本控制）", () => {
    const lines = read(".gitignore")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const forbidden = ["scripts/", "scripts/*", "tests/", "tests/*"];
    const hits = lines.filter((l) => forbidden.includes(l));
    expect(hits, `这些规则会让新增脚本/测试静默不被跟踪：${hits.join(", ")}`).toEqual([]);
  });
});
