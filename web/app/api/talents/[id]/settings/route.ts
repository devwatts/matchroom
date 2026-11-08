import { sb, rescore } from "@/lib/db";
export const dynamic = "force-dynamic";

const LEVELS = ["internship", "entry", "associate", "mid-senior", "director", "executive"];
const arr = (v: unknown) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const [cur] = await sb<any[]>(`talent_settings?talent_id=eq.${id}`);
  if (!cur) return Response.json({ error: "Talent not found" }, { status: 404 });
  const w = b.weights || {};
  const weights = Object.fromEntries(["skills", "role", "seniority", "location", "company_type"].map(k => [k, Math.min(100, Math.max(0, Math.round(Number(w[k] ?? cur.weights[k]) || 0)))]));
  const skills = Array.isArray(b.skills) ? b.skills.filter((s: any) => s && s.name).map((s: any) => ({ name: String(s.name).trim(), source: ["work", "listed", "recruiter"].includes(s.source) ? s.source : "recruiter" })) : cur.skills;
  const next = {
    search_titles: b.search_titles ? arr(b.search_titles).slice(0, 6) : cur.search_titles,
    skills,
    excluded_companies: b.excluded_companies ? arr(b.excluded_companies) : cur.excluded_companies,
    excluded_industries: b.excluded_industries ? arr(b.excluded_industries) : cur.excluded_industries,
    excluded_title_words: b.excluded_title_words ? arr(b.excluded_title_words) : cur.excluded_title_words,
    needs_sponsorship: b.needs_sponsorship ?? cur.needs_sponsorship,
    level_override: b.level_override === "" ? null : (LEVELS.includes(b.level_override) ? b.level_override : cur.level_override),
    startup_preference: ["none", "seed_b", "a_d", "any"].includes(b.startup_preference) ? b.startup_preference : cur.startup_preference,
    min_score: Number.isFinite(Number(b.min_score)) ? Math.min(100, Math.max(0, Math.round(Number(b.min_score)))) : cur.min_score,
    weights, version: cur.version + 1, updated_at: new Date().toISOString(),
  };
  await sb(`talent_settings?talent_id=eq.${id}`, { method: "PATCH", body: JSON.stringify(next) });
  const r = await rescore(id, `Re-score after settings change (settings v${next.version})`);
  return Response.json(r);
}
