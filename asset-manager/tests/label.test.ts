import { describe, it, expect } from "vitest";
import { generateLabelData } from "@/actions/label.actions";
import { prisma } from "@/lib/prisma";

async function setupLabelData() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
  });

  const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  const ram = await prisma.componentCategory.create({ data: { name: "内存" } });
  const mem = await prisma.componentModel.create({
    data: { name: "16GB DDR4", brand: "金士顿", categoryId: ram.id },
  });

  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准电脑", categoryId: assetCat.id },
  });

  const asset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "张三的办公电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
      location: "办公室 A",
    },
  });

  await prisma.assetComponent.createMany({
    data: [
      { assetId: asset.id, modelId: cpu.id, quantity: 1 },
      { assetId: asset.id, modelId: mem.id, quantity: 2 },
    ],
  });

  return { dept, emp, asset, cpu, mem };
}

describe("标签打印", () => {
  describe("generateLabelData — 生成标签数据", () => {
    it("可以生成单台设备的标签数据", async () => {
      const { asset } = await setupLabelData();

      const result = await generateLabelData({ assetIds: [asset.id] });

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);

      const label = result.data![0];
      expect(label.assetNo).toBe("DN-0001");
      expect(label.name).toBe("张三的办公电脑");
      expect(label.employeeName).toBe("张三");
      expect(label.departmentName).toBe("技术部");
      expect(label.location).toBe("办公室 A");
      expect(label.components).toBeDefined();
      expect(label.components?.length).toBe(2);
    });

    it("可以批量生成多台设备的标签数据", async () => {
      const { emp } = await setupLabelData();
      const template = await prisma.deviceTemplate.findFirst()!;

      const asset2 = await prisma.asset.create({
        data: {
          assetNo: "DN-0002",
          name: "李四的办公电脑",
          templateId: template.id,
          status: "IN_USE",
          employeeId: emp.id,
          location: "办公室 B",
        },
      });

      const allAssets = await prisma.asset.findMany({ select: { id: true } });
      const result = await generateLabelData({ assetIds: allAssets.map((a) => a.id) });

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it("可以按员工生成该员工所有设备的标签", async () => {
      const { emp, asset } = await setupLabelData();

      const result = await generateLabelData({ employeeId: emp.id });

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data![0].assetNo).toBe("DN-0001");
    });

    it("没有设备的员工返回空标签列表", async () => {
      const dept = await prisma.department.create({ data: { name: "市场部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E999", name: "王五", departmentId: dept.id },
      });

      const result = await generateLabelData({ employeeId: emp.id });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("标签数据包含完整的配件配置信息", async () => {
      const { asset } = await setupLabelData();

      const result = await generateLabelData({ assetIds: [asset.id] });
      const label = result.data![0];

      const compNames = label.components!.map((c) => c.modelName);
      expect(compNames).toContain("i7-12700F");
      expect(compNames).toContain("16GB DDR4");
    });
  });
});
