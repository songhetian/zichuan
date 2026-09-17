// 数据去重脚本：合并重复设备型号 + 重复配件型号
// 默认 DRY-RUN（只打印将要做什么，不改动数据）。
// 真正执行：node --env-file=.env scripts/dedupe-data.mjs --execute
//
// 去重规则：
//   1) 设备型号 DeviceTemplate：同 (分类, 去掉 (n) 后缀的规范名) 视为同一型号，
//      资产 Asset.templateId 改挂 canonical，删除多余的 (2)/(3)... 型号。
//      canonical 优先选「无后缀 base」，没有则取 id 最小；若 canonical 自身带后缀则改名为规范名。
//   2) 配件型号 ComponentModel：同 (分类, 规格名) 视为同一型号（忽略伪品牌），
//      重挂 TemplateComponent / AssetComponent / ComponentStockLog，合并 ComponentStock 库存，
//      删除多余型号。

import { PrismaClient } from "@prisma/client";
import {
  groupTemplateDuplicates,
  groupComponentDuplicates,
  stripTrailingDuplicateSuffix,
} from "../src/lib/dedupe.ts";
import { readFileSync, existsSync } from "node:fs";

// 在构造 PrismaClient 前加载 .env（DATABASE_URL 等）
function loadEnv() {
  const p = ".env";
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"\n]*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const EXECUTE = process.argv.includes("--execute");
const prisma = new PrismaClient();

function log(...a) {
  console.log(...a);
}

async function main() {
  log(`模式: ${EXECUTE ? "⚠️ 真正执行（会改动数据）" : "🔍 DRY-RUN（仅预览，不改动）"}\n`);

  // ---------- 设备型号 ----------
  const templates = await prisma.deviceTemplate.findMany({
    select: { id: true, categoryId: true, name: true },
  });
  const tGroups = groupTemplateDuplicates(templates);
  let templatesToDelete = 0;
  let assetsToReassign = 0;
  const renameCanonical = [];

  for (const g of tGroups) {
    const dups = g.ids.filter((id) => id !== g.canonicalId);
    templatesToDelete += dups.length;
    const assetCount = await prisma.asset.count({ where: { templateId: { in: dups } } });
    assetsToReassign += assetCount;
    const canonical = templates.find((t) => t.id === g.canonicalId);
    if (canonical && / \([0-9]+\)$/.test(canonical.name)) {
      renameCanonical.push({ id: canonical.id, from: canonical.name, to: stripTrailingDuplicateSuffix(canonical.name) });
    }
    log(`[型号组] ${g.key}`);
    log(`   保留 canonical id=${g.canonicalId} «${canonical?.name}»；删除 ${dups.length} 个重复，改挂 ${assetCount} 台资产`);
  }

  // ---------- 配件型号 ----------
  const components = await prisma.componentModel.findMany({
    select: { id: true, categoryId: true, name: true, brand: true },
  });
  const cGroups = groupComponentDuplicates(components);
  let modelsToDelete = 0;
  let compReassignTC = 0; // TemplateComponent
  let compReassignAC = 0; // AssetComponent
  let compReassignLog = 0; // ComponentStockLog
  let stocksMerged = 0;

  for (const g of cGroups) {
    const dups = g.ids.filter((id) => id !== g.canonicalId);
    modelsToDelete += dups.length;
    const tc = await prisma.templateComponent.count({ where: { modelId: { in: dups } } });
    const ac = await prisma.assetComponent.count({ where: { modelId: { in: dups } } });
    const sl = await prisma.componentStockLog.count({ where: { modelId: { in: dups } } });
    compReassignTC += tc;
    compReassignAC += ac;
    compReassignLog += sl;

    // 库存合并：把重复型号的库存累加到 canonical，再删重复库存
    const dupStocks = await prisma.componentStock.findMany({ where: { modelId: { in: dups } } });
    const canonStock = await prisma.componentStock.findUnique({ where: { modelId: g.canonicalId } });
    const totalQty = (canonStock?.quantity ?? 0) + dupStocks.reduce((s, x) => s + x.quantity, 0);
    stocksMerged += dupStocks.length;

    log(`[配件组] ${g.key}`);
    log(`   规格«${g.names[0]}» 品牌[${g.brands.join(", ")}] → 保留 canonical id=${g.canonicalId}`);
    log(`   删除 ${dups.length} 个重复型号；重挂 模板配件${tc} / 设备配件${ac} / 库存流水${sl}；库存合并后=${totalQty}`);
  }

  log("\n================ 汇总 ================");
  log(`设备型号：重复组 ${tGroups.length} 个，将删除型号 ${templatesToDelete} 个，改挂资产 ${assetsToReassign} 台，规范名改名 ${renameCanonical.length} 处`);
  log(`配件型号：重复组 ${cGroups.length} 个，将删除型号 ${modelsToDelete} 个，重挂 模板配件${compReassignTC}/设备配件${compReassignAC}/流水${compReassignLog}，合并库存 ${stocksMerged} 条`);
  log(`去重前 DeviceTemplate=${templates.length}，ComponentModel=${components.length}`);

  if (!EXECUTE) {
    log("\n（DRY-RUN 结束，未改动任何数据。加 --execute 真正执行）");
    return;
  }

  // ---------- 真正执行（事务） ----------
  log("\n开始执行...");
  await prisma.$transaction(async (tx) => {
    // 设备型号
    for (const g of tGroups) {
      const dups = g.ids.filter((id) => id !== g.canonicalId);
      await tx.asset.updateMany({ where: { templateId: { in: dups } }, data: { templateId: g.canonicalId } });
      await tx.deviceTemplate.deleteMany({ where: { id: { in: dups } } });
    }
    for (const r of renameCanonical) {
      await tx.deviceTemplate.update({ where: { id: r.id }, data: { name: r.to } });
    }

    // 配件型号
    for (const g of cGroups) {
      const dups = g.ids.filter((id) => id !== g.canonicalId);
      // 模板配件：若 canonical 已存在同 (templateId,modelId) 则删重复行，否则改挂
      const tcRows = await tx.templateComponent.findMany({ where: { modelId: { in: dups } } });
      for (const row of tcRows) {
        const exists = await tx.templateComponent.findFirst({
          where: { templateId: row.templateId, modelId: g.canonicalId },
        });
        if (exists) await tx.templateComponent.delete({ where: { id: row.id } });
        else await tx.templateComponent.update({ where: { id: row.id }, data: { modelId: g.canonicalId } });
      }
      await tx.assetComponent.updateMany({ where: { modelId: { in: dups } }, data: { modelId: g.canonicalId } });
      await tx.componentStockLog.updateMany({ where: { modelId: { in: dups } }, data: { modelId: g.canonicalId } });

      // 库存合并
      const dupStocks = await tx.componentStock.findMany({ where: { modelId: { in: dups } } });
      const addQty = dupStocks.reduce((s, x) => s + x.quantity, 0);
      if (addQty !== 0) {
        await tx.componentStock.upsert({
          where: { modelId: g.canonicalId },
          create: { modelId: g.canonicalId, quantity: addQty },
          update: { quantity: { increment: addQty } },
        });
      }
      await tx.componentStock.deleteMany({ where: { modelId: { in: dups } } });
      await tx.componentModel.deleteMany({ where: { id: { in: dups } } });
    }
  });

  const afterT = await prisma.deviceTemplate.count();
  const afterC = await prisma.componentModel.count();
  const orphan = await prisma.asset.count({ where: { templateId: { notIn: (await prisma.deviceTemplate.findMany({ select: { id: true } })).map((t) => t.id) } } });
  log(`\n✅ 执行完成。DeviceTemplate: ${templates.length} → ${afterT}；ComponentModel: ${components.length} → ${afterC}；孤儿资产: ${orphan}`);
}

main()
  .catch((e) => {
    console.error("❌ 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
