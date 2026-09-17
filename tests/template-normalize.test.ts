import { describe, it, expect } from "vitest";
import {
  BOM_SUFFIX_SEPARATOR,
  bomFingerprint,
  cpuBaseName,
  extractBrandFromName,
  isComputerHostTemplate,
} from "../src/lib/template-normalize";

describe("cpuBaseName", () => {
  it("从完整规格名拆出 CPU 档(去掉内存/硬盘)", () => {
    expect(cpuBaseName("电脑主机 (i5-6400 / 16GB / 238GB / SSD)")).toBe("电脑主机 (i5-6400)");
    expect(cpuBaseName("电脑主机 (i5-6400 / 24GB / 357GB / HDD)")).toBe("电脑主机 (i5-6400)");
  });

  it("只含 CPU+硬盘时也只保留 CPU", () => {
    expect(cpuBaseName("电脑主机 (i3-12100 / 1.4TB)")).toBe("电脑主机 (i3-12100)");
  });

  it("未知CPU 也保留为一组", () => {
    expect(cpuBaseName("电脑主机 (未知CPU / 476GB / SSD)")).toBe("电脑主机 (未知CPU)");
  });

  it("无括号的裸名不变", () => {
    expect(cpuBaseName("电脑主机")).toBe("电脑主机");
  });

  it("非电脑主机模板原样返回", () => {
    expect(cpuBaseName("显示器 27寸")).toBe("显示器 27寸");
    expect(cpuBaseName("笔记本电脑 (i7)")).toBe("笔记本电脑 (i7)");
  });
});

describe("isComputerHostTemplate", () => {
  it("仅匹配电脑主机", () => {
    expect(isComputerHostTemplate("电脑主机 (i5-9500 / 16GB / 238GB / SSD)")).toBe(true);
    expect(isComputerHostTemplate("电脑主机")).toBe(true);
    expect(isComputerHostTemplate("显示器 27寸")).toBe(false);
  });
});

describe("extractBrandFromName", () => {
  it("拆出规格与品牌后缀", () => {
    expect(extractBrandFromName("465GB HDD (Colorful)")).toEqual({ spec: "465GB HDD", brand: "Colorful" });
    expect(extractBrandFromName("238GB SSD (Dahua)")).toEqual({ spec: "238GB SSD", brand: "Dahua" });
  });

  it("无品牌后缀返回 null", () => {
    expect(extractBrandFromName("16GB")).toBeNull();
    expect(extractBrandFromName("238GB SSD")).toBeNull();
  });
});

describe("bomFingerprint", () => {
  const bomA = [
    { modelId: 1, quantity: 1 },
    { modelId: 7, quantity: 2 },
  ];

  it("同一套配置输出稳定的短码（重复导入必须收敛到同一模板，不能每次新建）", () => {
    expect(bomFingerprint(bomA)).toBe(bomFingerprint([...bomA]));
    expect(bomFingerprint(bomA)).toMatch(/^[0-9A-Z]{5}$/);
  });

  it("与配件顺序无关", () => {
    expect(bomFingerprint([...bomA].reverse())).toBe(bomFingerprint(bomA));
  });

  it("数量不同 → 短码不同", () => {
    expect(
      bomFingerprint([
        { modelId: 1, quantity: 1 },
        { modelId: 7, quantity: 3 },
      ])
    ).not.toBe(bomFingerprint(bomA));
  });

  it("型号不同 → 短码不同", () => {
    expect(
      bomFingerprint([
        { modelId: 8, quantity: 1 },
        { modelId: 7, quantity: 2 },
      ])
    ).not.toBe(bomFingerprint(bomA));
  });

  it("salt 用于避让：同配置不同 salt 得到不同短码", () => {
    expect(bomFingerprint(bomA, "2")).not.toBe(bomFingerprint(bomA));
  });

  it("空 BOM 也能给出短码（不抛异常）", () => {
    expect(bomFingerprint([])).toMatch(/^[0-9A-Z]{5}$/);
  });

  it("后缀分隔符不会触发 DeviceTemplate 的 (n) 去重正则", () => {
    const name = `电脑主机 (i5-9500)${BOM_SUFFIX_SEPARATOR}${bomFingerprint(bomA)}`;
    expect(/(\s\(\d+\))$/.test(name)).toBe(false);
  });
});
