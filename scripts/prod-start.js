/**
 * 本地生产启动（npm run start）
 * 读取 .env（连真实库），以 production 模式运行自定义服务器 server.ts（含 Socket.IO）。
 * 需先 npm run build 生成 .next 生产构建。
 */
import { spawn } from "node:child_process";
import { ROOT, loadEnv } from "./load-env.js";

loadEnv();

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