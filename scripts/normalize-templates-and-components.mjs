import { PrismaClient } from "@prisma/client";
import {
  cpuBaseName,
  isComputerHostTemplate,
  extractBrandFromName,
} from "../src/lib/template-normalize.ts";

const EXECUTE = process.argv.includes("--execute");
const prisma = new PrismaClient();

const STRIP_CATEGORIES = new Set([2, 3, 4]);

const COMPONENT_MERGES = [
  ["12th Gen Intel Core i3-12100", 1, "Intel(R) Core(TM) i3-12100", 1],
  ["LEN T2224rbA", 4, "T2224r", 4],
  ["Intel(R) HD Graphics 530", 6, "Intel(R) HD Graphics 530", 3],
  ["16GB DDR3200MHz", 2, "16G DDR4 3200", 2],
];

async function main() {
  const ops = [];

  const templates = await prisma.deviceTemplate.findMany({
    include: { assets: true, components: { include: { model: true } } },
  });
  const groups = new Map();
  for (const t of templates) {
    if (!isComputerHostTemplate(t.name)) continue;
    const base = cpuBaseName(t.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(t);
  }
  for (const [base, list] of groups) {
    if (list.length === 1) {
      const only = list[0];
      if (only.name !== base) {
        ops.push({ kind: "renameTemplate", id: only.id, from: only.name, to: base });
      }
      continue;
    }
    list.sort((a, b) => b.assets.length - a.assets.length || a.id - b.id);
    const canonical = list[0];
    const drops = list.slice(1);
    ops.push({
      kind: "mergeTemplates",
      base,
      canonical: { id: canonical.id, name: canonical.name, assets: canonical.assets.length },
      drops: drops.map((d) => ({ id: d.id, name: d.name, assets: d.assets.length })),
      reassignAssets: drops.reduce((s, d) => s + d.assets.length, 0),
    });
  }

  const models = await prisma.componentModel.findMany();
  for (const m of models) {
    if (m.categoryId !== 3) continue;
    if (m.brand && m.brand !== "\u672a\u77e5" && m.brand !== "") continue;
    const ex = extractBrandFromName(m.name);
    if (ex) ops.push({ kind: "backfillBrand", id: m.id, name: m.name, brand: ex.brand });
  }

  for (const [keepName, keepCat, dropName, dropCat] of COMPONENT_MERGES) {
    const keep = models.find((m) => m.name === keepName && m.categoryId === keepCat);
    const drop = models.find((m) => m.name === dropName && m.categoryId === dropCat);
    if (keep && drop && keep.id !== drop.id) {
      ops.push({ kind: "mergeComponent", keepId: keep.id, dropId: drop.id, name: keepName, cat: keepCat });
    }
  }

  const byKind = (k) => ops.filter((o) => o.kind === k);
  console.log("========== DRY-RUN 报告 ==========");
  console.log("模板合并组数: " + byKind("mergeTemplates").length + "  单模板重命名: " + byKind("renameTemplate").length);
  for (const o of byKind("mergeTemplates")) {
    console.log("  [合并] " + o.base + " <- canonical=" + o.canonical.name + " (资产" + o.canonical.assets + ")");
    for (const d of o.drops) console.log("       删除 " + d.name + " (资产" + d.assets + ")");
    console.log("       共改挂资产: " + o.reassignAssets);
  }
  for (const o of byKind("renameTemplate")) console.log("  [重命名] " + o.from + " -> " + o.to);
  console.log("品牌回填条目(仅硬盘类): " + byKind("backfillBrand").length);
  console.log("配件合并条目: " + byKind("mergeComponent").length);
  for (const o of byKind("mergeComponent")) console.log("   合并 " + o.name + " (cat" + o.cat + ") dropId=" + o.dropId + " -> keepId=" + o.keepId);
  console.log("==================================");

  if (!EXECUTE) {
    console.log("(dry-run, 未改动数据. 加 --execute 才写库)");
    await prisma.$disconnect();
    return;
  }

  console.log("执行中...");
  await prisma.$transaction(async (tx) => {
    for (const o of byKind("mergeTemplates")) {
      const canonical = o.canonical.id;
      for (const d of o.drops) {
        await tx.asset.updateMany({ where: { templateId: d.id }, data: { templateId: canonical } });
      }
      const bom = await tx.templateComponent.findMany({ where: { templateId: canonical }, include: { model: true } });
      for (const bc of bom) {
        if (STRIP_CATEGORIES.has(bc.model.categoryId)) {
          await tx.templateComponent.delete({ where: { id: bc.id } });
        }
      }
      for (const d of o.drops) await tx.deviceTemplate.delete({ where: { id: d.id } });
      await tx.deviceTemplate.update({ where: { id: canonical }, data: { name: o.base } });
    }
    for (const o of byKind("renameTemplate")) {
      await tx.deviceTemplate.update({ where: { id: o.id }, data: { name: o.to } });
    }
    for (const o of byKind("backfillBrand")) {
      await tx.componentModel.update({ where: { id: o.id }, data: { brand: o.brand } });
    }
    for (const o of byKind("mergeComponent")) {
      await tx.assetComponent.updateMany({ where: { modelId: o.dropId }, data: { modelId: o.keepId } });
      await tx.templateComponent.updateMany({ where: { modelId: o.dropId }, data: { modelId: o.keepId } });
      await tx.componentStockLog.updateMany({ where: { modelId: o.dropId }, data: { modelId: o.keepId } });
      const dropStock = await tx.componentStock.findUnique({ where: { modelId: o.dropId } });
      const keepStock = await tx.componentStock.findUnique({ where: { modelId: o.keepId } });
      if (dropStock) {
        if (keepStock) {
          await tx.componentStock.update({ where: { id: keepStock.id }, data: { quantity: keepStock.quantity + dropStock.quantity } });
          await tx.componentStock.delete({ where: { id: dropStock.id } });
        } else {
          await tx.componentStock.update({ where: { id: dropStock.id }, data: { modelId: o.keepId } });
        }
      }
      await tx.componentModel.delete({ where: { id: o.dropId } });
    }
  });
  console.log("执行完成.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
