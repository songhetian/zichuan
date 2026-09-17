/**
 * 开发/生产隔离的「不变量」回归测试
 *
 * 背景：历史上 `npm run dev` = 裸 `next dev`，会加载 .env（生产配置）→ 静默连真实库；
 * 被删掉的 `npm run dev:full` 也是同一类隐患。这些不变量一旦被改回去不会有任何报错，
 * 只会在某天发现真实数据被写脏，所以用测试钉住。
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
    expect(dev).toContain("scripts/dev-next.js");
    expect(
      dev.startsWith("next dev"),
      "裸 next dev 会加载 .env（生产配置）并连上真实库，必须经由 scripts/dev-next.js 注入 .env.dev"
    ).toBe(false);
  });

  it("scripts/dev-next.js 应存在，并复用 loadDevConfig 的覆盖逻辑与安全闸门", () => {
    const file = join(ROOT, "scripts", "dev-next.js");
    expect(existsSync(file)).toBe(true);

    const src = readFileSync(file, "utf-8");
    expect(src).toContain("loadDevConfig");
    expect(src).toContain("buildDevChildEnv");
  });

  it("npm run dev:start 应指向 dev-start.js（建库 + 迁移 + 种子的完整入口）", () => {
    expect(pkg().scripts["dev:start"]).toContain("scripts/dev-start.js");
  });

  it("危险中间态 dev:full 不应再存在（dev 形态 + 真实库，无独占场景）", () => {
    const scripts = pkg().scripts;
    expect(
      "dev:full" in scripts,
      "dev:full 会以开发形态静默连真实库，且不与生产容器报端口冲突"
    ).toBe(false);
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
    const dockerignore = read(".dockerignore");
    const patterns = dockerignore
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
    expect(compose).toMatch(/DATABASE_URL:\s*\$\{DOCKER_DATABASE_URL:\?/);
  });

  it(".gitignore 不得整目录忽略 scripts/ 或 tests/（否则源码会静默不进版本控制）", () => {
    const lines = read(".gitignore")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const forbidden = ["scripts/", "scripts/*", "tests/", "tests/*"];
    const hits = lines.filter((l) => forbidden.includes(l));
    expect(
      hits,
      `这些规则会让新增脚本/测试静默不被跟踪：${hits.join(", ")}`
    ).toEqual([]);
  });
});
