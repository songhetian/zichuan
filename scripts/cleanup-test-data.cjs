const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // 按外键依赖顺序删除测试残留数据
  console.log('清理测试数据...');

  const stockLogs = await p.componentStockLog.deleteMany({});
  console.log('删除库存流水:', stockLogs.count);

  const assetComps = await p.assetComponent.deleteMany({});
  console.log('删除设备配件:', assetComps.count);

  const templateComps = await p.templateComponent.deleteMany({});
  console.log('删除模板配件:', templateComps.count);

  const stocks = await p.componentStock.deleteMany({});
  console.log('删除库存:', stocks.count);

  const assets = await p.asset.deleteMany({});
  console.log('删除设备:', assets.count);

  const templates = await p.deviceTemplate.deleteMany({});
  console.log('删除模板:', templates.count);

  const models = await p.componentModel.deleteMany({});
  console.log('删除配件型号:', models.count);

  const employees = await p.employee.deleteMany({});
  console.log('删除员工:', employees.count);

  const departments = await p.department.deleteMany({});
  console.log('删除部门:', departments.count);

  const assetCats = await p.assetCategory.deleteMany({});
  console.log('删除设备分类:', assetCats.count);

  const compCats = await p.componentCategory.deleteMany({});
  console.log('删除配件分类:', compCats.count);

  // 重新初始化 seed 数据
  console.log('\n重新执行 seed...');
  const bcrypt = require('bcryptjs');
  const existingAdmin = await p.admin.findFirst();
  if (!existingAdmin) {
    const hash = await bcrypt.hash('admin123', 10);
    await p.admin.create({ data: { username: 'admin', password: hash } });
    console.log('创建管理员账号 admin/admin123');
  } else {
    console.log('管理员账号已存在');
  }

  // 确认清理后的状态
  console.log('\n清理后数据库状态:');
  console.log('  设备:', await p.asset.count());
  console.log('  模板:', await p.deviceTemplate.count());
  console.log('  配件型号:', await p.componentModel.count());
  console.log('  员工:', await p.employee.count());
  console.log('  部门:', await p.department.count());

  await p.$disconnect();
  console.log('\n✅ 清理完成');
})();
