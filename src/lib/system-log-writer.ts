/**
 * 系统日志写入工具。
 *
 * 日志属于旁路信息：写入失败绝不能影响主业务流程（否则「建了设备却提示失败」）。
 * 因此统一从这里写入，内部吞掉异常。
 */
import { prisma } from "./prisma";

export interface SystemLogInput {
  module: string;
  action: string;
  detail: string;
  operator: string;
}

export async function writeSystemLog(input: SystemLogInput): Promise<void> {
  try {
    await prisma.systemLog.create({ data: input });
  } catch {
    // 忽略：日志不是关键路径
  }
}