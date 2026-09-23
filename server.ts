/**
 * 自定义 HTTP 服务器（M6 socket 修复）
 *
 * 背景：Next App Router 的 /api/socket/route.ts 会劫持该路径下所有请求（含
 * socket.io 的 engine.io 握手），导致浏览器永远握不上手、实时推送失效。
 *
 * 方案：自建 Node http.Server，先挂载 Socket.IO（独占 /api/socket），再把
 * 其余请求转发给 Next handler。dev / production 共用本服务器。
 *
 * 启动：
 *   dev        → node scripts/dev-start.js（内部经 childEnv 指向开发库后 npx tsx server.ts）
 *   production → node scripts/prod-start.js（载入 .env、NODE_ENV=production 后运行）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import next from "next";
import { getSocketServer } from "./src/lib/socket-server";
import { loadEnv } from "./scripts/load-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 本文件常被 dev-start/prod-start 以子进程方式拉起（环境变量已就绪），
// 独立运行时兜底载入 .env（不覆盖已存在的环境变量，如 childEnv 注入的开发库）。
loadEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  // Socket.IO 独占 /api/socket，先于 Next handler 注册，接管 engine.io 握手。
  // getSocketServer 幂等单例，会把 userId→socket 映射接到了 socket-pusher。
  getSocketServer(server);

  server.listen(port, () => {
    const mode = dev ? "development" : "production";
    console.log(`> 自定义服务器启动（${mode}）: http://${hostname}:${port}`);
    console.log(`> Socket.IO 已挂载: /api/socket`);
  });
});