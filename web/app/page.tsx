import Link from "next/link";
import { talentsOverview } from "@/lib/data";
import TalentsList from "@/components/TalentsList";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { rows, totals } = await talentsOverview();
  return (
    <main className="wrapx">
      <div className="row between">
        <div><span className="mono muted">Roster · {rows.length} talent{rows.length === 1 ? "" : "s"}</span><h1>Who are we placing?</h1></div>
        <Link href="/talents/new" className="btn y linkbtn">+ Add talent</Link>
      </div>
      <div className="stats">
        <div className="stat"><span className="mono">Jobs found · 7d</span><b>{totals.found}</b></div>
        <div className="stat" style={{ ["--c" as any]: "var(--pink)", ["--ct" as any]: "#121212" }}><span className="mono">Agency posts removed</span><b>{totals.agency}</b></div>
        <div className="stat" style={{ ["--c" as any]: "var(--green)", ["--ct" as any]: "#121212" }}><span className="mono">Matched</span><b>{totals.matched}</b></div>
        <div className="stat" style={{ ["--c" as any]: "var(--violet)", ["--ct" as any]: "#121212" }}><span className="mono">Startup jobs · 7d</span><b>{totals.startup}</b></div>
        <div className="stat" style={{ ["--c" as any]: "var(--yellow)", ["--ct" as any]: "#121212" }}><span className="mono">Need a quick check</span><b>{totals.held}</b></div>
      </div>
      <TalentsList rows={rows} />
    </main>
  );
}
