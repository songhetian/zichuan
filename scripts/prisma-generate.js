import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function tryGenerate(retryCount = 0) {
  try {
    console.log(`[prisma-generate] 执行 prisma generate (尝试 ${retryCount + 1}/${MAX_RETRIES})...`);
    const result = execSync("npx prisma generate", {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log(result);
    console.log("[prisma-generate] ✅ Prisma Client 生成成功");
    return true;
  } catch (error) {
    const errorMsg = error.message || "";

    if (errorMsg.includes("EPERM") && retryCount < MAX_RETRIES - 1) {
      console.warn(`[prisma-generate] ⚠️  文件被锁定，${RETRY_DELAY_MS / 1000}秒后重试...`);
      const busyFile = path.join(
        __dirname,
        "..",
        "node_modules",
        ".prisma",
        "client",
        "query_engine-windows.dll.node"
      );
      if (fileExists(busyFile)) {
        console.warn("[prisma-generate] 💡 提示：请确保没有其他Node进程正在运行（如开发服务器、测试进程）");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS);
      return tryGenerate(retryCount + 1);
    }

    console.error("[prisma-generate] ❌ Prisma Client 生成失败");
    console.error(errorMsg);
    return false;
  }
}

const success = tryGenerate();
process.exit(success ? 0 : 1);