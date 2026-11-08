"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ago } from "@/lib/format";

const WHY: Record<string, string> = { unsure: "The posting didn't make clear who the employer is.", conflicting_verdicts: "Its jobs were read as an agency on some and an employer on others.",
  agency_internal_role: "A confirmed agency, but this looks like a role on its own team." };

export default function CompanyChecks({ held, suggestions, decided }: { held: any[]; suggestions: any[]; decided: any[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, string>>({}), [busy, setBusy] = useState<string | null>(null), [change, setChange] = useState<string | null>(null);
  const groups = Object.values(held.reduce((a: any, h) => { (a[h.company_linkedin_id] ||= { id: h.company_linkedin_id, name: h.company_name, jobs: [], why: h.check_reason }).jobs.push(h); return a; }, {})) as any[];
  async function decide(id: string, verdict: string, source = "recruiter") {
    setBusy(id);
    const res = await fetch("/api/companies/verdict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_linkedin_id: id, verdict, source }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setDone(d => ({ ...d, [id]: res.ok ? `${verdict === "agency" ? "Marked as an agency" : "Marked as a real employer"}. Re-scored ${j.talents} talent${j.talents === 1 ? "" : "s"}.` : (j.error || "Couldn't save") }));
    router.refresh();
  }
  const card = (id: string, name: string, sub: React.ReactNode, why: string, source?: string) => (
    <div key={id} className={`ccard${done[id] ? " saved" : ""}`}>
      {done[id] ? <><span className="mono">Saved</span><h3>{name}</h3><p>{done[id]}</p></> : <>
        <div className="row between"><div><span className="mono muted">{source === "confirmed_suggestion" ? "Suggestion" : "Waiting for you"}</span><h3>{name}</h3><span className="muted" style={{ fontWeight: 600 }}>{sub}</span></div>
          <div className="row"><button className="btn sm" disabled={busy === id} style={{ background: "var(--pink)", color: "#121212" }} onClick={() => decide(id, "agency", source)}>Agency</button>
            <button className="btn sm" disabled={busy === id} style={{ background: "var(--green)", color: "#121212" }} onClick={() => decide(id, "direct_employer", source)}>Real employer</button></div></div>
        <p>{why}</p></>}
    </div>);
  return (
    <>
      <section className="mlist">
        {groups.length === 0 && suggestions.length === 0 && <div className="empty">Nothing waiting. Every company with jobs on a list has a clear answer.</div>}
        {groups.map(g => card(g.id, g.name, `${g.jobs.length} job${g.jobs.length > 1 ? "s" : ""} held · ${g.jobs.map((j: any) => `${j.title} for ${j.talents?.name || "a talent"}`).slice(0, 2).join("; ")}`, WHY[g.why] || ""))}
        {suggestions.map(s => card(s.company_linkedin_id, s.company_name, `${s.agency_reads} of its jobs read as agency posts`, "These jobs are already removed. Confirming makes it permanent for every future job from this company.", "confirmed_suggestion"))}
      </section>
      <section className="tile" style={{ display: "grid", gap: 10 }}>
        <h2>Decided</h2>
        {decided.length === 0 ? <p className="hint">No company decisions yet.</p> : (
          <div className="chartbox"><table className="t2" style={{ minWidth: 520 }}>
            <thead><tr><th>Company</th><th>Verdict</th><th>Decided by</th><th>When</th><th></th></tr></thead>
            <tbody>{decided.map(d => (
              <tr key={d.company_linkedin_id}><td>{d.name}</td>
                <td><span className={`chip ${d.verdict === "agency" ? "c-failed" : "c-active"}`}>{d.verdict === "agency" ? "agency" : "real employer"}</span></td>
                <td>{d.source === "seed" ? "Starting list" : d.source === "confirmed_suggestion" ? "You, from a suggestion" : "You"}</td><td>{ago(d.decided_at)}</td>
                <td>{change === d.company_linkedin_id
                  ? <button className="btn alt sm" onClick={() => { decide(d.company_linkedin_id, d.verdict === "agency" ? "direct_employer" : "agency"); setChange(null); }}>Switch to {d.verdict === "agency" ? "real employer" : "agency"}</button>
                  : <button className="btn alt sm" onClick={() => setChange(d.company_linkedin_id)}>Change</button>}</td></tr>))}</tbody>
          </table></div>)}
      </section>
    </>
  );
}
