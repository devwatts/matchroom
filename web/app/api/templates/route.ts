import { sb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name || !b.talent_id) return Response.json({ error: "Give the template a name" }, { status: 400 });
  const [s] = await sb<any[]>(`talent_settings?talent_id=eq.${b.talent_id}`);
  const settings = { weights: s.weights, min_score: s.min_score, startup_preference: s.startup_preference, excluded_industries: s.excluded_industries,
                     excluded_title_words: s.excluded_title_words, level_override: s.level_override, first_search_window: s.first_search_window };
  await sb("role_templates?on_conflict=name", { method: "POST", prefer: "resolution=merge-duplicates", body: JSON.stringify({ name, settings }) });
  return Response.json({ ok: true });
}
