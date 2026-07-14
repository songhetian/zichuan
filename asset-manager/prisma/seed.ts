import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  console.log("开始填充测试数据...");

  // 1. 部门
  const departments = await Promise.all([
    prisma.department.create({ data: { name: "技术部" } }),
    prisma.department.create({ data: { name: "市场部" } }),
    prisma.department.create({ data: { name: "财务部" } }),
  ]);
  console.log(`创建 ${departments.length} 个部门`);

  // 2. 员工
  const employees = await Promise.all([
    prisma.employee.create({ data: { employeeNo: "E001", name: "张三", departmentId: departments[0].id, phone: "13800138000", email: "zhangsan@test.com" } }),
    prisma.employee.create({ data: { employeeNo: "E002", name: "李四", departmentId: departments[0].id, phone: "13900139000" } }),
    prisma.employee.create({ data: { employeeNo: "E003", name: "王五", departmentId: departments[1].id, phone: "13700137000", email: "wangwu@test.com" } }),
    prisma.employee.create({ data: { employeeNo: "E004", name: "赵六", departmentId: departments[1].id, phone: "13600136000" } }),
    prisma.employee.create({ data: { employeeNo: "E005", name: "钱七", departmentId: departments[2].id, phone: "13500135000" } }),
  ]);
  console.log(`创建 ${employees.length} 个员工`);

  // 3. 配件分类（两级）
  const cpuCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpuIntelCat = await prisma.componentCategory.create({ data: { name: "Intel", parentId: cpuCat.id } });
  const cpuAmdCat = await prisma.componentCategory.create({ data: { name: "AMD", parentId: cpuCat.id } });

  const ramCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const ramDdr4 = await prisma.componentCategory.create({ data: { name: "DDR4", parentId: ramCat.id } });
  const ramDdr5 = await prisma.componentCategory.create({ data: { name: "DDR5", parentId: ramCat.id } });

  const diskCat = await prisma.componentCategory.create({ data: { name: "硬盘" } });
  const diskSsd = await prisma.componentCategory.create({ data: { name: "SSD", parentId: diskCat.id } });
  const diskHdd = await prisma.componentCategory.create({ data: { name: "HDD", parentId: diskCat.id } });

  const gpuCat = await prisma.componentCategory.create({ data: { name: "显卡" } });
  const nicCat = await prisma.componentCategory.create({ data: { name: "网卡" } });
  console.log("创建配件分类");

  // 4. 配件型号 + 库存
  const models: Record<string, number> = {};
  const createModel = async (name: string, brand: string, catId: number, qty: number) => {
    const m = await prisma.componentModel.create({
      data: { name, brand, categoryId: catId, stock: { create: { quantity: qty } } },
    });
    models[name] = m.id;
    return m;
  };

  await createModel("i7-12700F", "Intel", cpuIntelCat.id, 10);
  await createModel("i9-13900K", "Intel", cpuIntelCat.id, 5);
  await createModel("Ryzen 5 5600X", "AMD", cpuAmdCat.id, 8);
  await createModel("16GB DDR4 3200", "金士顿", ramDdr4.id, 20);
  await createModel("32GB DDR5 5600", "金士顿", ramDdr5.id, 12);
  await createModel("512GB NVMe SSD", "三星", diskSsd.id, 15);
  await createModel("1TB NVMe SSD", "三星", diskSsd.id, 8);
  await createModel("2TB HDD", "西部数据", diskHdd.id, 5);
  await createModel("RTX 3060", "NVIDIA", gpuCat.id, 6);
  await createModel("千兆网卡", "Intel", nicCat.id, 10);
  console.log(`创建 ${Object.keys(models).length} 个配件型号`);

  // 5. 设备分类（两级）
  const computerCat = await prisma.assetCategory.create({ data: { name: "计算机设备", code: "DN" } });
  const desktopCat = await prisma.assetCategory.create({ data: { name: "台式机", code: "DT", parentId: computerCat.id } });
  const laptopCat = await prisma.assetCategory.create({ data: { name: "笔记本", code: "NB", parentId: computerCat.id } });

  const networkCat = await prisma.assetCategory.create({ data: { name: "网络设备", code: "WL" } });
  const switchCat = await prisma.assetCategory.create({ data: { name: "交换机", code: "SW", parentId: networkCat.id } });

  const officeCat = await prisma.assetCategory.create({ data: { name: "办公设备", code: "BG" } });
  const printerCat = await prisma.assetCategory.create({ data: { name: "打印机", code: "PR", parentId: officeCat.id } });
  console.log("创建设备分类");

  // 6. 设备模板 + BOM
  const tpl1 = await prisma.deviceTemplate.create({
    data: {
      name: "标准台式电脑",
      categoryId: desktopCat.id,
      components: {
        create: [
          { modelId: models["i7-12700F"], quantity: 1 },
          { modelId: models["16GB DDR4 3200"], quantity: 2 },
          { modelId: models["512GB NVMe SSD"], quantity: 1 },
          { modelId: models["千兆网卡"], quantity: 1 },
        ],
      },
    },
  });

  const tpl2 = await prisma.deviceTemplate.create({
    data: {
      name: "高性能台式电脑",
      categoryId: desktopCat.id,
      components: {
        create: [
          { modelId: models["i9-13900K"], quantity: 1 },
          { modelId: models["32GB DDR5 5600"], quantity: 2 },
          { modelId: models["1TB NVMe SSD"], quantity: 1 },
          { modelId: models["RTX 3060"], quantity: 1 },
          { modelId: models["千兆网卡"], quantity: 1 },
        ],
      },
    },
  });

  const tpl3 = await prisma.deviceTemplate.create({
    data: {
      name: "办公笔记本",
      categoryId: laptopCat.id,
      components: {
        create: [
          { modelId: models["i7-12700F"], quantity: 1 },
          { modelId: models["16GB DDR4 3200"], quantity: 2 },
          { modelId: models["512GB NVMe SSD"], quantity: 1 },
        ],
      },
    },
  });

  const tpl4 = await prisma.deviceTemplate.create({
    data: {
      name: "交换机",
      categoryId: switchCat.id,
      components: {
        create: [
          { modelId: models["千兆网卡"], quantity: 24 },
        ],
      },
    },
  });

  const tpl5 = await prisma.deviceTemplate.create({
    data: {
      name: "打印机",
      categoryId: printerCat.id,
      components: {},
    },
  });
  console.log("创建 5 个设备模板");

  // 7. 创建设备实体
  const assets = [];
  let dnCount = 0;
  let nbCount = 0;
  let wlCount = 0;
  let bgCount = 0;

  const createAsset = async (name: string, tplId: number, status: "IDLE" | "IN_USE" | "IN_MAINTENANCE" | "SCRAPPED", empId: number | null, location: string | null, prefix: string) => {
    dnCount++;
    const assetNo = `${prefix}-${String(dnCount).padStart(4, "0")}`;
    const asset = await prisma.asset.create({
      data: { assetNo, name, templateId: tplId, status, employeeId: empId, location, purchaseDate: new Date("2024-01-15"), warrantyMonths: 36 },
    });
    assets.push(asset);
    return asset;
  };

  // 重置计数器逻辑
  const prefixes: Record<string, number> = { DN: 0, NB: 0, SW: 0, PR: 0 };
  const nextNo = (prefix: string) => {
    prefixes[prefix] = (prefixes[prefix] || 0) + 1;
    return `${prefix}-${String(prefixes[prefix]).padStart(4, "0")}`;
  };

  // 闲置设备
  for (let i = 0; i < 3; i++) {
    const no = nextNo("DN");
    const a = await prisma.asset.create({
      data: { assetNo: no, name: `标准台式电脑-${i + 1}`, templateId: tpl1.id, status: "IDLE", location: "机房A", purchaseDate: new Date("2024-01-15"), warrantyMonths: 36 },
      include: { template: { include: { components: true } } },
    });
    // 创建配件配置
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  }

  // 在用设备（分配给技术部）
  for (let i = 0; i < 3; i++) {
    const no = nextNo("DN");
    const emp = employees[i % employees.length];
    const a = await prisma.asset.create({
      data: { assetNo: no, name: `高性能台式电脑-${i + 1}`, templateId: tpl2.id, status: "IN_USE", employeeId: emp.id, location: `${emp.name}工位`, purchaseDate: new Date("2024-03-20"), warrantyMonths: 36 },
      include: { template: { include: { components: true } } },
    });
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  }

  // 笔记本（分配给市场部）
  for (let i = 0; i < 2; i++) {
    const no = nextNo("NB");
    const emp = employees[2 + i];
    const a = await prisma.asset.create({
      data: { assetNo: no, name: `办公笔记本-${i + 1}`, templateId: tpl3.id, status: "IN_USE", employeeId: emp.id, location: `${emp.name}工位`, purchaseDate: new Date("2024-06-01"), warrantyMonths: 24 },
      include: { template: { include: { components: true } } },
    });
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  }

  // 网络设备
  for (let i = 0; i < 2; i++) {
    const no = nextNo("SW");
    const a = await prisma.asset.create({
      data: { assetNo: no, name: `交换机-${i + 1}`, templateId: tpl4.id, status: i === 0 ? "IDLE" : "IN_USE", employeeId: i === 1 ? employees[0].id : null, location: i === 0 ? "机房B" : "机房A-机架3", purchaseDate: new Date("2023-11-10"), warrantyMonths: 60 },
      include: { template: { include: { components: true } } },
    });
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  }

  // 打印机
  const prNo = nextNo("PR");
  await prisma.asset.create({
    data: { assetNo: prNo, name: "打印机-1", templateId: tpl5.id, status: "IN_USE", employeeId: employees[4].id, location: "财务部", purchaseDate: new Date("2024-02-01"), warrantyMonths: 12 },
  });

  // 维修中设备
  const repairNo = nextNo("DN");
  await prisma.asset.create({
    data: { assetNo: repairNo, name: "标准台式电脑-维修", templateId: tpl1.id, status: "IN_MAINTENANCE", location: "维修间", purchaseDate: new Date("2023-06-15"), warrantyMonths: 36 },
    include: { template: { include: { components: true } } },
  }).then(async (a) => {
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  });

  // 报废设备
  const scrapNo = nextNo("DN");
  await prisma.asset.create({
    data: { assetNo: scrapNo, name: "旧台式电脑", templateId: tpl1.id, status: "SCRAPPED", location: "仓库", purchaseDate: new Date("2020-01-01"), warrantyMonths: 0 },
    include: { template: { include: { components: true } } },
  }).then(async (a) => {
    for (const tc of a.template.components) {
      await prisma.assetComponent.create({ data: { assetId: a.id, modelId: tc.modelId, quantity: tc.quantity } });
    }
  });

  console.log("创建 12 台设备（闲置3 + 在用6 + 维修1 + 报废1 + 网络设备2）");

  // 8. 创建管理员
  const existingAdmin = await prisma.admin.findFirst();
  if (!existingAdmin) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash("admin123", 10);
    await prisma.admin.create({ data: { username: "admin", password: hash } });
    console.log("创建管理员账号 admin/admin123");
  }

  console.log("测试数据填充完成！");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
