import { describe, it, expect } from "vitest";
import { generateEmployeeNo } from "@/lib/employee-no";

describe("generateEmployeeNo 工号自动生成", () => {
  it("无现有工号时生成 EMP0001", () => {
    expect(generateEmployeeNo([])).toBe("EMP0001");
  });

  it("按现有最大序号 +1 生成", () => {
    expect(generateEmployeeNo(["EMP0001", "EMP0002"])).toBe("EMP0003");
    expect(generateEmployeeNo(["EMP0002", "EMP0005"])).toBe("EMP0006");
  });

  it("忽略非 EMP 前缀的工号，不计入序号", () => {
    expect(generateEmployeeNo(["TEST-001", "XYZ"])).toBe("EMP0001");
  });

  it("序号超过 9999 时正常进位", () => {
    expect(generateEmployeeNo(["EMP9999"])).toBe("EMP10000");
  });
});
