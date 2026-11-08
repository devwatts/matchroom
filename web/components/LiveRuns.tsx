"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clock, ago } from "@/lib/format";

const ORDER = ["enrich", "discover", "filter", "match"];
const LABEL: Record<string, [string, string]> = { enrich: ["Enrich", "Read the LinkedIn profile"], discover: ["Discover", "Search New York jobs"],
  filter: ["Filter", "Read postings, remove agencies"], match: ["Match", "Score against the talent's settings"] };
const KIND: Record<string, string> = { onboarding: "Talent added", daily: "Daily search", rescore: "Re-score" };

export default function LiveRuns({ focusTalent }: { focusTalent?: string }) {
  const [data, setData] = useState<any>(null), [sel, setSel] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, timer: any;
    const load = async () => {
      try {
        const r = await fetch("/api/runs", { cache: "no-store" });
        const j = await r.json(); if (!alive) return;
        setData(j); setErr(null);
        setSel(s => s ?? (focusTalent ? j.runs.find((x: any) => x.talent_id === focusTalent)?.id : j.runs[0]?.id) ?? null);
        const anyRunning = j.runs.some((x: any) => x.status === "running");
        timer = setTimeout(load, anyRunning ? 3000 : 15000);
      } catch { if (alive) { setErr("Can't reach the server. Retrying…"); timer = setTimeout(load, 5000); } }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [focusTalent]);
  if (!data) return <p className="hint">{err || "Loading runs…"}</p>;
  if (!data.runs.length) return <div className="empty">No runs yet. Add a talent and its first run shows up here.</div>;
  const run = data.runs.find((r: any) => r.id === sel) || data.runs[0];
  const steps = ORDER.map(s => run.pipeline_run_steps.find((x: any) => x.step === s) || { step: s, status: "waiting" });
  const pct = (r: any) => Math.round(100 * r.pipeline_run_steps.filter((s: any) => ["finished", "skipped"].includes(s.status)).length / 4);
  const st = (r: any): [string, string] => r.status === "failed" ? ["c-failed", "failed"] : r.status === "finished" ? ["c-active", "done"] : ["c-adding", "running"];
  const wf = run.trigger === "onboarding" ? data.workflows.onboarding : run.trigger === "daily" ? data.workflows.daily : null;
  const n8nUrl = wf && run.n8n_execution_id ? `${data.n8n}/workflow/${wf}/executions/${run.n8n_execution_id}` : null;
  const failedStep = steps.find((s: any) => s.status === "failed");
  return (
    <div className="livegrid">
      <div className="rlist">
        {data.runs.map((r: any) => (
          <button key={r.id} className="rcard" aria-current={r.id === run.id} onClick={() => setSel(r.id)}>
            <div className="row between"><b>{r.talents?.name || "New talent"}</b><span className={`chip ${st(r)[0]}`}>{st(r)[1]}</span></div>
            <span className="mono">{KIND[r.trigger]} · {ago(r.started_at)}</span>
            <div className="bar2"><span style={{ width: `${pct(r)}%` }}></span></div>
          </button>
        ))}
      </div>
      <div className="timeline">
        <div className="row between">
          <div><span className="mono muted">{KIND[run.trigger]} · started {clock(run.started_at)}{run.posted_window_used ? ` · window: ${run.posted_window_used === "24h" ? "last 24 hours" : run.posted_window_used === "any" ? "any time" : "past " + run.posted_window_used}` : ""}{run.recovery_mode ? " · catching up" : ""}</span>
            <h2 style={{ fontSize: 28 }}><Link href={`/talents/${run.talent_id}`} style={{ textDecoration: "none" }}>{run.talents?.name || "New talent"}</Link></h2></div>
          <div className="row">
            {failedStep && run.trigger === "onboarding" && <RetryButton talentId={run.talent_id} />}
            {n8nUrl && <a className="btn alt sm linkbtn" href={n8nUrl} target="_blank" rel="noreferrer" title="For the operator: every node's input and output">Open in n8n ↗</a>}
          </div>
        </div>
        {steps.map((s: any, i: number) => {
          const cls = s.status === "finished" ? "done" : s.status === "running" ? "live" : s.status === "failed" ? "fail" : "wait";
          const chip = { finished: ["c-active", "done"], running: ["c-check", "running"], failed: ["c-failed", "error"], skipped: ["", "skipped"], waiting: ["", "waiting"] }[s.status as string] || ["", s.status];
          const details: string[] = s.details || [], log: any[] = s.log || [];
          return (
            <section key={s.step} className={`tstep ${cls}`}>
              <header>
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <div><b style={{ fontSize: 17 }}>{LABEL[s.step][0]}</b> <span className="muted" style={{ fontWeight: 600 }}>· {LABEL[s.step][1]}</span>
                  <div className="mono" style={{ marginTop: 3, textTransform: "none", letterSpacing: ".02em" }}>{s.summary || (s.status === "running" ? "Working…" : s.status === "waiting" ? "Waiting" : "")}</div></div>
                <span className={`chip ${chip[0]}`}>{chip[1]}</span>
              </header>
              {(details.length > 0 || log.length > 0 || s.error) && cls !== "wait" && (
                <div className="body">
                  {s.error && <div className="error-box">{s.error}</div>}
                  {details.length > 0 && <ul>{details.map((d, k) => <li key={k}>{d}</li>)}</ul>}
                  {log.length > 0 && <div className="log">{log.map((l, k) =>
                    <div key={k}><span className="t">{clock(l.at)}</span> {String(l.msg).startsWith("ERROR") ? <span className="e">{l.msg}</span> : l.msg}</div>)}</div>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RetryButton({ talentId }: { talentId: string }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn y sm" disabled={busy} onClick={async () => { setBusy(true); await fetch(`/api/talents/${talentId}/retry`, { method: "POST" }); setBusy(false); }}>{busy ? "Retrying…" : "Retry"}</button>;
}
