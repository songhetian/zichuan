import { describe, it, expect } from "vitest";
import {
  stripTrailingDuplicateSuffix,
  templateDedupeKey,
  componentDedupeKey,
  groupTemplateDuplicates,
} from "@/lib/dedupe";

describe("stripTrailingDuplicateSuffix", () => {
  it("去掉末尾的 (n) 数字后缀", () => {
    expect(stripTrailingDuplicateSuffix("电脑主机 (i5-9500) (2)")).toBe("电脑主机 (i5-9500)");
    expect(stripTrailingDuplicateSuffix("电脑主机 (i5-6400 / 16GB / 238GB / HDD) (6)")).toBe(
      "电脑主机 (i5-6400 / 16GB / 238GB / HDD)",
    );
  });

  it("支持多位数字后缀 (10)", () => {
    expect(stripTrailingDuplicateSuffix("某型号 (10)")).toBe("某型号");
  });

  it("无后缀时原样返回", () => {
    expect(stripTrailingDuplicateSuffix("电脑主机 (i5-9500)")).toBe("电脑主机 (i5-9500)");
  });

  it("非纯数字括号不被误删（如 (SSD) / (i5-9500)）", () => {
    expect(stripTrailingDuplicateSuffix("电脑主机 (SSD)")).toBe("电脑主机 (SSD)");
    expect(stripTrailingDuplicateSuffix("电脑主机 (i5-9500)")).toBe("电脑主机 (i5-9500)");
  });

  it("保留规格差异（硬盘/显示器不同仍不同）", () => {
    const a = "电脑主机 (i5-6400 / 16GB / 238GB / HDD)";
    const b = "电脑主机 (i5-6400 / 16GB / 238GB / SSD)";
    expect(stripTrailingDuplicateSuffix(a)).toBe(a);
    expect(stripTrailingDuplicateSuffix(b)).toBe(b);
    expect(stripTrailingDuplicateSuffix(a)).not.toBe(stripTrailingDuplicateSuffix(b));
  });
});

describe("templateDedupeKey", () => {
  it("同规格不同 (n) 后缀 + 同分类 => 同一归并键", () => {
    const base = "电脑主机 (i5-9500 / 16GB / 238GB / SSD)";
    expect(templateDedupeKey(2, base)).toBe(templateDedupeKey(2, `${base} (2)`));
    expect(templateDedupeKey(2, base)).toBe(templateDedupeKey(2, `${base} (3)`));
  });

  it("不同分类视为不同键", () => {
    const name = "电脑主机 (i5-9500)";
    expect(templateDedupeKey(2, name)).not.toBe(templateDedupeKey(3, name));
  });
});

describe("componentDedupeKey", () => {
  it("同名不同伪品牌 => 同一归并键（忽略 brand）", () => {
    expect(componentDedupeKey("16GB DDR3200MHz", "0BF7")).toBe(
      componentDedupeKey("16GB DDR3200MHz", "Colorful Technology Ltd"),
    );
    expect(componentDedupeKey("8GB DDR2133MHz", "88BC")).toBe(
      componentDedupeKey("8GB DDR2133MHz", "89EC"),
    );
  });

  it("规格不同 => 不同键", () => {
    expect(componentDedupeKey("16GB DDR3200MHz", "x")).not.toBe(
      componentDedupeKey("8GB DDR2133MHz", "x"),
    );
  });

  it("归一化多余空白", () => {
    expect(componentDedupeKey("16GB   DDR3200MHz", "a")).toBe(componentDedupeKey("16GB DDR3200MHz", "b"));
  });

  it("品牌大小写不同视为同一（Kingston / KINGSTON）", () => {
    expect(componentDedupeKey("111GB HDD (Kingston)")).toBe(componentDedupeKey("111GB HDD (KINGSTON)"));
  });
});

describe("groupTemplateDuplicates", () => {
  it("把同规格的 base/(2)/(3) 归为一组，返回每组保留一个 canonical", () => {
    const rows = [
      { id: 1, categoryId: 2, name: "电脑主机 (i5-9500 / 16GB / 238GB / SSD)" },
      { id: 2, categoryId: 2, name: "电脑主机 (i5-9500 / 16GB / 238GB / SSD) (2)" },
      { id: 3, categoryId: 2, name: "电脑主机 (i5-9500 / 16GB / 238GB / SSD) (3)" },
      { id: 4, categoryId: 2, name: "电脑主机 (i5-6400 / 16GB / 238GB / HDD)" },
    ];
    const groups = groupTemplateDuplicates(rows);
    // 期望 2 组：一组含 id 1,2,3；另一组仅 id 4（无重复，不计入重复组）
    const dupGroup = groups.find((g) => g.key.includes("i5-9500"));
    expect(dupGroup).toBeDefined();
    expect(dupGroup!.ids.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(dupGroup!.canonicalId).toBe(1); // 无后缀的 base 优先
  });
});
