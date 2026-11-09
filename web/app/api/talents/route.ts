import { sb, triggerOnboarding } from "@/lib/db";
export const dynamic = "force-dynamic";

const WINDOWS = ["24h", "week", "month", "any"], STAGES = ["none", "seed_b", "a_d", "any"];

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const url = String(b.linkedin_url || "").trim().replace(/\/+$/, "").replace(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com/i, "https://www.linkedin.com");
  if (!/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+$/i.test(url))
    return Response.json({ error: "That doesn't look like a LinkedIn profile link. It should look like linkedin.com/in/name." }, { status: 400 });
  const days = Math.min(90, Math.max(1, Number(b.match_days) || 14));
  const existing = await sb<any[]>(`talents?linkedin_url=eq.${encodeURIComponent(url)}&select=id`);
  if (existing.length) return Response.json({ error: "This talent is already on the roster.", id: existing[0].id }, { status: 409 });
  const [t] = await sb<any[]>("talents", { method: "POST", prefer: "return=representation", body: JSON.stringify({ linkedin_url: url, match_days: days }) });
  let base: Record<string, unknown> = {};
  if (b.template_id) {
    const [tpl] = await sb<any[]>(`role_templates?id=eq.${b.template_id}&select=settings`);
    if (tpl) base = tpl.settings;
  }
  const settings = {
    ...base, talent_id: t.id,
    first_search_window: WINDOWS.includes(b.first_search_window) ? b.first_search_window : "week",
    startup_preference: STAGES.includes(b.startup_preference) ? b.startup_preference : (base.startup_preference ?? "none"),
    min_score: Number.isFinite(Number(b.min_score)) ? Math.min(100, Math.max(0, Number(b.min_score))) : (base.min_score ?? 75),
    needs_sponsorship: Boolean(b.needs_sponsorship),
    excluded_companies: String(b.excluded_companies || "").split(",").map(s => s.trim()).filter(Boolean),
  };
  delete (settings as any).search_titles; delete (settings as any).skills;   // always from this talent's profile
  await sb("talent_settings", { method: "POST", body: JSON.stringify(settings) });
  try { await triggerOnboarding(t.id); }
  catch (e: any) { await sb(`talents?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed" }) }); return Response.json({ error: e.message, id: t.id }, { status: 502 }); }
  return Response.json({ id: t.id });
}
