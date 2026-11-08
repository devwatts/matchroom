import { sb, rescore } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const cid = String(b.company_linkedin_id || ""), verdict = b.verdict;
  if (!cid || !["agency", "direct_employer"].includes(verdict)) return Response.json({ error: "Missing company or verdict" }, { status: 400 });
  const [prev] = await sb<any[]>(`company_verdicts_current?company_linkedin_id=eq.${encodeURIComponent(cid)}`);
  await sb("company_verdicts", { method: "POST", body: JSON.stringify({ company_linkedin_id: cid, verdict,
    source: b.source === "confirmed_suggestion" ? "confirmed_suggestion" : "recruiter", previous_verdict: prev?.verdict ?? null,
    reason: b.reason || null, decided_by: "recruiter" }) });
  // re-score every talent with jobs from this company
  const rows = await sb<any[]>(`talent_jobs?select=talent_id,jobs!inner(company_linkedin_id)&jobs.company_linkedin_id=eq.${encodeURIComponent(cid)}`);
  const talents = [...new Set(rows.map(r => r.talent_id))];
  const results = [];
  for (const t of talents) results.push(await rescore(t, `Re-score after company verdict: ${verdict === "agency" ? "agency" : "real employer"}`));
  return Response.json({ talents: talents.length, results });
}
