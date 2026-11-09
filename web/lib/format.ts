export const LEVEL_LABEL: Record<string, string> = { internship: "intern", entry: "entry", associate: "associate", "mid-senior": "mid-senior", director: "director", executive: "executive" };
export const fam = (s?: string | null) => (s || "").replace(/_/g, " ");
export function ago(iso?: string | null) {
  if (!iso) return "–";
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 && d.toDateString() === new Date().toDateString()) return `Today ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}
export const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }) : "";
export const initials = (name?: string | null) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
const AV = ["var(--cyan)", "var(--yellow)", "var(--violet)", "var(--green)", "var(--pink)"];
export const avatarColor = (id: string) => AV[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
export const code = (prefix: string, n: number) => `${prefix}x${String(n).padStart(3, "0")}`;
// 13 -> "13", 13.83 -> "13.8"
export const yrs = (y: number | string | null | undefined) => y == null ? "" : String(Math.round(Number(y) * 10) / 10);
