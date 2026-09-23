import { loadEnv } from "./load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, "../.env.dev"), { override: false });
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// 有账号 + 部门有主管账号 的员工（可作为发起人走 DEPT_MANAGER 流程）
const rows = await prisma.employee.findMany({
  where: { account: { is: { isActive: true } } },
  select: {
    id: true, name: true,
    account: { select: { id: true, username: true } },
    department: { select: { name: true, manager: { select: { name: true, account: { select: { id: true, username: true } } } } } },
    assets: { where: { status: "IN_USE" }, select: { id: true, assetNo: true, name: true, status: true, components: { select: { model: { select: { categoryId: true } } } } } },
  },
});
for (const r of rows) {
  const m = r.department?.manager;
  const hasMgrAcct = !!m?.account;
  const usable = r.assets.filter((a) => a.components.length > 0);
  console.log(`${r.name} | acct#${r.account?.id}(${r.account?.username}) | dept=${r.department?.name} | 主管=${m?.name ?? "无"} 主管账号=${m?.account?.username ?? "无"} | 可提交设备=${usable.length}${usable[0] ? " 例:" + usable[0].assetNo + " cat=" + usable[0].components.map(c=>c.model.categoryId).join(",") : ""}`);
}
await prisma.$disconnect();