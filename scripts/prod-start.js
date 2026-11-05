/**
 * 本地生产启动（npm run start）
 * 读取 .env（连真实库），以 production 模式运行自定义服务器 server.ts（含 Socket.IO）。
 * 需先 npm run build 生成 .next 生产构建。
 */
import { spawn } from "node:child_process";
import { ROOT, loadEnv } from "./load-env.js";

loadEnv();

// ── 启动闸门：必填环境变量缺失/不合格即退出，绝不带病启动 ──
// （与 src/lib/auth.ts、middleware.ts 的 production fail-fast 双保险：
//   这里给出可操作的完整清单，应用层是最后防线）
const problems = [];

if (!process.env.SESSION_SECRET) {
  problems.push(
    '  - SESSION_SECRET 未设置（必填，≥32 字符）\n' +
      '    生成：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
} else if (process.env.SESSION_SECRET.length < 32) {
  problems.push(`  - SESSION_SECRET 长度仅 ${process.env.SESSION_SECRET.length}，iron-session 要求 ≥32 字符`);
}

// 数据库：要么显式 DATABASE_URL，要么给出 RDS_* 分解字段（prisma.ts 会自动组合）
if (!process.env.DATABASE_URL && !(process.env.RDS_HOST && process.env.RDS_USER && process.env.RDS_PASSWORD)) {
  problems.push("  - 数据库未配置：需 DATABASE_URL，或 RDS_HOST + RDS_USER + RDS_PASSWORD（见 .env.example）");
}

if (problems.length > 0) {
  console.error("");
  console.error("  ✖ 生产启动被拦截（环境变量校验未通过）：");
  console.error(problems.join("\n"));
  console.error("");
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);

const child = spawn(`npx tsx server.ts`, {
  shell: true,
  stdio: "inherit",
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
});

child.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      /* ignore */
    }
  });
}