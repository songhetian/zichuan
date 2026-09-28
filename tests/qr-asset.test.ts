import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { getQrAsset } from "@/actions/qr.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupAsset() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
  });
  const cat = await prisma.assetCategory.create({ data: { name: "计算机", code: "DN" } });
  const tpl = await prisma.deviceTemplate.create({ data: { name: "标准电脑", categoryId: cat.id } });
  const asset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "办公电脑",
      templateId: tpl.id,
      status: "IN_USE",
      employeeId: emp.id,
      location: "3F-研发区-12",
    },
  });
  return { asset };
}

describe("二维码扫码瘦身页 - 资产查询", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("getQrAsset", () => {
    it("按编号查询资产概要（含使用人/部门/位置），供扫码页展示", async () => {
      await setupAsset();

      const result = await getQrAsset("DN-0001");
      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.assetNo).toBe("DN-0001");
      expect(data.name).toBe("办公电脑");
      expect(data.status).toBe("IN_USE");
      expect(data.employeeName).toBe("张三");
      expect(data.departmentName).toBe("技术部");
      expect(data.location).toBe("3F-研发区-12");
    });

    it("编号不存在时返回失败提示", async () => {
      await setupAsset();

      const result = await getQrAsset("DN-9999");
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("找到");
    });
  });
});