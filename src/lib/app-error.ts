/**
 * 业务错误基类：用稳定的 `code` 机器码做 catch 判定，替代字符串哨兵协议
 * （此前靠 `e.message === "STATUS_CONFLICT"` 等精确匹配，改文案即静默失效）。
 *
 * `message` 默认等于 code，兼容既有测试的 `rejects.toThrow("UNAUTHORIZED")` 断言。
 */
export class AppError extends Error {
  constructor(
    /** 稳定机器错误码：UNAUTHORIZED / STATUS_CONFLICT / UNIQUE_VIOLATION … */
    public readonly code: string,
    /** 面向日志的完整消息，默认为 code */
    message: string = code,
    /** 结构化附加数据（如 UNIQUE_VIOLATION 的分类名列表），供 catch 直接取用 */
    public readonly detail?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}
