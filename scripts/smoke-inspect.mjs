import { loadEnv } from "./load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, "../.env.dev"), { override: false });

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const admins = await prisma.admin.findMany({
  select: { id: true, username: true, displayName: true, employeeId: true, role: { select: { name: true } } },
});
console.log("ADMINS:", JSON.stringify(admins, null, 1));

const depts = await prisma.department.findMany({
  select: { id: true, name: true, managerId: true, manager: { select: { name: true } } },
});
console.log("DEPT:", JSON.stringify(depts, null, 1));

const flow = await prisma.workflowDefinition.findMany({
  where: { status: "PUBLISHED" },
  select: {
    id: true, businessType: true, version: true,
    nodes: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, nodeKey: true, assigneeType: true, assigneeRole: true, assigneeUserId: true, initiatorCanChoose: true, ccType: true, rejectPolicy: true } },
  },
});
console.log("FLOW:", JSON.stringify(flow, null, 1));

// 员工名下的资产 + 配件类别
const cats = await prisma.assetCategory.findMany({ select: { id: true, name: true } });
console.log("CATS:", JSON.stringify(cats, null, 1));
const assets = await prisma.asset.findMany({
  where: { status: { not: "SCRAPPED" } },
  select: {
    id: true, assetNo: true, name: true, status: true,
    employee: { select: { name: true } },
    components: { select: { model: { select: { name: true, categoryId: true } } } },
  },
  take: 15,
});
console.log("ASSETS:", JSON.stringify(assets, null, 1));

// 模型可选：查一个类别的模型列表（用于升级）
const catModels = await prisma.componentModel.findMany({
  where: {},
  select: { id: true, name: true, category: { select: { id: true, name: true } }, stock: { select: { quantity: true } } },
  take: 30,
});
console.log("MODELS:", JSON.stringify(catModels, null, 1));

await prisma.$disconnect();