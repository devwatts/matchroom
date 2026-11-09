"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) =>
    <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export default function AddTalentForm({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [url, setUrl] = useState(""), [days, setDays] = useState(14), [win, setWin] = useState("week");
  const [tpl, setTpl] = useState(""), [stage, setStage] = useState("none"), [min, setMin] = useState(75);
  const [spons, setSpons] = useState(false), [excl, setExcl] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const res = await fetch("/api/talents", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_url: url, match_days: days, first_search_window: win, template_id: tpl || null, startup_preference: stage,
                             min_score: min, needs_sponsorship: spons, excluded_companies: excl }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { router.push(`/runs?talent=${j.id}`); return; }
    setBusy(false);
    if (res.status === 409 && j.id) { setErr(j.error); router.push(`/talents/${j.id}`); return; }
    setErr(j.error || "Something went wrong. Try again.");
  }
  return (
    <form className={`tile form${busy ? " loading" : ""}`} onSubmit={submit}>
      <label className="f" htmlFor="f-url">LinkedIn profile
        <input className="big" id="f-url" type="text" inputMode="url" placeholder="linkedin.com/in/…" required value={url} onChange={e => setUrl(e.target.value)} />
      </label>
      <div style={{ display: "grid", gap: 8 }}><span style={{ fontWeight: 800, fontSize: 16 }}>Find jobs for</span>
        <Seg label="Days" value={days} onChange={setDays} options={[[7, "7 days"], [14, "14 days"], [30, "30 days"]]} />
        <span className="hint">A search runs every morning at 08:00 New York time until then.</span></div>
      <details className="acc">
        <summary>Optional settings <span className="hint" style={{ marginLeft: "auto", marginRight: 10 }}>defaults work for most talents</span></summary>
        <div className="acc-body">
          <div style={{ display: "grid", gap: 8 }}><span style={{ fontWeight: 800 }}>First search looks at jobs posted in the last</span>
            <Seg label="Window" value={win} onChange={setWin} options={[["24h", "24 hours"], ["week", "week"], ["month", "month"], ["any", "any time"]]} />
            <span className="hint">Go wider for niche roles. After the first run, each search covers the last 24 hours.</span></div>
          {templates.length > 0 && <div style={{ display: "grid", gap: 8 }}><span style={{ fontWeight: 800 }}>Start from a role template</span>
            <Seg label="Template" value={tpl} onChange={setTpl} options={[["", "From the profile"], ...templates.map(t => [t.id, t.name] as [string, string])]} /></div>}
          <div style={{ display: "grid", gap: 8 }}><span style={{ fontWeight: 800 }}>Startup stage</span>
            <Seg label="Startup stage" value={stage} onChange={setStage} options={[["none", "No preference"], ["seed_b", "Seed to Series B"], ["a_d", "Series A to D"], ["any", "Any startup"]]} /></div>
          <label className="f" htmlFor="f-min">Show jobs scoring at least
            <input className="num" id="f-min" type="number" min={0} max={100} value={min} onChange={e => setMin(Number(e.target.value))} /></label>
          <label className="row" style={{ fontWeight: 700, gap: 8 }}><input type="checkbox" checked={spons} onChange={e => setSpons(e.target.checked)} /> Needs visa sponsorship (hide jobs that won&apos;t sponsor)</label>
          <label className="f" htmlFor="f-excl">Never show jobs from
            <input className="big" id="f-excl" style={{ fontSize: 15, padding: "10px 12px" }} placeholder="Company names, comma separated" value={excl} onChange={e => setExcl(e.target.value)} /></label>
        </div>
      </details>
      {err && <div className="error-box" role="alert">{err}</div>}
      <div className="row"><button className="btn y" type="submit" disabled={busy}>{busy ? "Starting…" : "Add and start matching →"}</button>
        <span className="hint">You&apos;ll watch it run on the next screen.</span></div>
    </form>
  );
}
