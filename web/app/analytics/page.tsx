import { sb } from "@/lib/db";
export const dynamic = "force-dynamic";

const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export default async function Analytics() {
  const days = [...Array(7)].map((_, i) => nyDay(new Date(Date.now() - (6 - i) * 86400000)));
  const [rows, talents, fb] = await Promise.all([
    sb<any[]>(`funnel_daily?day=gte.${days[0]}`),
    sb<any[]>("talents?select=id,name"),
    sb<any[]>("agency_feedback_stats"),
  ]);
  const sumBy = (k: string, f: (r: any) => boolean = () => true) => rows.filter(f).reduce((a, r) => a + Number(r[k] || 0), 0);
  const per = days.map(d => ({ d, found: sumBy("jobs_found", r => r.day === d), qual: sumBy("jobs_qualified", r => r.day === d),
    match: sumBy("jobs_matched", r => r.day === d), start: sumBy("startup_jobs", r => r.day === d) }));
  const T = { found: sumBy("jobs_found"), qual: sumBy("jobs_qualified"), passed: sumBy("jobs_qualified") - sumBy("held_for_check") - sumBy("filtered_out"),
    match: sumBy("jobs_matched"), start: sumBy("startup_jobs"), startV: sumBy("startup_jobs_verified") };
  const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)}%` : "–";
  // chart, drawn to scale
  const Wd = 760, H = 280, L = 40, B = 34, Tp = 14, max = Math.max(10, Math.ceil(Math.max(...per.map(p => p.found)) / 10) * 10);
  const gw = (Wd - L - 10) / days.length, bw = gw / 5.2, y = (v: number) => Tp + (H - Tp - B) * (1 - v / max);
  const ticks = [...Array(5)].map((_, i) => Math.round(max * i / 4));
  const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const f = fb[0] || {};
  return (
    <main className="wrapx">
      <div><span className="mono muted">All talents · last 7 days</span><h1>Analytics</h1></div>
      <div className="kpis">
        <div className="stat"><span className="mono">Jobs posted</span><b>{T.found}</b><span className="hint">scraped, {(T.found / 7).toFixed(1)} a day</span></div>
        <div className="stat" style={{ ["--c" as any]: "var(--cyan)", ["--ct" as any]: "#121212" }}><span className="mono">Jobs qualified</span><b>{T.qual}</b><span className="hint" style={{ color: "#121212" }}>after agency posts removed · {pct(T.qual, T.found)}</span></div>
        <div className="stat" style={{ ["--c" as any]: "var(--green)", ["--ct" as any]: "#121212" }}><span className="mono">Jobs matched</span><b>{T.match}</b><span className="hint" style={{ color: "#121212" }}>{pct(T.match, T.qual)} of qualified</span></div>
        <div className="stat" style={{ ["--c" as any]: "var(--violet)", ["--ct" as any]: "#121212" }}><span className="mono">Startup jobs</span><b>{T.start}</b><span className="hint" style={{ color: "#121212" }}>Seed to Series D · {T.startV} verified, {T.start - T.startV} inferred</span></div>
      </div>
      <section className="tile" style={{ display: "grid", gap: 12 }}>
        <div className="row between"><h2>Per day</h2><div className="legend"><span><i style={{ background: "var(--tile-deep)" }}></i>Posted</span><span><i style={{ background: "var(--cyan)" }}></i>Qualified</span><span><i style={{ background: "var(--green)" }}></i>Matched</span><span><i style={{ background: "var(--violet)" }}></i>Startup</span></div></div>
        <div className="chartbox">
          <svg viewBox={`0 0 ${Wd} ${H}`} role="img" aria-label="Jobs per day: posted, qualified, matched, startup">
            {ticks.map(v => <g key={v}><line className="grid" x1={L} x2={Wd - 6} y1={y(v)} y2={y(v)} /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
            {per.map((p, i) => { const x0 = L + i * gw + gw * 0.12; return (
              <g key={p.d}>
                {([["found", "f-found"], ["qual", "f-qual"], ["match", "f-match"], ["start", "f-start"]] as const).map(([k, cls], j) => {
                  const v = (p as any)[k]; return <rect key={k} className={`b ${cls}`} x={x0 + j * (bw + 2)} y={y(v)} width={bw} height={y(0) - y(v)} rx={3}><title>{`${label(p.d)} · ${k}: ${v}`}</title></rect>; })}
                <text x={x0 + 2 * (bw + 2)} y={H - 10} textAnchor="middle">{label(p.d)}</text>
              </g>); })}
            <line className="axis" x1={L} x2={Wd - 6} y1={y(0)} y2={y(0)} />
          </svg>
        </div>
        <p className="hint">Jobs are counted on the day they were first found. Startup jobs are all jobs found that day at Seed to Series D companies.</p>
      </section>
      <section className="tile funnel">
        <h2>Funnel · 7 days</h2>
        {([["Posted", "found in New York for our searches", T.found, "var(--tile-deep)"], ["Qualified", "after agency posts are removed", T.qual, "var(--cyan)"],
           ["Passed filters", "level, deal-breakers, industry, skills", T.passed, "var(--yellow)"], ["Matched", "scored at or above each talent's minimum", T.match, "var(--green)"]] as const).map(([n, s, v, c]) => (
          <div key={n} className="fstep"><div className="lbl">{n}<small>{s}</small></div><div><div className="fill" style={{ width: `${Math.max(4, T.found ? 100 * v / T.found : 0)}%`, ["--fc" as any]: c }}></div></div><b>{v}</b></div>
        ))}
        <p className="hint">Company checks: {f.companies_decided ? `recruiters agreed with the system's agency call ${f.agreed_with_system} of ${f.companies_decided} times; ${f.companies_rescued} companies rescued.` : "none decided yet."}</p>
      </section>
      <section className="tile" style={{ display: "grid", gap: 10 }}>
        <h2>By talent</h2>
        <div className="chartbox"><table className="t2" style={{ minWidth: 560 }}>
          <thead><tr><th>Talent</th><th>Posted</th><th>Qualified</th><th>Matched</th><th>Startup</th><th>Hit rate</th></tr></thead>
          <tbody>{talents.map(t => { const s = (k: string) => sumBy(k, r => r.talent_id === t.id); const q = s("jobs_qualified");
            return <tr key={t.id}><td>{t.name || "New talent"}</td><td>{s("jobs_found")}</td><td>{q}</td><td>{s("jobs_matched")}</td><td>{s("startup_jobs")}</td><td>{pct(s("jobs_matched"), q)}</td></tr>; })}</tbody>
        </table></div>
      </section>
    </main>
  );
}
