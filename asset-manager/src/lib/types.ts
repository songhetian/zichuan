/**
 * 统一 Server Action 返回类型
 * 所有 action 文件统一从此导出，消除 17 处重复定义
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };