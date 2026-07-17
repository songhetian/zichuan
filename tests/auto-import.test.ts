import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { importAssetsAuto, importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import * as XLSX from "xlsx";

// ============================================================
// 测试 seam：auto-import actions — 自动导入设备
// ============================================================

describe("自动导入设备", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("可以自动创建设备分类、配件、模板、员工、部门并导入设备", async () => {
    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
            { category: "内存", name: "32GB DDR4 3200MHz", brand: "Kingston" },
            { category: "硬盘", name: "1TB NVMe SSD", brand: "Samsung" },
            { category: "主板", name: "B660M", brand: "ASUS" },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    const data = unwrap(result);
    expect(data.importedCount).toBe(1);
    expect(data.errors).toHaveLength(0);
    expect(data.details).toHaveLength(1);
    expect(data.details[0].assetNo).toMatch(/^PC-\d{4}$/);
    expect(data.details[0].deviceName).toBe("张三的电脑主机");
    expect(data.details[0].employeeName).toBe("张三");
    expect(data.details[0].componentsCreated).toBe(4);

    // 验证设备分类已创建
    const category = await prisma.assetCategory.findUnique({ where: { name: "电脑主机" } });
    expect(category).not.toBeNull();
    expect(category!.code).toBe("PC");

    // 验证配件分类已创建
    const compCategories = await prisma.componentCategory.findMany();
    expect(compCategories).toHaveLength(4);
    const compCatNames = compCategories.map((c) => c.name).sort();
    expect(compCatNames).toContain("CPU");
    expect(compCatNames).toContain("内存");
    expect(compCatNames).toContain("主板");
    expect(compCatNames).toContain("硬盘");

    // 验证配件型号已创建
    const models = await prisma.componentModel.findMany();
    expect(models).toHaveLength(4);

    // 验证配件库存已创建
    const stocks = await prisma.componentStock.findMany();
    expect(stocks).toHaveLength(4);
    for (const stock of stocks) {
      expect(stock.quantity).toBe(1);
    }

    // 验证设备模板已创建
    const template = await prisma.deviceTemplate.findFirst({
      where: { category: { name: "电脑主机" } },
      include: { components: true },
    });
    expect(template).not.toBeNull();
    expect(template!.components).toHaveLength(4);
    expect(template!.name).toContain("电脑主机");
    expect(template!.name).toContain("i7-12700");

    // 验证部门已创建
    const dept = await prisma.department.findUnique({ where: { name: "技术部" } });
    expect(dept).not.toBeNull();

    // 验证员工已创建
    const emp = await prisma.employee.findFirst({ where: { name: "张三" } });
    expect(emp).not.toBeNull();
    expect(emp!.employeeNo).toMatch(/^EMP\d{4}$/);
    expect(emp!.departmentId).toBe(dept!.id);

    // 验证设备已创建并分配
    const asset = await prisma.asset.findFirst({
      where: { name: "张三的电脑主机" },
      include: { components: true },
    });
    expect(asset).not.toBeNull();
    expect(asset!.assetNo).toMatch(/^PC-\d{4}$/);
    expect(asset!.status).toBe("IN_USE");
    expect(asset!.employeeId).toBe(emp!.id);
    expect(asset!.components).toHaveLength(4);

    // 验证生命周期日志
    const logs = await prisma.lifecycleLog.findMany({ where: { assetId: asset!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("ALLOCATED");
    expect(logs[0].fromStatus).toBe("IDLE");
    expect(logs[0].toStatus).toBe("IN_USE");

    // 验证系统日志
    const sysLogs = await prisma.systemLog.findMany({ where: { module: "asset" } });
    expect(sysLogs.length).toBeGreaterThan(0);
  });

  it("配件组合不同时生成不同的设备模板", async () => {
    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
            { category: "内存", name: "32GB DDR4 3200MHz", brand: "Kingston" },
          ],
        },
        {
          employeeName: "李四",
          departmentName: "技术部",
          deviceName: "李四的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i5-12400", brand: "Intel" },
            { category: "内存", name: "16GB DDR4 3200MHz", brand: "Kingston" },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(2);

    // 应该有2个不同的模板
    const templates = await prisma.deviceTemplate.findMany({
      where: { category: { name: "电脑主机" } },
    });
    expect(templates).toHaveLength(2);
    // 模板名包含配置摘要
    expect(templates[0].name).toContain("电脑主机");
    expect(templates[1].name).toContain("电脑主机");
  });

  it("配件组合相同时复用同一个模板", async () => {
    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
            { category: "内存", name: "32GB DDR4 3200MHz", brand: "Kingston" },
          ],
        },
        {
          employeeName: "李四",
          departmentName: "财务部",
          deviceName: "李四的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
            { category: "内存", name: "32GB DDR4 3200MHz", brand: "Kingston" },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(2);

    // 应该只有1个模板（配件相同，复用）
    const templates = await prisma.deviceTemplate.findMany({
      where: { category: { name: "电脑主机" } },
    });
    expect(templates).toHaveLength(1);

    const data = unwrap(result);
    expect(data.details[0].templateIsNew).toBe(true);
    expect(data.details[1].templateIsNew).toBe(false);
  });

  it("模板名称相同时自动加序号区分", async () => {
    // 先创建一个同名模板但BOM不同
    const cat = await prisma.assetCategory.create({
      data: { name: "电脑主机", code: "PC" },
    });
    const cpuCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
    const cpuModel = await prisma.componentModel.create({
      data: {
        name: "旧CPU型号",
        categoryId: cpuCat.id,
        stock: { create: { quantity: 0 } },
      },
    });
    await prisma.deviceTemplate.create({
      data: {
        name: "电脑主机 (i7-12700 / 32GB / 1TB / SSD)",
        categoryId: cat.id,
        components: {
          create: [{ modelId: cpuModel.id, quantity: 1 }],
        },
      },
    });

    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
            { category: "内存", name: "32GB DDR4 3200MHz", brand: "Kingston" },
            { category: "硬盘", name: "1TB NVMe SSD", brand: "Samsung" },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(1);
    // 新模板名应该带 (2) 后缀（因为同名模板已存在但BOM不同）
    const data = unwrap(result);
    expect(data.details[0].templateName).toContain("(2)");
  });

  it("重复导入相同配件时不会重复创建型号", async () => {
    // 第一次导入
    await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
          ],
        },
      ],
    });

    // 第二次导入相同配件
    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "李四",
          departmentName: "财务部",
          deviceName: "李四的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [
            { category: "CPU", name: "Intel Core i7-12700", brand: "Intel" },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(1);

    // 配件型号应该只有1个（没有重复创建）
    const models = await prisma.componentModel.findMany();
    expect(models).toHaveLength(1);

    // 设备应该有2个
    const assets = await prisma.asset.findMany();
    expect(assets).toHaveLength(2);
  });

  it("可以批量导入多个设备", async () => {
    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i7-12700", brand: "Intel" }],
        },
        {
          employeeName: "李四",
          departmentName: "财务部",
          deviceName: "李四的电脑",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i5-12400", brand: "Intel" }],
        },
      ],
    });

    expect(result.success).toBe(true);
    const data = unwrap(result);
    expect(data.importedCount).toBe(2);
    expect(data.details).toHaveLength(2);

    // 验证编号连续
    const assets = await prisma.asset.findMany({ orderBy: { id: "asc" } });
    expect(assets).toHaveLength(2);
    expect(assets[0].assetNo).toBe("PC-0001");
    expect(assets[1].assetNo).toBe("PC-0002");
  });

  it("空数据时返回错误", async () => {
    const result = await importAssetsAuto({ assets: [] });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("没有要导入的设备数据");
  });

  it("设备分类code冲突时自动处理", async () => {
    // 先创建一个使用 PC code 的分类
    await prisma.assetCategory.create({ data: { name: "其他电脑", code: "PC" } });

    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i7-12700", brand: "Intel" }],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(1);

    // 验证两个分类都存在
    const categories = await prisma.assetCategory.findMany({ orderBy: { id: "asc" } });
    expect(categories).toHaveLength(2);
    expect(categories[0].code).toBe("PC");
    expect(categories[1].code).not.toBe("PC"); // 新分类的code被修改了
    expect(categories[1].name).toBe("电脑主机");
  });

  it("Excel格式多行导入 - 田鹤松的真实硬件数据", async () => {
    const rows = [
      {
        "使用人": "田鹤松",
        "部门": "后勤部",
        "设备名称": "田鹤松的电脑主机",
        "设备分类": "电脑主机",
        "设备分类编号": "PC",
        "CPU型号": "12th Gen Intel Core i5-12400",
        "CPU品牌": "GenuineIntel",
        "内存型号": "16GB DDR3200MHz",
        "内存品牌": "Shenzhen Zhongshi Technology Co Ltd",
        "硬盘型号": "953GB HDD (Dahua)",
        "硬盘品牌": "未知",
        "主板型号": "H610M-D",
        "主板品牌": "Colorful Technology And Development Co.,LTD",
        "显卡型号": "GameViewer Virtual Display Adapter (1GB)",
        "显卡品牌": "未知",
      },
      {
        "使用人": "张三",
        "部门": "技术部",
        "设备名称": "张三的电脑主机",
        "设备分类": "电脑主机",
        "设备分类编号": "PC",
        "CPU型号": "Intel Core i7-12700",
        "CPU品牌": "Intel",
        "内存型号": "32GB DDR4 3200MHz",
        "内存品牌": "Kingston",
        "硬盘型号": "1TB NVMe SSD",
        "硬盘品牌": "Samsung",
        "主板型号": "B660M",
        "主板品牌": "ASUS",
        "显卡型号": "NVIDIA RTX 3060",
        "显卡品牌": "NVIDIA",
      },
      {
        "使用人": "李四",
        "部门": "技术部",
        "设备名称": "李四的电脑主机",
        "设备分类": "电脑主机",
        "设备分类编号": "PC",
        "CPU型号": "Intel Core i5-12400",
        "CPU品牌": "Intel",
        "内存型号": "16GB DDR4 3200MHz",
        "内存品牌": "Kingston",
        "硬盘型号": "512GB NVMe SSD",
        "硬盘品牌": "Samsung",
        "主板型号": "B660M",
        "主板品牌": "ASUS",
        "显卡型号": "NVIDIA GTX 1650",
        "显卡品牌": "NVIDIA",
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "设备导入");
    const fileBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const buffer = Array.from(fileBuffer);

    const result = await importAssetsFromExcelAuto({ buffer });
    expect(result.success).toBe(true);
    const data = unwrap(result);
    expect(data.importedCount).toBe(3);
    expect(data.errors).toHaveLength(0);
    expect(data.details).toHaveLength(3);

    // 验证编号连续
    const assets = await prisma.asset.findMany({ orderBy: { id: "asc" } });
    expect(assets).toHaveLength(3);
    expect(assets[0].assetNo).toBe("PC-0001");
    expect(assets[1].assetNo).toBe("PC-0002");
    expect(assets[2].assetNo).toBe("PC-0003");

    // 验证田鹤松的设备
    const tianAsset = assets.find((a) => a.name === "田鹤松的电脑主机");
    expect(tianAsset).not.toBeNull();
    expect(tianAsset!.status).toBe("IN_USE");

    // 验证部门创建：后勤部和技术部（技术部只有1个，没有重复）
    const departments = await prisma.department.findMany();
    expect(departments).toHaveLength(2);
    const deptNames = departments.map((d) => d.name).sort();
    expect(deptNames).toEqual(["后勤部", "技术部"]);

    // 验证员工创建：3个员工
    const employees = await prisma.employee.findMany();
    expect(employees).toHaveLength(3);
    const empNames = employees.map((e) => e.name).sort();
    expect(empNames).toEqual(["张三", "李四", "田鹤松"]);

    // 验证田鹤松的部门是后勤部
    const tianEmp = employees.find((e) => e.name === "田鹤松");
    const houqinDept = departments.find((d) => d.name === "后勤部");
    expect(tianEmp!.departmentId).toBe(houqinDept!.id);

    // 验证配件型号：不重复创建相同型号
    const models = await prisma.componentModel.findMany();
    expect(models.length).toBeGreaterThanOrEqual(5);
    const cpuModels = models.filter((m) => m.name.includes("Core"));
    expect(cpuModels.length).toBeGreaterThanOrEqual(2);
  });

  it("重复导入相同部门不会重复创建", async () => {
    await prisma.department.create({ data: { name: "技术部" } });

    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i7-12700", brand: "Intel" }],
        },
        {
          employeeName: "李四",
          departmentName: "技术部",
          deviceName: "李四的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i5-12400", brand: "Intel" }],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(2);

    // 部门应该只有1个
    const departments = await prisma.department.findMany();
    expect(departments).toHaveLength(1);
    expect(departments[0].name).toBe("技术部");

    // 员工应该有2个
    const employees = await prisma.employee.findMany();
    expect(employees).toHaveLength(2);
  });

  it("重复导入相同员工不会重复创建", async () => {
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    await prisma.employee.create({
      data: { employeeNo: "EMP0001", name: "张三", departmentId: dept.id },
    });

    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑主机",
          categoryName: "电脑主机",
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i7-12700", brand: "Intel" }],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(1);

    // 员工应该只有1个（没有重复创建）
    const employees = await prisma.employee.findMany();
    expect(employees).toHaveLength(1);
    expect(employees[0].name).toBe("张三");

    // 设备应该成功创建并分配给该员工
    const assets = await prisma.asset.findMany();
    expect(assets).toHaveLength(1);
    expect(assets[0].employeeId).toBe(employees[0].id);
  });
});
