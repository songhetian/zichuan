import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { ActionResult } from "./types";

const SESSION_COOKIE = "zichuan_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 小时
const SESSION_SECRET = process.env.SESSION_SECRET || "zichuan-secret-key-change-in-production";

let _testUser: SessionUser | null = null;

export function setTestUser(user: SessionUser | null): void {
  _testUser = user;
}

export interface SessionUser {
  id: number;
  username: string;
}

function sign(value: string): string {
  const signature = createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
  return `${value}.${signature}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const signature = signed.slice(idx + 1);
  const expected = createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
  try {
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function encodeToken(userId: number, username: string): string {
  const payload = JSON.stringify({
    u: userId,
    n: username,
    e: Date.now() + SESSION_MAX_AGE * 1000,
  });
  const base64 = Buffer.from(payload).toString("base64url");
  return sign(base64);
}

function decodeToken(token: string): SessionUser | null {
  const unsigned = unsign(token);
  if (!unsigned) return null;
  try {
    const payload = JSON.parse(Buffer.from(unsigned, "base64url").toString());
    if (payload.e && Date.now() > payload.e) {
      return null;
    }
    return {
      id: payload.u,
      username: payload.n,
    };
  } catch {
    return null;
  }
}

export async function createSession(userId: number, username: string): Promise<string> {
  const token = encodeToken(userId, username);
  try {
    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
  } catch {
    // 测试环境或无请求上下文时跳过 cookie 设置
  }
  return token;
}

export function verifySession(token: string): SessionUser | null {
  return decodeToken(token);
}

export function getCurrentUser(): SessionUser | null {
  if (_testUser) {
    return _testUser;
  }
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return verifySession(token);
  } catch {
    return null;
  }
}

export function requireAuth(): SessionUser {
  const user = getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export function withAuth<T>(fn: (user: SessionUser) => Promise<ActionResult<T>>): () => Promise<ActionResult<T>> {
  return async () => {
    try {
      const user = requireAuth();
      return fn(user);
    } catch (e) {
      if (e instanceof Error && e.message === "UNAUTHORIZED") {
        return { success: false, error: "请先登录" };
      }
      throw e;
    }
  };
}

export function requireAuthSafe<T>(fn: (user: SessionUser) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const user = requireAuth();
    return fn(user);
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return Promise.resolve({ success: false, error: "请先登录" });
    }
    throw e;
  }
}

export function destroySession() {
  try {
    cookies().delete(SESSION_COOKIE);
  } catch {
    // 测试环境或无请求上下文时跳过
  }
}

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
