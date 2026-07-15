import { ActionResult } from "@/lib/types";

/**
 * 解包 ActionResult，失败时抛出错误。
 * 用于测试中断言返回值为成功的情况，消除 TypeScript 联合类型访问错误。
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * 断言 ActionResult 失败并返回错误信息。
 */
export function unwrapError<T>(result: ActionResult<T>): string {
  if (result.success) {
    throw new Error("期望操作失败，但实际成功");
  }
  return result.error;
}
