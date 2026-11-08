import "server-only";

// Server-only access to Supabase's REST API with the service key. The browser never talks to Supabase.
const URL_ = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function sb<T = any>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const { prefer, headers, ...rest } = init;
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database error ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const rpc = <T = any>(fn: string, args: Record<string, unknown> = {}) =>
  sb<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

// Re-score one talent from stored facts (no model calls), recorded as a "rescore" run with one Match step.
export async function rescore(talentId: string, why: string): Promise<{ before: number; after: number; runId: string }> {
  const before = (await sb<any[]>(`talent_matches?talent_id=eq.${talentId}&shown=is.true&select=job_id`)).length;
  const [run] = await sb<any[]>("pipeline_runs", { method: "POST", prefer: "return=representation",
    body: JSON.stringify({ talent_id: talentId, trigger: "rescore" }) });
  const now = new Date().toISOString();
  await sb("pipeline_run_steps", { method: "POST", body: JSON.stringify([
    { pipeline_run_id: run.id, step: "enrich", status: "skipped", started_at: null, summary: "Skipped · re-score uses stored reads" },
    { pipeline_run_id: run.id, step: "discover", status: "skipped", started_at: null, summary: "Skipped · no new search" },
    { pipeline_run_id: run.id, step: "filter", status: "skipped", started_at: null, summary: "Skipped · postings already read" },
    { pipeline_run_id: run.id, step: "match", status: "running", started_at: now, summary: why },
  ]) });
  try {
    const n = await rpc<number>("score_talent", { p_talent: talentId, p_run: run.id });
    const after = (await sb<any[]>(`talent_matches?talent_id=eq.${talentId}&shown=is.true&select=job_id`)).length;
    const done = new Date().toISOString();
    await sb(`pipeline_run_steps?pipeline_run_id=eq.${run.id}&step=eq.match`, { method: "PATCH", body: JSON.stringify({
      status: "finished", finished_at: done, summary: `${n} re-scored · ${after} matched (was ${before})`, details: [why],
      log: [{ at: now, msg: why }, { at: done, msg: `Re-scored ${n} jobs from stored reads, no model calls` }] }) });
    await sb(`pipeline_runs?id=eq.${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "finished", finished_at: done }) });
    return { before, after, runId: run.id };
  } catch (e: any) {
    await sb(`pipeline_run_steps?pipeline_run_id=eq.${run.id}&step=eq.match`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: e.message, finished_at: new Date().toISOString() }) });
    await sb(`pipeline_runs?id=eq.${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: e.message, finished_at: new Date().toISOString() }) });
    throw e;
  }
}

export async function triggerOnboarding(talentId: string) {
  const res = await fetch(`https://${process.env.N8N_HOST}/webhook/talent-added`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "x-webhook-secret": process.env.WEBHOOK_SHARED_SECRET! },
    body: JSON.stringify({ talent_id: talentId }),
  });
  if (!res.ok) throw new Error(`The pipeline didn't start (n8n returned ${res.status})`);
}
