/**
 * 测试库安全闸门
 *
 * 背景：tests/setup.ts 会在每个测试前「清空所有表」。
 * 一旦 DATABASE_URL 指向真实库或开发库，跑一次测试就等于清空那批数据。
 *
 * 规则：库名必须以 `-test` 结尾，否则直接抛错让整个测试运行失败
 * （fail fast，宁可不跑也不能连错库）。
 *
 * 注意：这里【只】放行 `-test`。开发库 asset-manage-dev 装的是从真实库灌进来的
 * 业务数据，曾被 /-(test|dev)$/ 误放行，属高危口子，已收紧。
 */
export function getDbName(url: string = process.env.DATABASE_URL ?? ""): string {
  return (url.split("?")[0].split("/").pop() ?? "").trim();
}

export function assertSafeTestDb(url: string = process.env.DATABASE_URL ?? ""): void {
  const name = getDbName(url);

  if (/-test$/.test(name)) return;

  throw new Error(
    [
      "",
      "  ✖ 已阻止测试运行（测试库安全闸门）",
      "",
      `  当前 DATABASE_URL 指向: ${name || "(未设置)"}`,
      "  测试会清空所有表，只允许连以 -test 结尾的测试库。",
      "  开发库（asset-manage-dev）与真实库（asset-manage）都在拦截范围内。",
      "",
      "  请改用：",
      "    npm run test          全量测试（自动指向 asset-manage-test）",
      "    npm run test:ui       仅 UI 组件测试（不连库）",
      "  若测试库还不存在： npm run db test:init",
      "",
    ].join("\n")
  );
}
