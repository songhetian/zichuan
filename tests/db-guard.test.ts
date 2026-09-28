import { describe, it, expect } from "vitest";
import { assertSafeTestDb } from "./db-guard";

const url = (db: string) => `mysql://root:root@localhost:3306/${db}`;

describe("测试库安全闸门", () => {
  it("放行测试库 asset-manage-test", () => {
    expect(() => assertSafeTestDb(url("asset-manage-test"))).not.toThrow();
  });

  it("拦截开发库 asset-manage-dev（开发库同样是真实数据，绝不能被测试清空）", () => {
    expect(() => assertSafeTestDb(url("asset-manage-dev"))).toThrow(/已阻止测试运行/);
  });

  it("拦截真实库 asset-manage", () => {
    expect(() => assertSafeTestDb(url("asset-manage"))).toThrow(/已阻止测试运行/);
  });

  it("未设置 DATABASE_URL 时拦截", () => {
    expect(() => assertSafeTestDb("")).toThrow(/已阻止测试运行/);
  });

  it("报错信息里带上被拦截的库名，便于定位", () => {
    expect(() => assertSafeTestDb(url("asset-manage-dev"))).toThrow(/asset-manage-dev/);
  });
});
