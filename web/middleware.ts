import { NextRequest, NextResponse } from "next/server";
import { COOKIE, verify } from "@/lib/session";

// Everything except the login page needs a valid session cookie.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (await verify(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Please log in" }, { status: 401 });
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
