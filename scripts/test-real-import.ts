/**
 * 真实数据库导入测试脚本
 * 使用田鹤松的真实硬件数据测试导入
 */

import { importAssetsFromExcelAuto } from "../src/actions/auto-import.actions";
import { setTestUser } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  setTestUser({ id: 1, username: "admin" });

  const excelPath = path.join(__dirname, process.argv[2] || "测试导入_6人3部门.xlsx");
  if (!fs.existsSync(excelPath)) {
    console.error("Excel文件不存在:", excelPath);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(excelPath);
  const buffer = Array.from(fileBuffer);

  console.log("=");
  console.log("  测试: 多人批量导入");
  console.log("  文件:", path.basename(excelPath));
  console.log("=");
  console.log();

  const result1 = await importAssetsFromExcelAuto({ buffer });

  if (!result1.success) {
    console.error("导入失败:", result1.error);
    process.exit(1);
  }

  const data1 = result1.data!;
  console.log(`  导入成功: ${data1.importedCount} 条`);
  console.log(`  错误数: ${data1.errors.length}`);
  console.log();

  for (const detail of data1.details) {
    console.log(`  行${detail.row}: ${detail.assetNo} - ${detail.deviceName}`);
    console.log(`    使用人: ${detail.employeeName}`);
    console.log(`    模板: ${detail.templateName} (${detail.templateIsNew ? "新建" : "复用"})`);
    console.log(`    配件数: ${detail.componentsCreated}`);
    console.log();
  }

  console.log("=");
  console.log("  数据库验证");
  console.log("=");
  console.log();

  const assets = await prisma.asset.findMany({ orderBy: { id: "asc" } });
  console.log(`  设备总数: ${assets.length}`);

  const categories = await prisma.assetCategory.findMany();
  console.log(`  设备分类数: ${categories.length}`);
  console.log(`    分类: ${categories.map((c) => c.name).join(", ")}`);

  const templates = await prisma.deviceTemplate.findMany({
    include: { category: true, components: true },
  });
  console.log(`  设备模板数: ${templates.length}`);
  for (const tpl of templates) {
    console.log(`    ${tpl.name} (${tpl.category.name}) - ${tpl.components.length}个配件`);
  }

  const departments = await prisma.department.findMany();
  console.log(`  部门数: ${departments.length}`);
  console.log(`    部门: ${departments.map((d) => d.name).join(", ")}`);

  const employees = await prisma.employee.findMany({
    include: { department: true },
  });
  console.log(`  员工数: ${employees.length}`);
  for (const emp of employees) {
    console.log(`    ${emp.employeeNo} ${emp.name} (${emp.department.name})`);
  }

  const compCategories = await prisma.componentCategory.findMany();
  console.log(`  配件分类数: ${compCategories.length}`);
  console.log(`    分类: ${compCategories.map((c) => c.name).join(", ")}`);

  const compModels = await prisma.componentModel.findMany({
    include: { category: true },
  });
  console.log(`  配件型号数: ${compModels.length}`);
  for (const model of compModels) {
    console.log(`    [${model.category.name}] ${model.name} (${model.brand || "未知品牌"})`);
  }

  console.log();
  console.log("=");
  console.log("  测试完成");
  console.log("=");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
