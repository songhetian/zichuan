import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createSystemLog, getSystemLogs } from "@/actions/system-log.actions";
import { prisma } from "@/lib/prisma";

describe("系统日志", () => {
  describe("createSystemLog", () => {
    it("可以记录系统日志", async () => {
      const result = await createSystemLog({
        module: "分配",
        action: "分配设备",
        detail: "DN-0001 分配给张三",
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).id).toBeDefined();

      // 验证数据
      const logs = await prisma.systemLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0].module).toBe("分配");
      expect(logs[0].action).toBe("分配设备");
      expect(logs[0].detail).toBe("DN-0001 分配给张三");
      expect(logs[0].operator).toBe("admin");
    });
  });

  describe("getSystemLogs", () => {
    it("可以获取全部日志（按时间倒序）", async () => {
      await createSystemLog({ module: "A", action: "操作1", detail: "", operator: "admin" });
      await createSystemLog({ module: "B", action: "操作2", detail: "", operator: "admin" });

      const result = await getSystemLogs();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
      expect(unwrap(result)[0].module).toBe("B"); // 最新的在前
      expect(unwrap(result)[1].module).toBe("A");
    });

    it("可以按模块筛选", async () => {
      await createSystemLog({ module: "分配", action: "分配", detail: "", operator: "admin" });
      await createSystemLog({ module: "归还", action: "归还", detail: "", operator: "admin" });
      await createSystemLog({ module: "分配", action: "再次分配", detail: "", operator: "admin" });

      const result = await getSystemLogs({ module: "分配" });

      expect(unwrap(result).length).toBe(2);
      expect(unwrap(result).every((l) => l.module === "分配")).toBe(true);
    });

    it("可以按操作员筛选", async () => {
      await createSystemLog({ module: "A", action: "操作", detail: "", operator: "admin" });
      await createSystemLog({ module: "A", action: "操作", detail: "", operator: "other" });

      const result = await getSystemLogs({ operator: "admin" });

      expect(unwrap(result).length).toBe(1);
    });

    it("可以按关键词搜索详情", async () => {
      await createSystemLog({ module: "分配", action: "分配", detail: "DN-0001 分配给张三", operator: "admin" });
      await createSystemLog({ module: "归还", action: "归还", detail: "DN-0002 归还", operator: "admin" });

      const result = await getSystemLogs({ keyword: "张三" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].detail).toContain("张三");
    });
  });
});
