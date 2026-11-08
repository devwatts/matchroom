"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ago, avatarColor, code, initials } from "@/lib/format";

type W = { skills: number; role: number; seniority: number; location: number; company_type: number };
const KEYS: (keyof W)[] = ["skills", "role", "seniority", "location", "company_type"];
const LABEL: Record<keyof W, string> = { skills: "Skills", role: "Role", seniority: "Seniority", location: "Location", company_type: "Company type" };
const STAGES: Record<string, string[]> = { seed_b: ["pre_seed", "seed", "series_a", "series_b"], a_d: ["series_a", "series_b", "series_c", "series_d"],
  any: ["pre_seed", "seed", "series_a", "series_b", "series_c", "series_d", "startup"] };
const STAGE_LABEL: Record<string, string> = { pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b: "Series B", series_c: "Series C", series_d: "Series D",
  startup: "Startup (inferred)", later: "Late stage", public: "Public", not_startup: "Not a startup", unknown: "Stage unknown" };
const LEVELS = ["entry", "associate", "mid-senior", "director"];
const FILTER_LABEL: Record<string, [string, string]> = { "too junior": ["Too senior for them", "var(--yellow)"], "well below talent level": ["Below their level", "var(--tile-deep)"],
  "not reasonable": ["Different role, no shared skills", "var(--tile-deep)"], "no shared skills": ["No shared skills", "var(--tile-deep)"],
  "needs industry experience": ["Industry they lack", "var(--violet)"], "excluded company": ["Excluded company", "var(--pink)"],
  "excluded industry": ["Excluded industry", "var(--pink)"], "excluded title word": ["Excluded title word", "var(--pink)"], "no sponsorship": ["Won't sponsor", "var(--pink)"] };

function compValue(stage: string | null, pref: string): number | null {
  if (pref === "none" || !stage || stage === "unknown") return null;
  if (stage === "startup") return pref === "any" ? 1 : null;
  return STAGES[pref]?.includes(stage) ? 1 : 0;
}
function preview(m: any, w: W, pref: string) {
  const b = m.breakdown, vals: Record<keyof W, number | null> = {
    skills: b.skills.value, role: b.role.value, seniority: b.seniority.value, location: b.location.value, company_type: compValue(m.company_stage, pref) };
  let num = 0, den = 0;
  for (const k of KEYS) { const v = vals[k]; if (v == null || w[k] <= 0) continue; num += w[k] * Number(v); den += w[k]; }
  return { raw: den ? 100 * num / den : 0, vals };
}

