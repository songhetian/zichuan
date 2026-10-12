import { describe, it, expect } from "vitest";
import { findEmployeesByAssetCode } from "@/lib/employee-asset-search";

/** 只带搜索所需字段的最小员工样本（真实调用里还会带工号/部门等） */
function emp(id: number, name: string, assetNos: string[]) {
  return { id, name, assetNos };
}

describe("findEmployeesByAssetCode", () => {
  it("按完整设备编码找到使用该设备的员工", () => {
    const 张三 = emp(1, "张三", ["DT-7KF3WX"]);
    const 李四 = emp(2, "李四", []);

    expect(findEmployeesByAssetCode([张三, 李四], "DT-7KF3WX")).toEqual([
      { employee: 张三, matchedAssetNos: ["DT-7KF3WX"] },
    ]);
  });

  it("只记得后几位、或小写粘贴、或带首尾空格，也能找到", () => {
    const 张三 = emp(1, "张三", ["DT-7KF3WX"]);

    expect(findEmployeesByAssetCode([张三], "7kf3wx")).toHaveLength(1);
    expect(findEmployeesByAssetCode([张三], "  dt-7kf ")).toHaveLength(1);
  });

  it("没持有设备的员工不会被搜出来", () => {
    const 李四 = emp(2, "李四", []);
    const 王五 = emp(3, "王五", undefined as unknown as string[]);

    expect(findEmployeesByAssetCode([李四, 王五], "DT")).toEqual([]);
  });

  it("查询为空 / 只有空格时不当作过滤，返回全部员工且不标匹配", () => {
    const 张三 = emp(1, "张三", ["DT-7KF3WX"]);
    const 李四 = emp(2, "李四", []);

    expect(findEmployeesByAssetCode([张三, 李四], "")).toEqual([
      { employee: 张三, matchedAssetNos: [] },
      { employee: 李四, matchedAssetNos: [] },
    ]);
    expect(findEmployeesByAssetCode([张三, 李四], "   ")).toHaveLength(2);
  });

  it("一个员工有多台命中编码时全部列出，且保持原有顺序", () => {
    const 张三 = emp(1, "张三", ["DT-7KF3WX", "DN-0009", "DT-CWQX8W"]);

    expect(findEmployeesByAssetCode([张三], "DT")[0].matchedAssetNos).toEqual([
      "DT-7KF3WX",
      "DT-CWQX8W",
    ]);
  });
});
