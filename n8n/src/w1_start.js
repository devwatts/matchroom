// W1 step 0: create the run and its four steps, so the frontend can show progress straight away.
const body = $input.first().json.body || {};
const talentId = body.talent_id;
if (!talentId) throw new Error('talent_id missing from webhook body');
const st = await one(`talent_settings?talent_id=eq.${talentId}&select=first_search_window`);
// one transaction: the run and its four steps, or nothing if this talent already has a run going
const runId = await rpc('start_run', {
  p_talent: talentId,
  p_trigger: 'onboarding',
  p_execution: String($execution.id),
  p_window: (st && st.first_search_window) || 'week',
});
if (!runId)
  throw new Error('This talent already has a run in progress; not starting a second one');
const run = { id: runId };
await sb('PATCH', `talents?id=eq.${talentId}`, { status: 'adding', updated_at: now() });
return [{ json: { talent_id: talentId, run_id: run.id } }];
