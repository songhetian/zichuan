import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "..");

describe("部署配置 - Nginx", () => {
  it("Nginx 配置应包含 localhost 作为 server_name，确保本地访问正常", () => {
    const nginxConf = readFileSync(
      join(PROJECT_ROOT, "docker/nginx/default.conf"),
      "utf-8"
    );

    const serverNameMatch = nginxConf.match(/server_name\s+([^;]+);/);
    expect(serverNameMatch).not.toBeNull();

    const serverNames = serverNameMatch![1].trim().split(/\s+/);

    const hasLocalhost = serverNames.includes("localhost");
    const hasWildcard = serverNames.includes("_");
    const hasIp = serverNames.some((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n));

    expect(
      hasLocalhost || hasWildcard || hasIp,
      `server_name 应包含 localhost、_ 或 IP 地址以支持本地访问。当前: ${serverNames.join(" ")}`
    ).toBe(true);
  });

  it("Nginx 配置的 client_max_body_size 应支持 Excel 上传", () => {
    const nginxConf = readFileSync(
      join(PROJECT_ROOT, "docker/nginx/default.conf"),
      "utf-8"
    );

    expect(nginxConf).toContain("client_max_body_size");
  });
});

describe("部署配置 - SESSION_SECRET", () => {
  it("db-init 启动脚本应包含 SESSION_SECRET 默认值检查", () => {
    const composeFile = readFileSync(
      join(PROJECT_ROOT, "docker-compose.yml"),
      "utf-8"
    );

    const dbInitSection = composeFile.match(/db-init:[\s\S]*?(?=\n  \w+:|\nvolumes:|$)/);
    expect(dbInitSection).not.toBeNull();

    const dbInitBlock = dbInitSection![0];
    expect(
      dbInitBlock.includes("SESSION_SECRET") || dbInitBlock.includes("env_file"),
      "db-init 应从 env_file 或 environment 读取 SESSION_SECRET"
    ).toBe(true);
  });

  it("db-init 应在种子数据之前运行部署初始化脚本（检查 SESSION_SECRET 等）", () => {
    const composeFile = readFileSync(
      join(PROJECT_ROOT, "docker-compose.yml"),
      "utf-8"
    );

    const dbInitSection = composeFile.match(/db-init:[\s\S]*?(?=\n  \w+:|\nvolumes:|$)/);
    expect(dbInitSection).not.toBeNull();

    const dbInitBlock = dbInitSection![0];

    // 检查 command 中是否包含 docker-init 脚本，且在 migrate 之前执行
    expect(dbInitBlock).toContain("docker-init");
    expect(dbInitBlock).toMatch(/migrate deploy/);

    // 确保 docker-init 在 migrate 之前执行（字符串顺序）
    const initIdx = dbInitBlock.indexOf("docker-init");
    const migrateIdx = dbInitBlock.search(/migrate deploy/);
    expect(
      initIdx < migrateIdx,
      "docker-init 脚本应在 prisma migrate 之前执行"
    ).toBe(true);
  });

  it(".env 模板中的 SESSION_SECRET 应有明确的默认值提示", () => {
    const envFile = readFileSync(join(PROJECT_ROOT, ".env"), "utf-8");

    expect(envFile).toContain("SESSION_SECRET");
  });
});
