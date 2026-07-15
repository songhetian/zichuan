import { execSync } from "child_process";

const currentPid = process.pid;

console.log(`[kill-node] 当前进程ID: ${currentPid}`);

try {
  const output = execSync(
    `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH`,
    { encoding: "utf-8" }
  );
  
  const lines = output.trim().split("\n").filter(line => line.trim());
  
  if (lines.length === 0) {
    console.log("[kill-node] ✅ 没有找到其他Node进程");
    process.exit(0);
  }
  
  console.log("[kill-node] 发现以下Node进程:");
  
  let killedCount = 0;
  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const pidStr = parts[1].replace(/"/g, "").trim();
      const pid = parseInt(pidStr, 10);
      
      if (!isNaN(pid) && pid !== currentPid) {
        console.log(`[kill-node] 终止进程 PID: ${pid}`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { encoding: "utf-8", stdio: "ignore" });
          killedCount++;
        } catch (e) {
          console.log(`[kill-node] 终止进程 ${pid} 失败`);
        }
      }
    }
  }
  
  console.log(`[kill-node] ✅ 成功终止 ${killedCount} 个Node进程`);
  process.exit(0);
  
} catch (error) {
  console.error("[kill-node] ❌ 执行失败:", error.message);
  process.exit(1);
}