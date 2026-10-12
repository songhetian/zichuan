import { describe, it, expect } from "vitest";
import { findEmployeeMatch } from "@/lib/employee-search";

// ============================================================
// 员工搜索匹配：姓名 / 工号 / 名下设备编码
//
// 口径（与员工列表「在用设备数」列一致）：
//   - 设备编码取自 Asset.assetNo，范围 = 该员工名下的全部设备（asset.employeeId = 员工 id）
//   - 大小写不敏感的子串匹配；空关键词视为「不过滤」（用于列表缺省态）
//   - 命中优先级：姓名 → 工号 → 设备编码，只回传第一条命中的来源
// ============================================================

// 独立字面量：期望值来自「一台设备编码为 DN-0012、一台为 XS-0007」这一设定，不由被测代码推导
const 张三 = { name: "张三", employeeNo: "EMP0001", assetNos: ["DN-0012", "XS-0007"] };

describe("findEmployeeMatch：按设备编码搜索员工", () => {
  it("按名下设备的资产编码命中，并回传命中的那一台", () => {
    expect(findEmployeeMatch(张三, "DN-0012")).toEqual({ by: "asset", assetNo: "DN-0012" });
  });

  it("有多台设备时，回传的是被搜中的那一台（而非第一台）", () => {
    const 李四 = { name: "李四", employeeNo: "EMP0002", assetNos: ["XS-0007", "DN-0012"] };
    expect(findEmployeeMatch(李四, "DN-0012")).toEqual({ by: "asset", assetNo: "DN-0012" });
  });

  it("设备编码按子串、大小写不敏感匹配", () => {
    expect(findEmployeeMatch(张三, "dn-00")).toEqual({ by: "asset", assetNo: "DN-0012" });
  });

  it("无设备或设备编码对不上时不命中", () => {
    expect(findEmployeeMatch(张三, "ZZ-9999")).toBeNull();
    expect(findEmployeeMatch({ name: "王五", employeeNo: "EMP0003" }, "DN-0012")).toBeNull();
  });
});

describe("findEmployeeMatch：姓名 / 工号仍可搜索（回归）", () => {
  it("按姓名命中", () => {
    expect(findEmployeeMatch(张三, "张三")).toEqual({ by: "name" });
  });

  it("按工号命中（大小写不敏感）", () => {
    expect(findEmployeeMatch(张三, "emp0001")).toEqual({ by: "employeeNo" });
  });

  it("关键词为空 / 纯空白时视为不过滤（列表缺省态全部显示）", () => {
    expect(findEmployeeMatch(张三, "")).toEqual({ by: "name" });
    expect(findEmployeeMatch(张三, "   ")).toEqual({ by: "name" });
  });

  it("同时能对上姓名与设备编码时，报姓名（不误标「匹配设备」）", () => {
    const 同码员工 = { name: "DN-0012", employeeNo: "EMP0009", assetNos: ["DN-0012"] };
    expect(findEmployeeMatch(同码员工, "DN-0012")).toEqual({ by: "name" });
  });
});
