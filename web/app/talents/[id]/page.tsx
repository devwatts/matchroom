import { notFound } from "next/navigation";
import { sb } from "@/lib/db";
import TalentView from "@/components/TalentView";
export const dynamic = "force-dynamic";

export default async function TalentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [talent] = await sb<any[]>(`talents?id=eq.${id}&select=id,name,linkedin_url,status,match_days,match_until,created_at`);
  if (!talent) notFound();
  const [settings, facts, matches, runs, templates, all] = await Promise.all([
    sb<any[]>(`talent_settings?talent_id=eq.${id}`),
    sb<any[]>(`talent_facts?talent_id=eq.${id}&select=level,role_family,years_computed,industries&order=created_at.desc&limit=1`),
    sb<any[]>(`talent_matches?talent_id=eq.${id}&order=score.desc`),
    sb<any[]>(`pipeline_runs?talent_id=eq.${id}&select=id,status,trigger,started_at,finished_at,error,pipeline_run_steps(step,counts)&order=started_at.desc&limit=1`),
    sb<any[]>("role_templates?select=id,name&order=name"),
    sb<any[]>("talents?select=id&order=created_at.asc"),
  ]);
  const factIds = matches.filter(m => m.shown && m.job_fact_id).map(m => m.job_fact_id);
  const quotes = factIds.length ? await sb<any[]>(`job_facts?id=in.(${factIds.join(",")})&select=id,experience_paths,level_quote`) : [];
  const industries = [...new Set((await sb<any[]>(`talent_jobs?talent_id=eq.${id}&select=jobs(companies(industries))`))
    .flatMap(r => r.jobs?.companies?.industries || []))].sort();
  return <TalentView talent={{ ...talent, n: all.findIndex(t => t.id === id) + 1 }} settings={settings[0]} fact={facts[0] || null}
           matches={matches} lastRun={runs[0] || null} templates={templates} industries={industries}
           quotes={Object.fromEntries(quotes.map(q => [q.id, (q.experience_paths?.[0]?.quote) || ""]))} />;
}
