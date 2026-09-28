// ============================================================
// 存量审批流程「手动执行类型末节点角色」巡检脚本（只读，不写库）
//
// 背景：升级 / 更换 / 维修（ASSET_UPGRADE / ASSET_REPLACE / ASSET_REPAIR）
// 为「手动执行型」——审批通过后按末节点的 assigneeRole 写入 finalNodeRole，
// 「待执行变更」再按当前登录用户的角色认领执行。若末节点不是「按角色（ROLE）
// 且已指定具体角色」，finalNodeRole 会为空 → 没有任何角色能认领 → 孤儿单。
//
// 发布（publishWorkflowDefinition）与设为生效（activateWorkflowVersion）现已加
// 硬校验拦截新配置，但**存量已发布配置不会被回溯**，故用本脚本一次性列出所有
// 受影响版本，供人工把末节点改为「按角色 + 具体角色」后重新发布。
//
// 用法：
//   node scripts/audit-workflow-final-role.mjs
//   或  npm run audit:workflow
//   默认审计「开发库」（复用 .env + .env.dev，含「库名须以 -dev 结尾」安全闸门）。
//   如需审计其它库，显式传入连接串：
//     DATABASE_URL=mysql://user:pass@host:port/db node scripts/audit-workflow-final-role.mjs
//
// 退出码：0 = 巡检完成（无论是否发现问题）；1 = 脚本异常或无法确定目标库。
// ============================================================
import { PrismaClient } from "@prisma/client";
import { loadDevConfig } from "./dev-config.js";

// 连接库选择：
//  - 显式传入 DATABASE_URL → 直接使用（可审计任意库，含生产，请慎用）
//  - 否则 → 复用开发库配置（.env + .env.dev），默认只碰开发库
const explicitUrl = process.env.DATABASE_URL;
if (explicitUrl) {
  console.log("[audit] 使用显式传入的 DATABASE_URL");
} else {
  const cfg = loadDevConfig();
  if (cfg.error) {
    console.error("[audit] 无法确定数据库连接：");
    console.error(cfg.error);
    console.error(
      "[audit] 可用 DATABASE_URL=mysql://user:pass@host:port/db 显式指定目标库。"
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = cfg.dbUrl;
  console.log(`[audit] 目标库：${cfg.host}:${cfg.port}/${cfg.dbName}`);
}

const MANUAL_TYPES = ["ASSET_UPGRADE", "ASSET_REPLACE", "ASSET_REPAIR"];
const TYPE_LABEL = {
  ASSET_UPGRADE: "资产升级",
  ASSET_REPLACE: "资产更换",
  ASSET_REPAIR: "资产维修",
};
const STATUS_ORDER = { PUBLISHED: 0, ARCHIVED: 1, DRAFT: 2 };

const prisma = new PrismaClient();

/** 末节点是否「不是按角色 / 未指定角色」——命中即为异常配置（含完全无节点）。 */
function isBadLast(last) {
  if (!last) return true;
  return !(last.assigneeType === "ROLE" && last.assigneeRole);
}

function statusFlag(status) {
  if (status === "PUBLISHED") return "🔴 生效中";
  if (status === "ARCHIVED") return "🟠 已归档";
  return "⚪ 草稿";
}

async function main() {
  const defs = await prisma.workflowDefinition.findMany({
    where: { businessType: { in: MANUAL_TYPES } },
    orderBy: [{ businessType: "asc" }, { version: "desc" }],
    select: { id: true, businessType: true, name: true, version: true, status: true },
  });

  console.log("=".repeat(72));
  console.log("审批流程巡检：手动执行类型（升级/更换/维修）末节点角色");
  console.log("=".repeat(72));

  if (defs.length === 0) {
    console.log("未发现升级/更换/维修类型的流程定义，无需巡检。");
    return;
  }

  // 一次性取全部节点，按 sortOrder 归并出每个定义的「末节点」
  const nodes = await prisma.workflowNode.findMany({
    where: { definitionId: { in: defs.map((d) => d.id) } },
    orderBy: [{ definitionId: "asc" }, { sortOrder: "asc" }],
    select: {
      definitionId: true,
      name: true,
      assigneeType: true,
      assigneeRole: true,
    },
  });
  const lastByDef = new Map();
  for (const n of nodes) lastByDef.set(n.definitionId, n);

  const bad = defs
    .map((def) => ({ def, last: lastByDef.get(def.id) ?? null }))
    .filter((x) => isBadLast(x.last))
    .sort((a, b) => (STATUS_ORDER[a.def.status] ?? 9) - (STATUS_ORDER[b.def.status] ?? 9));

  console.log(`共 ${defs.length} 个流程定义，末节点配置异常 ${bad.length} 个。\n`);

  if (bad.length === 0) {
    console.log("✅ 全部末节点均为「按角色且已指定角色」，无孤儿单风险。");
    return;
  }

  for (const { def, last } of bad) {
    console.log(
      `[${statusFlag(def.status)}] ${TYPE_LABEL[def.businessType] ?? def.businessType}  v${def.version}  「${def.name}」  (definitionId=${def.id})`
    );
    if (!last) {
      console.log("        末节点：无（该版本没有任何审批节点）");
    } else {
      console.log(
        `        末节点：「${last.name}」  审批人类型=${last.assigneeType}  角色=${last.assigneeRole ?? "（空）"}`
      );
    }
    console.log("        处理：把末节点改为「按角色」并指定具体角色，然后重新发布该版本。");
    console.log("");
  }

  const published = bad.filter((x) => x.def.status === "PUBLISHED").length;
  const archived = bad.filter((x) => x.def.status === "ARCHIVED").length;
  const draft = bad.length - published - archived;

  console.log("-".repeat(72));
  console.log(`汇总：生效中 ${published} 个，已归档 ${archived} 个，草稿 ${draft} 个。`);
  if (published > 0) {
    console.log(
      "⚠️ 生效中的异常配置存在孤儿单风险：审批通过后将无人可在「待执行变更」认领执行，请优先处理。"
    );
  }
}

main()
  .catch((err) => {
    console.error("巡检失败：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });