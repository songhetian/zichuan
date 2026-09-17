/**
 * 轻量 .env 加载器
 * Prisma 会自动读 .env，但 node 直接执行的脚本不会，故统一在此加载。
 * 默认不覆盖已存在的环境变量；传 { override: true } 可强制覆盖（用于 .env.dev 叠加）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

export function loadEnv(file = path.join(ROOT, ".env"), { override = false } = {}) {
  const resolved = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(resolved)) return;
  const content = fs.readFileSync(resolved, "utf-8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

