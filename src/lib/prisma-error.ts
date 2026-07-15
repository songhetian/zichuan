/**
 * Prisma 错误处理公共工具
 * 统一处理 P2002（唯一约束冲突）等常见 Prisma 错误，
 * 消除各 action 文件中重复的 as any 类型断言
 */

import { ActionResult } from "./types";

// Prisma 已知错误码
export const PRISMA_ERROR_CODES = {
  UNIQUE_CONSTRAINT: "P2002",
  RECORD_NOT_FOUND: "P2025",
  FOREIGN_KEY_CONSTRAINT: "P2003",
} as const;

/**
 * 判断错误是否为 Prisma 的唯一约束冲突（P2002）
 * 如果是，返回冲突的字段名列表
 */
function getUniqueViolationFields(error: unknown): string[] | null {
  if (!(error instanceof Error)) return null;
  // Prisma 错误对象结构（避免 as any）
  const code = (error as { code?: string }).code;
  if (code !== PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT) return null;
  const meta = (error as { meta?: { target?: string[] } }).meta;
  return meta?.target ?? null;
}

/**
 * 处理 Prisma 唯一约束冲突
 *
 * @param error - catch 块捕获的错误
 * @param fieldMessages - 字段到错误消息的映射，如 { name: "分类名称已存在", code: "分类编码已存在" }
 * @param fallbackError - 非唯一约束冲突时的兜底错误消息
 * @returns 统一的 ActionResult
 */
export function handleUniqueViolation<T>(
  error: unknown,
  fieldMessages: Record<string, string>,
  fallbackError: string
): ActionResult<T> {
  const fields = getUniqueViolationFields(error);
  if (fields) {
    for (const field of fields) {
      if (field in fieldMessages) {
        return { success: false, error: fieldMessages[field] };
      }
    }
    // 有 P2002 但字段未在映射中，返回通用消息
    return { success: false, error: "数据已存在，请检查唯一字段" };
  }
  return { success: false, error: fallbackError };
}
