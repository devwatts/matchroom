"use client";
import { useState } from "react";
export default function LoginForm({ next }: { next: string }) {
  const [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) { window.location.href = next; return; }
    const j = await r.json().catch(() => ({})); setErr(j.error || "Couldn't log in. Try again."); setBusy(false); setPw("");
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <label className="f" htmlFor="pw">Password<input id="pw" className="big" type="password" autoComplete="current-password" autoFocus required value={pw} onChange={e => setPw(e.target.value)} /></label>
      {err && <div className="error-box" role="alert">{err}</div>}
      <button className="btn y" type="submit" disabled={busy || !pw}>{busy ? "Checking…" : "Let me in →"}</button>
    </form>
  );
}
