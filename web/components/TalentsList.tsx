"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ago, avatarColor, code, initials, yrs } from "@/lib/format";
import type { TalentRow } from "@/lib/data";

const ST: Record<string, [string, string]> = { active: ["c-active", "active"], adding: ["c-adding", "adding…"], paused: ["c-ended", "paused"],
  window_ended: ["c-ended", "window ended"], failed: ["c-failed", "failed · retry"] };
const FILTERS = [["all", "All"], ["active", "Active"], ["adding", "Adding"], ["check", "Needs check"], ["window_ended", "Ended"], ["failed", "Failed"]] as const;

export default function TalentsList({ rows }: { rows: TalentRow[] }) {
  const [q, setQ] = useState(""), [f, setF] = useState<string>("all");
  const shown = useMemo(() => rows.filter(t => (!q || `${t.name ?? ""} ${t.role}`.toLowerCase().includes(q.toLowerCase()))
    && (f === "all" || (f === "check" ? t.checks > 0 : t.status === f))).sort((a, b) => b.matches - a.matches), [rows, q, f]);
  const daysLeft = (t: TalentRow) => t.match_until ? Math.max(0, Math.ceil((new Date(t.match_until).getTime() - Date.now()) / 86400000)) : t.match_days;
  return (
    <section className="tile" style={{ display: "grid", gap: 14, padding: 16 }}>
      <div className="filters">
        <input className="search" type="search" placeholder="Search name or role" aria-label="Search talents" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Status">
          {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No talents yet. <Link href="/talents/new">Add the first one</Link> by pasting a LinkedIn link.</div>
      ) : (
        <div className="tlist" role="table" aria-label="Talents">
          <div className="trow thead" role="row"><span>Talent</span><span>Status</span><span>Matches</span><span>To check</span><span>Last run</span><span>Window</span><span></span></div>
          <div id="trows">
            {shown.map(t => (
              <Link key={t.id} href={`/talents/${t.id}`} className="trow" role="row" style={{ textDecoration: "none" }}>
                <span className="who" role="cell">
                  <span className="avatar sm" style={{ ["--av" as any]: avatarColor(t.id) }}>{initials(t.name)}</span>
                  <span style={{ minWidth: 0 }}><b>{t.name || t.linkedin_url.replace(/^https:\/\/www\.linkedin\.com\/in\//, "")}</b>
                    <span className="mono muted">{code("TLN", t.n)} · {t.role}{t.years != null ? ` · ${yrs(t.years)} yrs` : ""}</span></span>
                </span>
                <span role="cell"><span className={`chip ${(ST[t.status] || ST.active)[0]}`}>{(ST[t.status] || [, t.status])[1]}</span></span>
                <span role="cell" className="big">{t.status === "adding" ? "–" : t.matches}</span>
                <span role="cell" className="big">{t.checks > 0 ? <span className="chip c-check">{t.checks}</span> : 0}</span>
                <span role="cell" className="mono">{t.last_run_status === "running" ? "Running now" : ago(t.last_run)}{t.last_run_status === "failed" ? " · failed" : ""}</span>
                <span role="cell"><span className="days"><span style={{ width: `${Math.round(100 * daysLeft(t) / t.match_days)}%` }}></span></span>
                  <span className="mono muted">{daysLeft(t)} of {t.match_days} days</span></span>
                <span role="cell" className="arrow">→</span>
              </Link>
            ))}
            {shown.length === 0 && <div className="empty">No talents match these filters.</div>}
          </div>
        </div>
      )}
      <p className="hint">Showing {shown.length} of {rows.length} talents</p>
    </section>
  );
}
