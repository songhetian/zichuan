import { describe, it, expect } from "vitest";
import { summarizeSelection } from "@/lib/asset-selection-summary";

const pc = (assetNo: string) => ({ assetNo, categoryName: "笔记本电脑" });
const monitor = (assetNo: string) => ({ assetNo, categoryName: "显示器" });

describe("summarizeSelection 选中设备摘要", () => {
  it("同分类多台：给出台数与分类名", () => {
    const s = summarizeSelection([pc("DN-0001"), pc("DN-0002"), pc("DN-0003")]);
    expect(s.count).toBe(3);
    expect(s.categoryText).toBe("笔记本电脑");
  });

  it("编号区间取自然序最小与最大（输入乱序也正确）", () => {
    const s = summarizeSelection([pc("DN-0010"), pc("DN-0002"), pc("DN-0100")]);
    expect(s.assetNoRange).toBe("DN-0002 ~ DN-0100");
  });

  it("自然序而非字典序：DN-0009 在 DN-0010 之前", () => {
    const s = summarizeSelection([pc("DN-0010"), pc("DN-0009")]);
    expect(s.assetNoRange).toBe("DN-0009 ~ DN-0010");
  });

  it("带随机后缀的编号不抛错", () => {
    const s = summarizeSelection([pc("DN-20261012-A7F3"), pc("DN-20261012-B1C9")]);
    expect(s.assetNoRange).toBe("DN-20261012-A7F3 ~ DN-20261012-B1C9");
  });

  it("单台：区间就是它自己的编号", () => {
    const s = summarizeSelection([pc("DN-0001")]);
    expect(s.count).toBe(1);
    expect(s.assetNoRange).toBe("DN-0001");
  });

  it("多分类：列出首个分类并给出种类数", () => {
    const s = summarizeSelection([pc("DN-0001"), monitor("XS-0001"), pc("DN-0002")]);
    expect(s.count).toBe(3);
    expect(s.categoryText).toBe("笔记本电脑 等 2 类");
  });

  it("空选：台数为 0 且区间为空串", () => {
    const s = summarizeSelection([]);
    expect(s.count).toBe(0);
    expect(s.categoryText).toBe("");
    expect(s.assetNoRange).toBe("");
  });
});
