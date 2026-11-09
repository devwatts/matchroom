// W3: every morning. Clean up stuck runs, close ended windows, start a run for each active talent.
await rpc('mark_stale_runs');
await sb('PATCH', `talents?status=eq.active&match_until=lt.${now()}`, {
  status: 'window_ended',
  updated_at: now(),
});
const talents = await sb('GET', `talents?status=eq.active&match_until=gt.${now()}&select=id`);
const out = [];
for (const t of talents) {
  const runId = await rpc('start_run', {
    p_talent: t.id,
    p_trigger: 'daily',
    p_execution: String($execution.id),
  });
  if (runId) out.push({ json: { talent_id: t.id, run_id: runId } }); // null: a run is already going for this talent
}
return out.length ? out : [];
