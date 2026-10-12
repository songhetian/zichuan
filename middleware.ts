import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/auth";

const SESSION_COOKIE = "zichuan_session";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "zichuan-secret-key-change-in-production-min-32-chars!!";

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
