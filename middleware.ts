import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "zichuan_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "zichuan-secret-key-change-in-production";

async function verifySessionToken(token: string): Promise<boolean> {
  const idx = token.lastIndexOf(".");
  if (idx === -1) return false;

  const value = token.slice(0, idx);
  const signature = token.slice(idx + 1);

  const encoder = new TextEncoder();
  const keyData = encoder.encode(SESSION_SECRET);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureBuffer = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const dataBuffer = encoder.encode(value);

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBuffer,
    dataBuffer
  );

  if (!valid) return false;

  try {
    const payload = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.e && Date.now() > payload.e) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const valid = await verifySessionToken(token);
  if (!valid) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
