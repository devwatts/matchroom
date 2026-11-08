// W3: every morning. Clean up stuck runs, close ended windows, start a run for each active talent.
await rpc('mark_stale_runs');
await sb('PATCH', `talents?status=eq.active&match_until=lt.${now()}`, { status: 'window_ended', updated_at: now() });
const talents = await sb('GET', `talents?status=eq.active&match_until=gt.${now()}&select=id`);
const out = [];
for (const t of talents) {
  const run = (await sb('POST', 'pipeline_runs', { talent_id: t.id, trigger: 'daily', n8n_execution_id: String($execution.id) }, 'return=representation'))[0];
  await sb('POST', 'pipeline_run_steps', [
    { pipeline_run_id: run.id, step: 'enrich', status: 'skipped', summary: 'Skipped · profile was read when the talent was added' },
    ...['discover', 'filter', 'match'].map(step => ({ pipeline_run_id: run.id, step, status: 'waiting' }))]);
  out.push({ json: { talent_id: t.id, run_id: run.id } });
}
return out.length ? out : [];
