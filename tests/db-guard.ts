/**
 * 测试库安全闸门
 *
 * 背景：tests/setup.ts 会在每个测试前「清空所有表」。
 * 一旦 DATABASE_URL 指向真实库，跑一次测试就等于清空生产数据。
 *
 * 规则：库名必须以 `-test` 或 `-dev` 结尾，且不在真实库黑名单里；
 * 否则直接抛错让整个测试运行失败（fail fast，宁可不跑也不能连错库）。
 */
const REAL_DB_NAMES = ["asset-manage", "zichuan", "asset_manage"];

export function getDbName(url: string = process.env.DATABASE_URL ?? ""): string {
  return (url.split("?")[0].split("/").pop() ?? "").trim();
}

export function assertSafeTestDb(): void {
  const url = process.env.DATABASE_URL ?? "";
  const name = getDbName(url);

  const looksSafe = /-(test|dev)$/.test(name);
  const isReal = REAL_DB_NAMES.includes(name);

  if (looksSafe && !isReal) return;

  throw new Error(
    [
      "",
      "  ✖ 已阻止测试运行（测试库安全闸门）",
      "",
      `  当前 DATABASE_URL 指向: ${name || "(未设置)"}`,
      "  测试会清空所有表，绝不允许连接真实库。",
      "",
      "  请改用：",
      "    npm run test          全量测试（自动指向 asset-manage-test）",
      "    npm run test:ui       仅 UI 组件测试（不连库）",
      "  若测试库还不存在： npm run db test:init",
      "",
    ].join("\n")
  );
}