export default function TalentView({ talent, settings, fact, matches, lastRun, templates, industries, quotes }: any) {
  const router = useRouter();
  const [tab, setTab] = useState<"matches" | "filtered" | "rules">("matches");
  const [w, setW] = useState<W>(settings.weights), [min, setMin] = useState<number>(settings.min_score), [pref, setPref] = useState<string>(settings.startup_preference);
  const [titles, setTitles] = useState<string[]>(settings.search_titles), [skills, setSkills] = useState<any[]>(settings.skills);
  const [exclC, setExclC] = useState<string[]>(settings.excluded_companies), [exclI, setExclI] = useState<string[]>(settings.excluded_industries);
  const [exclT, setExclT] = useState<string[]>(settings.excluded_title_words), [spons, setSpons] = useState<boolean>(settings.needs_sponsorship);
  const [lvl, setLvl] = useState<string>(settings.level_override || ""), [toast, setToast] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [tplName, setTplName] = useState("");
  const first = (talent.name || "this talent").split(" ")[0];
  const employers = matches.filter((m: any) => m.agency_status === "employer" && m.passed);
  const scored = useMemo(() => employers.map((m: any) => ({ m, ...preview(m, w, pref) })).sort((a: any, b: any) => b.raw - a.raw), [employers, w, pref]);
  const shown = scored.filter((x: any) => x.raw >= min), below = scored.length - shown.length;
  const removed = matches.filter((m: any) => m.agency_status !== "employer" || !m.passed);
  const active = KEYS.filter(k => w[k] > 0 && !(k === "company_type" && pref === "none")), tot = active.reduce((a, k) => a + w[k], 0);
  const lvlRead = fact ? fact.level : null;
  const runFailed = lastRun?.status === "failed", running = lastRun?.status === "running" || talent.status === "adding";
  const checked = lastRun?.pipeline_run_steps?.find((s: any) => s.step === "discover")?.counts?.unique;

  async function save() {
    setBusy(true); setToast(null);
    const res = await fetch(`/api/talents/${talent.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weights: w, min_score: min, startup_preference: pref, search_titles: titles, skills, excluded_companies: exclC,
                             excluded_industries: exclI, excluded_title_words: exclT, needs_sponsorship: spons, level_override: lvl }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setToast(j.error || "Couldn't save. Try again."); return; }
    const d = j.after - j.before;
    setToast(`Saved and re-scored. ${d === 0 ? "The same number of jobs match." : d < 0 ? `${-d} job${d < -1 ? "s" : ""} dropped off.` : `${d} more job${d > 1 ? "s" : ""} now match.`} ${j.after} matched (was ${j.before}).`);
    router.refresh();
  }
  async function saveTemplate() {
    if (!tplName.trim()) return;
    const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tplName, talent_id: talent.id }) });
    setToast(res.ok ? `Template "${tplName}" saved. Pick it when adding a talent.` : "Couldn't save the template."); setTplName("");
  }

  return (
    <main className="wrapx">
      <div className="phead">
        <div className="avatar" style={{ ["--av" as any]: avatarColor(talent.id) }}>{initials(talent.name)}</div>
        <div>
          <span className="mono muted">{code("TLN", talent.n)} · {fact ? `${fact.role_family.replace(/_/g, " ")} · ${fact.years_computed} years` : "profile not read yet"} · <a href={talent.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></span>
          <h1>{talent.name || "New talent"}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <span className={`chip ${talent.status === "active" ? "c-active" : talent.status === "failed" ? "c-failed" : talent.status === "adding" ? "c-adding" : "c-ended"}`}>{talent.status.replace("_", " ")}</span>
            {talent.match_until && <span className="chip">{Math.max(0, Math.ceil((new Date(talent.match_until).getTime() - Date.now()) / 86400000))} of {talent.match_days} days left</span>}
            {lvlRead && <span className="chip">{settings.level_override || lvlRead}</span>}
          </div>
        </div>
        <Link className="btn y sm linkbtn" href={`/runs?talent=${talent.id}`}>{running ? "● Watch the run" : "Runs"}</Link>
      </div>

      <div className="tabs" role="tablist" aria-label="Talent sections">
        <button role="tab" aria-selected={tab === "matches"} onClick={() => setTab("matches")}>Matches <span className="n">{shown.length}</span></button>
        <button role="tab" aria-selected={tab === "filtered"} onClick={() => setTab("filtered")}>Filtered <span className="n">{removed.length}</span></button>
        <button role="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>Matching rules</button>
      </div>

      {tab === "matches" && (
        <section className="mlist">
          {shown.length === 0 && (
            <div className="empty">
              {running ? <>The first run is in progress. <Link href={`/runs?talent=${talent.id}`}>Watch it live</Link>.</>
                : runFailed ? <>The last run failed, so there are no new matches. <Link href={`/runs?talent=${talent.id}`}>See what happened</Link>.</>
                : <>The last run checked {checked ?? matches.length} jobs ({ago(lastRun?.started_at)}) and none reached {first}&apos;s minimum of {min}.{below ? ` ${below} scored below it.` : ""}</>}
            </div>
          )}
          {shown.map(({ m, raw, vals }: any) => {
            const s = Math.round(raw), tone = s >= 80 ? "var(--green)" : s >= 70 ? "var(--cyan)" : "var(--yellow)";
            const chip = (k: keyof W) => {
              const v = vals[k];
              if (k === "company_type") return pref === "none" ? <span key={k} className="na">Startup stage · no preference set</span>
                : v == null ? <span key={k} className="na">{STAGE_LABEL[m.company_stage || "unknown"]} · not scored</span>
                : <span key={k} className={v ? "ok" : "miss"}>{STAGE_LABEL[m.company_stage]} · {Math.round(w[k] * v)}/{w[k]}</span>;
              if (v == null || w[k] === 0) return <span key={k} className="na">{LABEL[k]} · not scored</span>;
              const b = m.breakdown, nv = Number(v);
              const cls = k === "skills" ? (nv >= 0.7 ? "ok" : nv >= 0.35 ? "part" : "miss") : (nv >= 0.95 ? "ok" : nv >= 0.5 ? "part" : "miss");
              const txt = k === "skills" ? `Skills ${b.skills.has.length} of ${b.skills.has.length + b.skills.missing.length}` : k === "role" ? b.role.label
                : k === "seniority" ? (v >= 0.95 ? "Level fits" : "Level off") : (b.location.remote ? "Remote" : "New York");
              return <span key={k} className={cls}>{txt} · {Math.round(w[k] * Number(v))}/{w[k]}</span>;
            };
            return (
              <article key={m.job_id} className="match">
                <div className="score" style={{ ["--sc" as any]: tone }}><b>{s}</b><span>/ 100</span></div>
                <div className="mbody">
                  <div className="row between" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}><span className="mono muted">JOBx{m.job_id.slice(-4)} · found by searching &quot;{m.first_search_title || "–"}&quot;</span>
                      <h3>{m.title}</h3>
                      <span className="muted" style={{ fontWeight: 600 }}>{m.company_name} · {m.location || "New York"}{m.workplace_type ? ` · ${m.workplace_type}` : ""} · posted {ago(m.posted_at)}</span></div>
                    {m.url && <a className="btn alt sm linkbtn" href={m.url} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
                  </div>
                  <p className="reason">{m.reason}</p>
                  <div className="crit">{KEYS.map(chip)}<span className="ok">Direct employer</span></div>
                  {quotes[m.job_fact_id] && <p className="quote">&quot;{quotes[m.job_fact_id]}&quot; · from the posting</p>}
                </div>
              </article>
            );
          })}
          {shown.length > 0 && below > 0 && <div className="below">{below} more job{below > 1 ? "s" : ""} scored below {first}&apos;s minimum of {min}. Lower it in Matching rules to see {below > 1 ? "them" : "it"}.</div>}
        </section>
      )}

      {tab === "filtered" && (
        <section className="flist">
          {removed.length === 0 && <div className="empty">Nothing filtered out yet.</div>}
          {removed.map((m: any) => {
            const [label, col] = m.agency_status === "agency" ? ["Agency post", "var(--pink)"] : m.agency_status === "needs_check" ? ["Held for a check", "var(--yellow)"]
              : FILTER_LABEL[m.filters_failed[0]] || [m.filters_failed[0], "var(--tile-deep)"];
            return (
              <div key={m.job_id} className="frow">
                <div style={{ minWidth: 0 }}><b>{m.title}</b><div className="muted" style={{ fontWeight: 600 }}>{m.company_name}</div></div>
                <span className="chip" style={{ background: col, color: "#121212" }}>{label}</span>
                <span className="mono muted" style={{ textTransform: "none", letterSpacing: 0 }}>{m.agency_status === "employer" ? m.reason : (m.agency_evidence ? `"${m.agency_evidence}"` : m.reason)}</span>
              </div>
            );
          })}
        </section>
      )}

      {tab === "rules" && (
        <section className="grid2">
          <div className="tile" style={{ display: "grid", gap: 14 }}>
            <h2>What we search for</h2>
            <ChipEdit label="Target titles · used for the job search" items={titles} onChange={setTitles} placeholder="+ title" />
            <div><span className="mono muted">Must-have skills · where each came from</span>
              <div className="chipedit" style={{ marginTop: 8 }}>
                {skills.map((s, i) => (
                  <span key={s.name + i} className="skill">{s.name} <small style={{ ["--s" as any]: s.source === "work" ? "var(--green)" : s.source === "recruiter" ? "var(--cyan)" : "var(--tile-deep)" }}>{s.source === "work" ? "at work" : s.source === "recruiter" ? "added by you" : "listed"}</small>
                    <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setSkills(skills.filter((_, k) => k !== i))}>×</button></span>
                ))}
                <AddInput placeholder="+ skill" onAdd={v => setSkills([...skills, { name: v, source: "recruiter" }])} />
              </div>
              <p className="slh" style={{ marginTop: 6 }}>Skills you add count in full. Related skills are also credited automatically, for example NestJS counts toward &quot;APIs&quot;.</p></div>
            <ChipEdit label="Deal-breaker · excluded companies" items={exclC} onChange={setExclC} placeholder="+ company" />
            <div><span className="mono muted">Deal-breaker · excluded industries</span>
              <div className="chipedit" style={{ marginTop: 8 }}>
                {exclI.map(x => <span key={x} className="skill">{x}<button type="button" onClick={() => setExclI(exclI.filter(y => y !== x))}>×</button></span>)}
                <select className="sel" value="" onChange={e => e.target.value && setExclI([...exclI, e.target.value])} aria-label="Add excluded industry">
                  <option value="">+ industry</option>{industries.filter((x: string) => !exclI.includes(x)).map((x: string) => <option key={x}>{x}</option>)}
                </select>
              </div></div>
            <ChipEdit label="Deal-breaker · title words" items={exclT} onChange={setExclT} placeholder="+ word, e.g. Intern" />
            <label className="row" style={{ fontWeight: 700, gap: 8 }}><input type="checkbox" checked={spons} onChange={e => setSpons(e.target.checked)} /> Needs visa sponsorship</label>
            <div className="grid2" style={{ gap: 12 }}>
              <label className="f" style={{ fontSize: 14 }}>Seniority
                <select className="sel" value={lvl} onChange={e => setLvl(e.target.value)}>
                  <option value="">{lvlRead ? `${lvlRead} (from profile)` : "From profile"}</option>
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select></label>
              <label className="f" style={{ fontSize: 14 }}>Startup stage
                <select className="sel" value={pref} onChange={e => setPref(e.target.value)}>
                  <option value="none">No preference</option><option value="seed_b">Seed to Series B</option>
                  <option value="a_d">Series A to D</option><option value="any">Any startup, Seed to D</option>
                </select></label>
            </div>
          </div>
          <div className="tile" style={{ display: "grid", gap: 14 }}>
            <div className="row between"><h2>How we score</h2><span className="mono muted">Drag to preview · Save applies</span></div>
            <p className="hint">Weights are relative: each one&apos;s share of the score is shown under it. The Matches tab updates as you drag.</p>
            {KEYS.map(k => (
              <div key={k} className="slw">
                <div className="sl"><span>{LABEL[k]}</span>
                  <input type="range" min={0} max={50} value={w[k]} aria-label={`${LABEL[k]} weight`} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} />
                  <output>{w[k]}</output></div>
                <p className="slh"><b>{active.includes(k) && tot ? `${Math.round(100 * w[k] / tot)}% of the score` : k === "company_type" && pref === "none" ? "not counted: no startup stage set" : "not counted"}</b> · {HELP(k, first, fact)}</p>
              </div>
            ))}
            <div className="slw"><div className="row"><span style={{ fontWeight: 800 }}>Show jobs scoring at least</span>
              <input className="num" type="number" min={0} max={100} value={min} onChange={e => setMin(Number(e.target.value) || 0)} aria-label="Minimum score" /></div>
              <p className="slh">Jobs below this are counted but not shown. Higher means a shorter list you can trust more; lower shows more jobs, with more misses. 65 was the best balance on our test jobs.</p></div>
            <div className="row"><button className="btn y" type="button" onClick={save} disabled={busy}>{busy ? "Re-scoring…" : "Save and re-score"}</button></div>
            <div className="row"><input className="search" style={{ flex: "1 1 160px" }} placeholder="Template name, e.g. Senior full-stack" value={tplName} onChange={e => setTplName(e.target.value)} />
              <button className="btn alt sm" type="button" onClick={saveTemplate}>Save as template</button></div>
            {toast && <div className="toast" role="status">{toast}</div>}
          </div>
        </section>
      )}
    </main>
  );
}

function HELP(k: keyof W, first: string, fact: any) {
  const y = fact ? `${fact.years_computed} years` : "their experience";
  return {
    skills: `How many of the job's core skills ${first} has. Skills used at work count fully, skills only listed on the profile count a little less.`,
    role: `Whether the job is the same kind of work as ${first}'s, a related kind, or a different one.`,
    seniority: `Whether the years and level the job asks for fit ${first}'s ${y}. A small gap loses points; a big gap removes the job.`,
    location: "Remote jobs score a little higher than New York on-site. Off by default because every job found is in New York or remote.",
    company_type: "How well the company's funding stage fits the startup stage you chose. Only counts when a startup stage is set.",
  }[k];
}

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  return <input value={v} placeholder={placeholder} aria-label={placeholder} onChange={e => setV(e.target.value)}
    onKeyDown={e => { if (e.key === "Enter" && v.trim()) { e.preventDefault(); onAdd(v.trim()); setV(""); } }}
    onBlur={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }} />;
}

function ChipEdit({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div><span className="mono muted">{label}</span>
      <div className="chipedit" style={{ marginTop: 8 }}>
        {items.map(x => <span key={x} className="skill">{x}<button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter(y => y !== x))}>×</button></span>)}
        <AddInput placeholder={placeholder} onAdd={v => !items.includes(v) && onChange([...items, v])} />
      </div>
    </div>
  );
}
