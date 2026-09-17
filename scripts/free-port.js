/**
 * 释放端口：只终止「正在监听指定端口」的那个进程（默认 3000）
 *
 * 用法：
 *   node scripts/free-port.js            # 释放 3000
 *   node scripts/free-port.js 3001       # 释放 3001
 *
 * 为什么不用「杀光所有 node.exe」：
 *   1) npm 自身就是 node.exe —— 杀光会连 npm 一起杀掉，
 *      于是 `npm run dev:start` 里的 `&&` 链在这里断掉，后面的命令永远不执行；
 *   2) 会把机器上其它项目的 Node 服务一起杀掉（例如 3001 端口的前端项目）。
 *   本脚本只处理「真正占着目标端口」的进程，其余一律不碰。
 *
 * 可作为模块使用：
 *   import { freePort } from "./free-port.js";
 *   freePort(3000);
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** 绝不动：自己、父进程（npm/shell）、系统空闲进程 */
const PROTECTED = new Set([
  String(process.pid),
  String(process.ppid),
  "0",
  "4",
]);

function sh(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

/** 返回正在监听该端口的 PID 列表（已排除受保护进程） */
export function findPidsOnPort(port) {
  const pids = new Set();

  try {
    if (process.platform === "win32") {
      // netstat 行示例：TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
      const out = sh("netstat -ano");
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
    } else {
      const out = sh(`lsof -ti tcp:${port} -sTCP:LISTEN`);
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (/^\d+$/.test(t)) pids.add(t);
      }
    }
  } catch {
    // 端口空闲时 netstat/lsof 可能非零退出 → 视为无占用
  }

  return [...pids].filter((p) => !PROTECTED.has(p));
}

/**
 * 释放端口。
 * @returns {{ freed: string[], failed: string[], busy: boolean }}
 */
export function freePort(port = Number(process.env.PORT || 3000), { quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const pids = findPidsOnPort(port);

  if (pids.length === 0) {
    log(`[port] ${port} 端口空闲，无需清理`);
    return { freed: [], failed: [], busy: false };
  }

  log(`[port] ${port} 端口被占用，PID: ${pids.join(", ")}`);

  const freed = [];
  const failed = [];

  for (const pid of pids) {
    try {
      // /T 连同子进程一起终止（npx 包装进程 + 真正的 next server）
      const cmd =
        process.platform === "win32"
          ? `taskkill /F /T /PID ${pid}`
          : `kill -9 ${pid}`;
      execSync(cmd, { stdio: "ignore" });
      freed.push(pid);
    } catch {
      failed.push(pid);
    }
  }

  if (failed.length > 0) {
    log(`[port] 终止失败：${failed.join(", ")}（可能权限不足，可手动结束）`);
  } else {
    log(`[port] 已释放端口 ${port}（终止 ${freed.length} 个进程）`);
  }

  return { freed, failed, busy: true };
}

// 直接执行时作为命令行工具（被 import 时不触发）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 3000);
  freePort(port);
}
