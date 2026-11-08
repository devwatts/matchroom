// Signed session cookie: "<expiry>.<hmac>". Works in middleware (edge) and route handlers (node).
export const COOKIE = "mr_session";
const enc = new TextEncoder();
async function key() {
  return crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET || "dev-only-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
export async function sign(exp: number) { return `${exp}.${hex(await crypto.subtle.sign("HMAC", await key(), enc.encode(String(exp))))}`; }
export async function verify(token?: string | null) {
  if (!token) return false;
  const [exp] = token.split(".");
  if (!exp || Number(exp) < Date.now()) return false;
  const good = await sign(Number(exp));
  if (good.length !== token.length) return false;
  let diff = 0; for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
