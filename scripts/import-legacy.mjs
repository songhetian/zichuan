// ============================================================
// 旧数据库 → 新数据库 数据迁移脚本（只做数据转换，不改 schema）
//
// 读取旧库 mysqldump（用户提供的 sql 导出文件），把 16 张同名业务表
// （Admin / Asset / ... / TemplateComponent）的业务数据写入「已用当前
// Prisma schema 建好的」目标新库。
//
// 目标新库中比旧库多出的 10 张表（Role/Permission/RolePermission、
// WorkflowDefinition/Node/Edge、ApprovalRequest/Task/Log、Notification）
// 不在本脚本职责内——它们由 seed（prisma/seed.ts）在迁移后负责初始化，
// 本脚本一律跳过、永不触碰。
//
// 必读约束（与 prisma/schema.prisma 保持一致）：
//   * 主键 id 完全保留旧值——所有外键引用原样沿用即可成立，
//     杜绝「旧 Id → 新 Id」映射导致的引用断裂。
//   * 旧表缺失、新 model 新增的可空/默认列，按 legacy-mapping.js 的
//     build 规则补默认值（见各表 build 内注释）。
//   * 绝不修改 prisma/schema.prisma、prisma/migrations/、src/ 任何文件。
//
// 用法：
//   SOURCE_DUMP=/path/asset-manage.sql \
//   DATABASE_URL=mysql://user:pass@host:port/dbname \
//   node scripts/import-legacy.mjs
//
// 幂等策略：逐行 upsert（唯一键 = 主键 id）。重复运行只更新不重复插入，
// 因此不会产生重复行，且保留旧主键值 / 外键引用不被破坏。
// ============================================================
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./load-env.js";
import { parseLegacyDump, buildRows, IMPORT_ORDER } from "./legacy-mapping.js";

// 读取项目 .env（DATABASE_URL 等）。若用户在命令行已设置环境变量，
// loadEnv 默认不覆盖，故外部显式传入的 DATABASE_URL 优先生效。
loadEnv();

const SOURCE_DUMP = process.env.SOURCE_DUMP;
if (!SOURCE_DUMP) {
  console.error(
    "缺少 SOURCE_DUMP 环境变量。用法：\n" +
      "  SOURCE_DUMP=/path/asset-manage.sql DATABASE_URL=mysql://... node scripts/import-legacy.mjs"
  );
  process.exit(1);
}

const prisma = new PrismaClient();

// ---------- 工具 ----------
const warnings = [];
function warn(msg) {
  warnings.push(msg);
  console.warn("  ⚠ " + msg);
}

async function main() {
  console.log("读取旧库 dump:", SOURCE_DUMP);
  const sql = readFileSync(SOURCE_DUMP, "utf8");
  const dump = parseLegacyDump(sql);

  const presentTables = Object.keys(dump);
  console.log("旧库含表:", presentTables.join(", "));

  // 明确跳过 10 张审批/权限/通知新表（由 seed 负责）
  const skippedBySeed = [
    "Role", "Permission", "RolePermission",
    "WorkflowDefinition", "WorkflowNode", "WorkflowEdge",
    "ApprovalRequest", "ApprovalTask", "ApprovalLog", "Notification",
  ];
  console.log("跳过（seed 负责）:", skippedBySeed.join(", "));

  // 逐表迁移（严格按外键依赖顺序；被引用表先写，主键保留保证 FK 成立）
  const summary = [];
  for (const model of IMPORT_ORDER) {
    const rows = buildRows(model, dump);
    let written = 0;
    // 分批 upsert，降低单事务体积
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      await prisma.$transaction(
        batch.map(async (data) => {
          const { id, ...rest } = data;
          if (model === "admin" && rest.roleId == null) {
            // 超管保护：导入旧 admin 时若目标库 admin 已绑定了角色（seed 先跑过），
            // 不把 roleId 清成 null，避免反向覆盖超级管理员绑定（账号冲突的核心）。
            const existing = await prisma.admin.findUnique({
              where: { id },
              select: { roleId: true },
            });
            if (existing && existing.roleId != null) {
              delete rest.roleId;
            }
          }
          return prisma[model].upsert({ where: { id }, create: data, update: rest });
        })
      );
      written += batch.length;
    }
    summary.push({ model, rows: rows.length, written });
    if (rows.length === 0) warn(`[${model}] 旧 dump 中未找到数据（表可能为空）`);
  }
  console.log(
    "各表迁移行数:",
    summary.map((s) => `${s.model}=${s.rows}`).join(", ")
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("迁移失败:", e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });