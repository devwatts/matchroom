import { COOKIE, sign } from "@/lib/session";
export const dynamic = "force-dynamic";
const WEEK = 7 * 86400000;
export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({}));
  const want = process.env.APP_PASSWORD || "";
  const ok = typeof password === "string" && want.length > 0 && password.length === want.length
    && [...want].reduce((d, c, i) => d | (c.charCodeAt(0) ^ password.charCodeAt(i)), 0) === 0;
  if (!ok) { await new Promise(r => setTimeout(r, 800)); return Response.json({ error: "That password isn't right." }, { status: 401 }); }
  const exp = Date.now() + WEEK;
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${COOKIE}=${await sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return res;
}
