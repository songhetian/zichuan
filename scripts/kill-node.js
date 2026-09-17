/**
 * ⚠️ 行为已变更（2026-09-17）：只释放端口，不再「杀光所有 node.exe」
 *
 * 旧行为（已废弃）：tasklist 抓出所有 node.exe 全部 taskkill。
 *   - npm 自身就是 node.exe，会被一并杀掉 → `npm run dev:start` 的 && 链在此断掉，
 *     dev-start.js 永远不执行（表现为「只打印到 kill-node 那行，然后什么也没发生」）；
 *   - 会连带杀掉机器上其它项目的 Node 服务（如 3001 端口的前端项目）。
 *
 * 新行为：只终止「正在监听目标端口」的进程，默认 3000。
 *   用法：node scripts/kill-node.js [port]
 */
import { freePort } from "./free-port.js";

const port = Number(process.argv[2] || process.env.PORT || 3000);

console.log(`[kill-node] 安全模式：只清理占用 ${port} 端口的进程，不影响其它 Node 项目`);

const { failed } = freePort(port);

process.exit(failed.length > 0 ? 1 : 0);
