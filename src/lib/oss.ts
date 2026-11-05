import crypto from "crypto";

/**
 * 阿里云 OSS 极简客户端（REST + Header 签名，不引入 SDK 依赖）。
 *
 * 设计要点：
 * - 逐对象私有 ACL（上传时带 x-oss-object-acl: private），不依赖 bucket 全局 ACL；
 *   展示走带过期时间的签名 URL（默认 1 小时）。
 * - 未配置 OSS_* 环境变量时 ossConfigured() 为 false，照片功能整体降级
 *   （前端显示类型默认图），系统其余功能不受影响。
 * - 仅支持本系统需要的三种操作：PUT / DELETE / 签名 GET URL。
 */

const endpoint = process.env.OSS_ENDPOINT?.replace(/\/+$/, "") ?? "";
const bucket = process.env.OSS_BUCKET ?? "";
const accessKeyId = process.env.OSS_ACCESS_KEY_ID ?? "";
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET ?? "";

/** 对象统一挂在该前缀下（默认 asset-manage，与 OSS 上其他系统目录隔离） */
export const OSS_DIR = process.env.OSS_DIR || "asset-manage";

/** 照片展示签名 URL 有效期（秒） */
const SIGNED_URL_TTL = 60 * 60;

export function ossConfigured(): boolean {
  return Boolean(endpoint && bucket && accessKeyId && accessKeySecret);
}

/** 资产照片的对象 key：{dir}/assets/{assetNo}/{ts}-{rand}.{ext}（随机后缀防猜测） */
export function ossAssetKey(assetNo: string, ext: string): string {
  const rand = crypto.randomBytes(6).toString("hex");
  return `${OSS_DIR}/assets/${assetNo}/${Date.now()}-${rand}.${ext}`;
}

function hmacSha1(data: string): string {
  return crypto.createHmac("sha1", accessKeySecret).update(data).digest("base64");
}

/** CanonicalizedOSSHeaders：x-oss-* 头按序拼接（小写 key + 值，各带 \n） */
function canonicalOssHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-oss-"))
    .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}\n`)
    .sort((a, b) => a.localeCompare(b))
    .join("");
}

async function ossFetch(
  method: "PUT" | "DELETE",
  key: string,
  opts: { contentType?: string; body?: ArrayBuffer; extraOss?: Record<string, string> } = {}
): Promise<void> {
  const date = new Date().toUTCString();
  const extra = opts.extraOss ?? {};
  const sig = hmacSha1(
    `${method}\n\n${opts.contentType ?? ""}\n${date}\n${canonicalOssHeaders(extra)}/${bucket}/${key}`
  );
  const res = await fetch(`${endpoint}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`, {
    method,
    headers: {
      Date: date,
      Authorization: `OSS ${accessKeyId}:${sig}`,
      ...(opts.contentType ? { "Content-Type": opts.contentType } : {}),
      ...extra,
    },
    body: opts.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OSS ${method} 失败（${res.status}）：${text.slice(0, 200)}`);
  }
}

/** 上传对象（私有 ACL） */
export async function putOssObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ossFetch("PUT", key, { contentType, body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, extraOss: { "x-oss-object-acl": "private" } });
}

/** 删除对象（失败不抛出——对象可能已不存在，DB 状态为准） */
export async function deleteOssObject(key: string): Promise<void> {
  try {
    await ossFetch("DELETE", key);
  } catch (e) {
    console.error("[oss] 删除对象失败（忽略）", key, e);
  }
}

/** 生成带过期时间的签名 GET URL（前端 <img> 直接可用） */
export function getOssSignedUrl(key: string, expiresSec = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL): string {
  const sig = encodeURIComponent(
    hmacSha1(`GET\n\n\n${expiresSec}\n/${bucket}/${key}`)
  );
  const path = key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${endpoint}/${path}?OSSAccessKeyId=${accessKeyId}&Expires=${expiresSec}&Signature=${sig}`;
}

/** 把 Asset.photos（Prisma Json）安全规范化为 key 字符串数组 */
export function normalizePhotoKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.length > 0);
}
