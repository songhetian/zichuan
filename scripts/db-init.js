import { execSync } from "child_process";
import path from "path";

const dbUrl = process.env.DATABASE_URL || "mysql://root:root@localhost:3306/zichuan";

const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
if (!match) {
  console.error("❌ 无法解析 DATABASE_URL");
  process.exit(1);
}

const [, user, password, host, port, dbName] = match;

console.log(`[db-init] 数据库配置:`);
console.log(`[db-init]   Host: ${host}:${port}`);
console.log(`[db-init]   User: ${user}`);
console.log(`[db-init]   Database: ${dbName}`);

const possibleMySqlPaths = [
  "D:\\Program Files\\FlyEnv-Data\\app\\mysql-8.2.0\\mysql-8.2.0-winx64\\bin\\mysql.exe",
  "D:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
  "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
];

let mysqlPath = "mysql";
for (const p of possibleMySqlPaths) {
  try {
    execSync(`"${p}" --version`, { encoding: "utf-8", stdio: "ignore" });
    mysqlPath = `"${p}"`;
    console.log(`[db-init] 找到 MySQL: ${p}`);
    break;
  } catch {
    continue;
  }
}

try {
  const createDbQuery = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  
  execSync(
    `${mysqlPath} -h ${host} -P ${port} -u ${user} -p${password} -e "${createDbQuery}"`,
    { encoding: "utf-8" }
  );
  
  console.log(`[db-init] ✅ 数据库 ${dbName} 创建成功`);
  process.exit(0);
} catch (error) {
  console.error("[db-init] ❌ 创建数据库失败:", error.message);
  process.exit(1);
}