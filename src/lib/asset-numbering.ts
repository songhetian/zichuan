import type { Prisma } from "@prisma/client";

/**
 * 在事务内生成设备编号，支持模板语法：
 *   {prefix} — 分类编码
 *   {YYYY}   — 四位年份
 *   {MM}     — 两位月份
 *   {DD}     — 两位日期
 *   {####}   — 自增序号，# 的个数决定位数
 *   {R4}     — 4 位随机字符（大写字母+数字，排除 0/O/1/I/L），数字可改
 * 默认模板：{prefix}-{####}
 *
 * 必须在 Prisma 事务内调用以保证并发安全。
 * 随机字符模式会查重并重试，避免冲突。
 */
export async function generateAssetNo(
  tx: Prisma.TransactionClient,
  prefix: string,
  numberingRule?: string | null
): Promise<string> {
  const template = numberingRule || "{prefix}-{####}";

  const now = new Date();
  const replacements: Record<string, string> = {
    "{prefix}": prefix,
    "{YYYY}": now.getFullYear().toString(),
    "{MM}": String(now.getMonth() + 1).padStart(2, "0"),
    "{DD}": String(now.getDate()).padStart(2, "0"),
  };

  // 先替换日期和前缀占位符
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }

  // 处理随机字符占位符 {R4}, {R6} 等（带查重重试）
  const randomMatch = result.match(/\{R(\d+)\}/);
  if (randomMatch) {
    const randomLen = parseInt(randomMatch[1], 10);
    // 排除易混淆字符：0/O/1/I/L
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const maxAttempts = 10;
    let random = "";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      random = "";
      for (let i = 0; i < randomLen; i++) {
        random += chars[Math.floor(Math.random() * chars.length)];
      }
      const candidate = result.replace(randomMatch[0], random);
      const exists = await tx.asset.findUnique({ where: { assetNo: candidate }, select: { id: true } });
      if (!exists) {
        result = candidate;
        return result;
      }
    }
    // 重试失败（极小概率），直接用最后一次生成的
    result = result.replace(randomMatch[0], random);
    return result;
  }

  // 处理自增序号占位符 {####}（支持任意位数）
  const seqMatch = result.match(/\{(#+)\}/);
  if (seqMatch) {
    const seqDigits = seqMatch[1].length;
    const seqPlaceholder = seqMatch[0];
    const prefixBeforeSeq = result.split(seqPlaceholder)[0];

    // 查找同前缀下的最大序号
    const lastAsset = await tx.asset.findFirst({
      where: { assetNo: { startsWith: prefixBeforeSeq } },
      orderBy: { assetNo: "desc" },
      select: { assetNo: true },
    });

    let nextNum = 1;
    if (lastAsset) {
      const escapedPrefix = prefixBeforeSeq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`^${escapedPrefix}(\\d+)$`);
      const match = lastAsset.assetNo.match(regex);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }

    const seq = String(nextNum).padStart(seqDigits, "0");
    return result.replace(seqPlaceholder, seq);
  }

  // 无序号也无随机字符，直接返回替换后的结果
  return result;
}