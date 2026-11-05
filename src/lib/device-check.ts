/**
 * 设备核对 —— 纯判定逻辑（无 IO，可单测）。
 *
 * 使用场景：现场工具（tools/device-check.ps1）在员工电脑上采集本机
 * 主机/显示器型号，经 /api/device-check 与台账比对，替代旧的
 * 「Excel 中转导入」流程。
 */

export type DeviceKind = "host" | "monitor";

export interface DeviceCheckInput {
  assetNo: string;
  kind: DeviceKind;
  /** 现场采集到的型号（显示器可能是多个，用 " | " 连接） */
  detectedModel?: string | null;
  detectedSerial?: string | null;
}

export interface DeviceCheckAsset {
  assetNo: string;
  category: string;
  brand: string | null;
  model: string | null;
  status: string;
  /** 当前使用人姓名（无则为 null） */
  holder: string | null;
}

export type CheckVerdict =
  | "MATCH" // 型号一致
  | "MISMATCH" // 型号不一致
  | "NOT_FOUND" // 编号未登记
  | "DB_NO_MODEL" // 台账未填型号，无法比对
  | "NO_DETECT" // 现场未采集到型号
  | "KIND_MISMATCH"; // 编号存在但分类与填写类型不符

export interface DeviceCheckResult {
  assetNo: string;
  kind: DeviceKind;
  verdict: CheckVerdict;
  dbCategory: string | null;
  dbBrand: string | null;
  dbModel: string | null;
  dbStatus: string | null;
  dbHolder: string | null;
  detectedModel: string | null;
  /** 一句话结论（中文，供工具直接展示） */
  message: string;
}

const KIND_LABEL: Record<DeviceKind, string> = { host: "主机", monitor: "显示器" };

/** 归一化型号：小写、去空白/连字符/括号/引号 */
export function normalizeModel(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\s\-_（）()"''“”]+/g, "");
}

/**
 * 型号模糊一致：归一化后相等，或一方包含另一方。
 * 覆盖「台账 OptiPlex 7090 vs 现场 DELL OptiPlex 7090」这类品牌前缀差异；
 * 显示器传多个检测型号时以 " | " 连接，包含判定天然支持任一命中。
 */
export function modelMatches(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeModel(a);
  const nb = normalizeModel(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** 台账分类是否明确是显示器 */
function isMonitorCategory(category: string): boolean {
  return category.includes("显示器") || /monitor/i.test(category);
}

/** 判定单项核对结果（asset 为 null 表示编号未登记） */
export function judgeDevice(
  input: DeviceCheckInput,
  asset: DeviceCheckAsset | null
): DeviceCheckResult {
  const kind = input.kind === "monitor" ? "monitor" : "host";
  const label = KIND_LABEL[kind];
  const assetNo = String(input.assetNo ?? "").trim();
  const base: DeviceCheckResult = {
    assetNo,
    kind,
    verdict: "NOT_FOUND",
    dbCategory: asset?.category ?? null,
    dbBrand: asset?.brand ?? null,
    dbModel: asset?.model ?? null,
    dbStatus: asset?.status ?? null,
    dbHolder: asset?.holder ?? null,
    detectedModel: input.detectedModel?.trim() || null,
    message: "",
  };

  if (!asset) {
    return { ...base, message: `编号 ${assetNo} 未在台账登记` };
  }

  // 分类口径：仅对「显示器 vs 非显示器」做强制校验，避免误填错位
  if (kind === "monitor" && !isMonitorCategory(asset.category)) {
    return {
      ...base,
      verdict: "KIND_MISMATCH",
      message: `该编号在台账里是「${asset.category}」，不是显示器`,
    };
  }
  if (kind === "host" && isMonitorCategory(asset.category)) {
    return {
      ...base,
      verdict: "KIND_MISMATCH",
      message: `该编号在台账里是「显示器」，不能填作主机`,
    };
  }

  if (!base.detectedModel) {
    return { ...base, verdict: "NO_DETECT", message: "本机未采集到型号，无法比对" };
  }
  if (!asset.model) {
    return {
      ...base,
      verdict: "DB_NO_MODEL",
      message: "台账未填型号，请补录后再核对",
    };
  }

  if (modelMatches(asset.model, base.detectedModel)) {
    return { ...base, verdict: "MATCH", message: `型号一致（${asset.model}）` };
  }
  return {
    ...base,
    verdict: "MISMATCH",
    message: `型号不一致：台账 ${asset.model}，现场 ${base.detectedModel}`,
  };
}
