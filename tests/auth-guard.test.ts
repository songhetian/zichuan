import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { requireAuth, requireAuthSafe, setTestUser } from "@/lib/auth";
import { middleware } from "../middleware";

// 与 middleware.ts / lib/auth.ts 完全同一口径（含兜底常量），保证密封/解封用同一密钥
const FALLBACK_SECRET = "zichuan-secret-key-change-in-production-min-32-chars!!";

async function sealedCookie(payload: Record<string, unknown>): Promise<string> {
  const sealed = await sealData(payload, {
    password: process.env.SESSION_SECRET || FALLBACK_SECRET,
    ttl: 60 * 60,
  });
  return `zichuan_session=${sealed}`;
}

/** 捕获被抛出的「导航信号」（NEXT_REDIRECT）或普通错误 */
async function captureError(fn: () => Promise<unknown> | unknown): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe("requireAuth：会话失效必须走「重定向登录」，不得抛 UNAUTHORIZED", () => {
  beforeEach(() => setTestUser(null));
  afterEach(() => setTestUser(null));

  it("无会话时抛出 NEXT_REDIRECT 到 /login（而不是 UNAUTHORIZED 整页报错）", async () => {
    const err = await captureError(() => requireAuth());

    expect(err).toBeTruthy();
    // 关键：不能再是 UNAUTHORIZED —— 它在 RSC 渲染里会变成整页 Error + digest
    expect(err.message).not.toBe("UNAUTHORIZED");
    expect(String(err.digest ?? "")).toContain("NEXT_REDIRECT");
    expect(String(err.digest ?? "")).toContain("/login");
  });

  it("有会话时正常返回当前用户，不发生重定向", async () => {
    setTestUser({ id: 7, username: "admin" });

    await expect(requireAuth()).resolves.toMatchObject({ id: 7, username: "admin" });
  });
});

describe("requireAuthSafe：保留「请先登录」返回契约（不重定向）", () => {
  beforeEach(() => setTestUser(null));
  afterEach(() => setTestUser(null));

  it("无会话时返回 { success:false, error:'请先登录' }", async () => {
    const result = await requireAuthSafe(async () => ({
      success: true as const,
      data: "never",
    }));

    expect(result).toEqual({ success: false, error: "请先登录" });
  });

  it("有会话时正常执行回调", async () => {
    setTestUser({ id: 1, username: "admin" });

    const result = await requireAuthSafe(async (user) => ({
      success: true as const,
      data: user.id,
    }));

    expect(result).toEqual({ success: true, data: 1 });
  });
});

describe("middleware：与 getCurrentUser 同一口径（userId 与 username 都要有）", () => {
  const call = (cookie?: string) =>
    middleware(
      new NextRequest("http://localhost:3000/assets", {
        headers: cookie ? { cookie } : {},
      })
    );

  it("没有 cookie → 重定向 /login", async () => {
    const res = await call();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("只有 userId、没有 username 的会话 → 重定向 /login（不留到页面里再炸）", async () => {
    const res = await call(await sealedCookie({ userId: 1 }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("userId 与 username 齐全 → 放行", async () => {
    const res = await call(await sealedCookie({ userId: 1, username: "admin" }));

    expect(res.status).toBe(200);
  });

  it("/login 属公开路由，不拦截", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/login"));

    expect(res.status).toBe(200);
  });
});
