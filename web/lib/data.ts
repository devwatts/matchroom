import "server-only";
import { sb } from "./db";

export type TalentRow = {
  id: string; name: string | null; linkedin_url: string; status: string; match_days: number; match_until: string | null; created_at: string;
  role: string; years: number | null; level: string | null; matches: number; checks: number; last_run: string | null; last_run_status: string | null; n: number;
};

export async function talentsOverview(): Promise<{ rows: TalentRow[]; totals: Record<string, number> }> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [talents, facts, matches, runs, funnel] = await Promise.all([
    sb<any[]>("talents?select=id,name,linkedin_url,status,match_days,match_until,created_at&order=created_at.asc"),
    sb<any[]>("talent_facts?select=talent_id,role_family,years_computed,level,created_at&order=created_at.desc"),
    sb<any[]>("talent_matches?select=talent_id,shown,agency_status"),
    sb<any[]>("pipeline_runs?select=talent_id,status,started_at&order=started_at.desc&limit=500"),
    sb<any[]>(`funnel_daily?day=gte.${since}&select=jobs_found,agency_removed,jobs_matched,startup_jobs,held_for_check`),
  ]);
  const rows = talents.map((t, i) => {
    const f = facts.find(x => x.talent_id === t.id), r = runs.find(x => x.talent_id === t.id);
    const m = matches.filter(x => x.talent_id === t.id);
    return { ...t, n: i + 1, role: f ? f.role_family.replace(/_/g, " ") : (t.status === "failed" ? "Profile couldn't be read" : "Reading profile…"),
      years: f ? Number(f.years_computed) : null, level: f?.level ?? null, matches: m.filter(x => x.shown).length,
      checks: m.filter(x => x.agency_status === "needs_check").length, last_run: r?.started_at ?? null, last_run_status: r?.status ?? null };
  });
  const sum = (k: string) => funnel.reduce((a, x) => a + Number(x[k] || 0), 0);
  return { rows, totals: { found: sum("jobs_found"), agency: sum("agency_removed"), matched: sum("jobs_matched"), startup: sum("startup_jobs"), held: sum("held_for_check") } };
}
