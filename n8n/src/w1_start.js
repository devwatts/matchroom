// W1 step 0: create the run and its four steps, so the frontend can show progress straight away.
const body = $input.first().json.body || {};
const talentId = body.talent_id;
if (!talentId) throw new Error('talent_id missing from webhook body');
const st = await one(`talent_settings?talent_id=eq.${talentId}&select=first_search_window`);
const run = (await sb('POST', 'pipeline_runs', { talent_id: talentId, trigger: 'onboarding', n8n_execution_id: String($execution.id),
  posted_window_used: (st && st.first_search_window) || 'week' }, 'return=representation'))[0];
await sb('POST', 'pipeline_run_steps', ['enrich', 'discover', 'filter', 'match'].map(step => ({ pipeline_run_id: run.id, step, status: 'waiting' })));
await sb('PATCH', `talents?id=eq.${talentId}`, { status: 'adding', updated_at: now() });
return [{ json: { talent_id: talentId, run_id: run.id } }];
