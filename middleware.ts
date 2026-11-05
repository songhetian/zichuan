import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/auth";

const SESSION_COOKIE = "zichuan_session";
// 🔒 生产 fail-fast（与 lib/auth.ts 同口径）：SESSION_SECRET 缺失时宁可中间件全挂
// 也不能用随仓库公开的兜底密钥签会话——否则登录态可被伪造。
const DEV_FALLBACK_SECRET = "zichuan-secret-key-change-in-production-min-32-chars!!";
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error(
    "[启动校验] 生产环境必须设置 SESSION_SECRET（≥32 字符，勿用示例值）"
  );
}
const SESSION_SECRET = process.env.SESSION_SECRET || DEV_FALLBACK_SECRET;

const sessionOptions = {
  password: SESSION_SECRET,
  cookieName: SESSION_COOKIE,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
  },
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路由 — 无需认证
  if (
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  try {
    const res = NextResponse.next();
    const session = await getIronSession<SessionData>(
      request,
      res,
      sessionOptions
    );

    // 口径必须与 lib/auth.ts 的 getCurrentUser 一致：**两个字段都要有**。
    // 只查 userId 会漏掉「会话不完整」的 cookie —— 中间件放行、页面渲染时才炸。
    if (!session.userId || !session.username) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // 返回带 cookie 的 res，确保 session 持久化
    return res;
  } catch {
    // 解密失败 → 重定向登录
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
