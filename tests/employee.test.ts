import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
} from "@/actions/department.actions";
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";

describe("部门 CRUD", () => {
  describe("createDepartment", () => {
    it("可以创建部门", async () => {
      const result = await createDepartment({ name: "技术部" });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("技术部");
    });

    it("部门名称不能重复", async () => {
      await createDepartment({ name: "技术部" });
      const result = await createDepartment({ name: "技术部" });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已存在");
    });

    it("名称不能为空", async () => {
      const result = await createDepartment({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("getDepartments", () => {
    it("可以获取全部部门列表", async () => {
      await createDepartment({ name: "技术部" });
      await createDepartment({ name: "财务部" });

      const result = await getDepartments();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });

    it("空数据库返回空数组", async () => {
      const result = await getDepartments();
      expect(unwrap(result)).toEqual([]);
    });
  });

  describe("getDepartmentById", () => {
    it("可以根据 ID 获取部门", async () => {
      const created = await createDepartment({ name: "技术部" });
      const result = await getDepartmentById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("技术部");
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getDepartmentById(99999);
      expect(result.success).toBe(false);
    });
  });

  describe("updateDepartment", () => {
    it("可以更新部门名称", async () => {
      const created = await createDepartment({ name: "旧名称" });
      const result = await updateDepartment(unwrap(created).id, { name: "新名称" });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("新名称");
    });

    it("更新名称不能与已有部门重复", async () => {
      await createDepartment({ name: "A" });
      const b = await createDepartment({ name: "B" });

      const result = await updateDepartment(unwrap(b).id, { name: "A" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteDepartment", () => {
    it("可以删除没有员工的部门", async () => {
      const created = await createDepartment({ name: "待删除" });
      const result = await deleteDepartment(unwrap(created).id);

      expect(result.success).toBe(true);
      const check = await prisma.department.findUnique({ where: { id: unwrap(created).id } });
      expect(check).toBeNull();
    });

    it("有员工时不能删除", async () => {
      const dept = await createDepartment({ name: "技术部" });
      await prisma.employee.create({
        data: { employeeNo: "E001", name: "张三", departmentId: unwrap(dept).id },
      });

      const result = await deleteDepartment(unwrap(dept).id);
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("有员工");
    });
  });
});

describe("员工 CRUD", () => {
  async function setupDept(name = "技术部") {
    const result = await createDepartment({ name });
    return unwrap(result);
  }

  describe("createEmployee", () => {
    it("可以创建员工", async () => {
      const dept = await setupDept();

      const result = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept.id,
        phone: "13800138000",
        email: "zhangsan@example.com",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).employeeNo).toBe("E001");
      expect(unwrap(result).name).toBe("张三");
      expect(unwrap(result).departmentId).toBe(dept.id);
      expect(unwrap(result).phone).toBe("13800138000");
      expect(unwrap(result).email).toBe("zhangsan@example.com");
    });

    it("工号不能重复", async () => {
      const dept = await setupDept();
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept.id });

      const result = await createEmployee({
        employeeNo: "E001",
        name: "李四",
        departmentId: dept.id,
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("工号");
    });

    it("必填字段不能为空", async () => {
      const dept = await setupDept();

      const r1 = await createEmployee({ employeeNo: "", name: "张三", departmentId: dept.id });
      expect(r1.success).toBe(false);

      const r2 = await createEmployee({ employeeNo: "E002", name: "", departmentId: dept.id });
      expect(r2.success).toBe(false);
    });

    it("部门不存在时创建失败", async () => {
      const result = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: 99999,
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("部门不存在");
    });
  });

  describe("getEmployees", () => {
    it("可以获取全部员工列表", async () => {
      const dept = await setupDept();
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept.id });
      await createEmployee({ employeeNo: "E002", name: "李四", departmentId: dept.id });

      const result = await getEmployees();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });

    it("可以按部门筛选", async () => {
      const dept1 = await setupDept("技术部");
      const dept2 = await createDepartment({ name: "财务部" });
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept1.id });
      await createEmployee({ employeeNo: "E002", name: "李四", departmentId: unwrap(dept2).id });

      const result = await getEmployees({ departmentId: dept1.id });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("张三");
    });

    it("可以按关键词搜索（工号或姓名）", async () => {
      const dept = await setupDept();
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept.id });
      await createEmployee({ employeeNo: "E002", name: "李四", departmentId: dept.id });

      const result = await getEmployees({ keyword: "张三" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("张三");
    });

    it("可以按关键词搜索工号", async () => {
      const dept = await setupDept();
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept.id });
      await createEmployee({ employeeNo: "E002", name: "李四", departmentId: dept.id });

      const result = await getEmployees({ keyword: "E002" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].employeeNo).toBe("E002");
    });
  });

  describe("getEmployeeById", () => {
    it("可以根据 ID 获取员工详情", async () => {
      const dept = await setupDept();
      const created = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept.id,
      });

      const result = await getEmployeeById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("张三");
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getEmployeeById(99999);
      expect(result.success).toBe(false);
    });
  });

  describe("updateEmployee", () => {
    it("可以更新员工信息", async () => {
      const dept = await setupDept();
      const created = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept.id,
      });

      const result = await updateEmployee(unwrap(created).id, {
        name: "张三丰",
        phone: "13900139000",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("张三丰");
      expect(unwrap(result).phone).toBe("13900139000");
    });

    it("可以更换部门", async () => {
      const dept1 = await setupDept("技术部");
      const dept2 = await createDepartment({ name: "财务部" });
      const created = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept1.id,
      });

      const result = await updateEmployee(unwrap(created).id, {
        departmentId: unwrap(dept2).id,
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).departmentId).toBe(unwrap(dept2).id);
    });

    it("工号不能与其他员工重复", async () => {
      const dept = await setupDept();
      await createEmployee({ employeeNo: "E001", name: "张三", departmentId: dept.id });
      const target = await createEmployee({
        employeeNo: "E002",
        name: "李四",
        departmentId: dept.id,
      });

      const result = await updateEmployee(unwrap(target).id, { employeeNo: "E001" });
      expect(result.success).toBe(false);
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateEmployee(99999, { name: "测试" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteEmployee", () => {
    it("可以删除没有关联设备的员工", async () => {
      const dept = await setupDept();
      const created = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept.id,
      });

      const result = await deleteEmployee(unwrap(created).id);

      expect(result.success).toBe(true);
      const check = await prisma.employee.findUnique({ where: { id: unwrap(created).id } });
      expect(check).toBeNull();
    });

    it("有关联设备时不能删除", async () => {
      const dept = await setupDept();
      const emp = await createEmployee({
        employeeNo: "E001",
        name: "张三",
        departmentId: dept.id,
      });

      const cat = await prisma.assetCategory.create({ data: { name: "计算机", code: "DN" } });
      const template = await prisma.deviceTemplate.create({
        data: { name: "标准电脑", categoryId: cat.id },
      });
      await prisma.asset.create({
        data: {
          assetNo: "DN-0001",
          name: "测试设备",
          templateId: template.id,
          employeeId: unwrap(emp).id,
          status: "IN_USE",
        },
      });

      const result = await deleteEmployee(unwrap(emp).id);
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("有关联设备");
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteEmployee(99999);
      expect(result.success).toBe(false);
    });
  });
});
