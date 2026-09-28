import { cookies, headers } from "next/headers";
import { getIronSession, SessionOptions } from "iron-session";
import { prisma } from "./prisma";
import { ActionResult } from "./types";

const SESSION_COOKIE = "zichuan_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 小时
// 「记住我」时延长会话保留，30 天（秒）
export const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * 根据是否勾选「记住我」计算会话 cookie 的有效时长（秒）。
 * 勾选 → 30 天；未勾选 → 常规 8 小时。
 */
export function resolveSessionMaxAge(remember: boolean): number {
  return remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;
}

// iron-session 要求密码至少 32 字符
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "zichuan-secret-key-change-in-production-min-32-chars!!";

const sessionOptions: SessionOptions = {
  password: SESSION_SECRET,
  cookieName: SESSION_COOKIE,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  },
};

export interface SessionData {
  userId?: number;
  username?: string;
}

export interface SessionUser {
  id: number;
  username: string;
  /** 首登强制改密标记（实时查库，不随会话缓存）：为 true 时服务端守卫强制跳转 /force-password */
  mustChangePassword?: boolean;
}

// ============================================================
// 测试注入 — 保留原有 API，确保 28 个测试文件无需修改
// ============================================================

export interface TestUser extends SessionUser {
  /** 测试注入的显式权限 key 集合；未提供时走真实 DB 判定 */
  permissions?: string[];
}

let _testUser: TestUser | null = null;

export function setTestUser(user: TestUser | null): void {
  _testUser = user;
}

/**
 * 测试注入的权限覆盖（供 hasPermission 使用）：
 * 当前测试注入用户与该 id 匹配且显式给了 permissions 时返回该集合（可为空数组=无权限），
 * 否则返回 undefined（走真实 DB 判定）。
 */
export function getTestPermissionOverride(userId: number): string[] | undefined {
  if (_testUser && _testUser.id === userId && _testUser.permissions !== undefined) {
    return _testUser.permissions;
  }
  return undefined;
}

// ============================================================
// Session 核心操作
// ============================================================

async function getSession(maxAge?: number) {
  // 根据真实代理协议动态决定 secure，为将来上 HTTPS 兜底（当前局域网 HTTP 下为 false）
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";
  const opts: SessionOptions = {
    ...sessionOptions,
    cookieOptions: {
      ...sessionOptions.cookieOptions,
      secure: proto === "https",
      // 按「记住我」覆盖会话 cookie 有效期（未指定时沿用默认 8 小时）
      maxAge: maxAge ?? SESSION_MAX_AGE,
    },
  };
  return getIronSession<SessionData>(cookies(), opts);
}

export async function createSession(
  userId: number,
  username: string,
  remember = false
): Promise<void> {
  try {
    const session = await getSession(resolveSessionMaxAge(remember));
    session.userId = userId;
    session.username = username;
    await session.save();
  } catch {
    // 测试环境或无请求上下文时静默跳过
  }
}

export async function destroySession(): Promise<void> {
  try {
    const session = await getSession();
    session.destroy();
  } catch {
    // 测试环境或无请求上下文时静默跳过
  }
}

// ============================================================
// 用户获取 & 认证守卫
// ============================================================

export async function getCurrentUser(): Promise<SessionUser | null> {
  if (_testUser) {
    return _testUser;
  }
  try {
    const session = await getSession();
    if (!session.userId || !session.username) return null;
    // 滑动过期：在可写上下文（Server Action / Route Handler）里刷新 Max-Age，
    // 让活跃用户不会在固定 8h 后被踢。只读上下文（如布局服务端渲染）调用 save 会抛错，静默跳过。
    try {
      await session.save();
    } catch {
      // 只读上下文不可写 cookie，忽略
    }
    // 真实会话必须校验账号仍为启用状态（停用/离职后会话不再有效）
    const account = await loadActiveAccount(session.userId);
    return {
      id: session.userId,
      username: session.username,
      mustChangePassword: account.mustChangePassword,
    };
  } catch {
    return null;
  }
}

/**
 * 校验账号仍处于启用状态（isActive=true）。
 * 停用或账号不存在时抛 UNAUTHORIZED，用于在真实会话分支拒绝其继续操作。
 * 仅作用于真实会话；测试注入（_testUser）不经过此校验。
 */
export async function assertActiveAccount(userId: number): Promise<void> {
  await loadActiveAccount(userId);
}

/**
 * 载入启用中的账号并附带首登强制改密标记（供 getCurrentUser 复用，避免重复查库）。
 */
async function loadActiveAccount(
  userId: number
): Promise<{ mustChangePassword: boolean }> {
  const admin = await prisma.admin.findUnique({
    where: { id: userId },
    select: { isActive: true, mustChangePassword: true },
  });
  if (!admin || !admin.isActive) {
    throw new Error("UNAUTHORIZED");
  }
  return { mustChangePassword: admin.mustChangePassword };
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

// ============================================================
// 高阶包装器（保持原有 API）
// ============================================================

export function withAuth<T>(
  fn: (user: SessionUser) => Promise<ActionResult<T>>
): () => Promise<ActionResult<T>> {
  return async () => {
    try {
      const user = await requireAuth();
      return fn(user);
    } catch (e) {
      if (e instanceof Error && e.message === "UNAUTHORIZED") {
        return { success: false, error: "请先登录" };
      }
      throw e;
    }
  };
}

export async function requireAuthSafe<T>(
  fn: (user: SessionUser) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  try {
    const user = await requireAuth();
    return fn(user);
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return { success: false, error: "请先登录" };
    }
    throw e;
  }
}

// ============================================================
// 密码验证
// ============================================================

export async function validateCredentials(
  username: string,
  password: string
): Promise<{ id: number; username: string } | null> {
  const bcrypt = await import("bcryptjs");
  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin) return null;
  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return null;
  return { id: admin.id, username: admin.username };
}
