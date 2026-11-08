import { sb } from "@/lib/db";
import CompanyChecks from "@/components/CompanyChecks";
export const dynamic = "force-dynamic";
export default async function Companies() {
  const [held, decided, tally] = await Promise.all([
    sb<any[]>("talent_matches?agency_status=eq.needs_check&select=company_linkedin_id,company_name,title,check_reason,talent_id,talents(name)"),
    sb<any[]>("company_verdicts_current?select=company_linkedin_id,verdict,source,decided_at&order=decided_at.desc"),
    sb<any[]>("company_agency_tally?suggestion=eq.suggest_agency&select=company_linkedin_id,company_name,agency_reads"),
  ]);
  const names = decided.length ? await sb<any[]>(`companies?company_linkedin_id=in.(${decided.map(d => `"${d.company_linkedin_id}"`).join(",")})&select=company_linkedin_id,name`) : [];
  return (
    <main className="wrapx">
      <div><span className="mono muted">Applies to every talent</span><h1>Company checks</h1></div>
      <p className="hint" style={{ fontSize: 15, maxWidth: "64ch" }}>When the system can&apos;t tell whether a company is an agency, its jobs are held here instead of shown. Decide once; every talent&apos;s list updates and that company isn&apos;t asked about again.</p>
      <CompanyChecks held={held} suggestions={tally} decided={decided.map(d => ({ ...d, name: names.find(n => n.company_linkedin_id === d.company_linkedin_id)?.name || d.company_linkedin_id }))} />
    </main>
  );
}
