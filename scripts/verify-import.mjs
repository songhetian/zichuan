import { loadEnv } from "./load-env.js";
import { loadDevConfig } from "./dev-config.js";
import { PrismaClient } from "@prisma/client";
loadEnv(); loadEnv(".env.dev", { override: true });
loadDevConfig();
const p = new PrismaClient();

const admin = await p.admin.findUnique({ where: { username: "admin" }, include: { role: true } });
const assetmgr = await p.admin.findFirst({ where: { username: "assetmgr" }, include: { role: true } });
console.log("admin:", admin?.username, admin?.role?.key, "| assetmgr:", assetmgr?.username, assetmgr?.role?.key);

const empAdmins = await p.admin.findMany({
  where: { employeeId: { not: null } },
  include: { role: true },
});
console.log(
  "员工账号数:", empAdmins.length,
  "| DEPT_MANAGER:", empAdmins.filter((a) => a.role?.key === "DEPT_MANAGER").length,
  "| EMPLOYEE:", empAdmins.filter((a) => a.role?.key === "EMPLOYEE").length
);

const wf = await p.workflowDefinition.findMany({ include: { nodes: true } });
console.log("工作流:", wf.map((w) => `${w.businessType} v${w.version} ${w.status} nodes=${w.nodes.length}`).join(" | "));
console.log("角色:", (await p.role.findMany()).map((r) => r.key).join(","));

const asset = await p.asset.findFirst({
  where: { assetNo: "DT-2JG4DG" },
  include: { template: { include: { category: true } }, employee: { include: { department: true } } },
});
console.log(
  "样板资产:", asset?.assetNo, "->", asset?.name, "| status", asset?.status,
  "| 员工", asset?.employee?.name, "/", asset?.employee?.department?.name,
  "| 模板", asset?.template?.name, "/", asset?.template?.category?.name
);

const dept = await p.department.findMany({ include: { manager: { select: { name: true } } } });
console.log("部门数:", dept.length, "| 有主管:", dept.filter((d) => d.manager).length);
console.log("模板样例:", (await p.deviceTemplate.findMany({ take: 3, orderBy: { id: "asc" } })).map((t) => t.name).join(" | "));
await p.$disconnect();