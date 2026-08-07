import { cookies, headers } from "next/headers";
import { getIronSession, SessionOptions } from "iron-session";
import { prisma } from "./prisma";
import { ActionResult } from "./types";

const SESSION_COOKIE = "zichuan_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 小时

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
}

// ============================================================
// 测试注入 — 保留原有 API，确保 28 个测试文件无需修改
// ============================================================

let _testUser: SessionUser | null = null;

export function setTestUser(user: SessionUser | null): void {
  _testUser = user;
}

// ============================================================
// Session 核心操作
// ============================================================

async function getSession() {
  // 根据真实代理协议动态决定 secure，为将来上 HTTPS 兜底（当前局域网 HTTP 下为 false）
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";
  const opts: SessionOptions = {
    ...sessionOptions,
    cookieOptions: {
      ...sessionOptions.cookieOptions,
      secure: proto === "https",
    },
  };
  return getIronSession<SessionData>(cookies(), opts);
}

export async function createSession(
  userId: number,
  username: string
): Promise<void> {
  try {
    const session = await getSession();
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
    return { id: session.userId, username: session.username };
  } catch {
    return null;
  }
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
