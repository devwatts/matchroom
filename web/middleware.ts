import { NextRequest, NextResponse } from "next/server";

// One shared password for the whole app (HTTP basic auth). Reviewers get it with the submission.
export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return NextResponse.next();
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    const [, pw] = atob(h.slice(6)).split(":");
    if (pw === pass) return NextResponse.next();
  }
  return new NextResponse("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="matchroom"' } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
