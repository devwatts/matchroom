// W4: n8n error workflow. If a run's own error handling didn't record the failure, record it here.
const e = $input.first().json;
const execId = String((e.execution && e.execution.id) || '');
const msg = ((e.execution && e.execution.error && e.execution.error.message) || 'Workflow failed').slice(0, 500);
if (!execId) return [{ json: { skipped: true } }];
const runs = await sb('GET', `pipeline_runs?n8n_execution_id=eq.${execId}&status=eq.running&select=id,talent_id,trigger`);
for (const r of runs) {
  await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${r.id}&status=eq.running`, { status: 'failed', error: msg, finished_at: now() });
  await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${r.id}&status=eq.waiting`, { status: 'skipped', summary: 'Not run' });
  await sb('PATCH', `pipeline_runs?id=eq.${r.id}`, { status: 'failed', error: msg, finished_at: now() });
  if (r.trigger === 'onboarding') {
    const t = await one(`talents?id=eq.${r.talent_id}&select=status`);
    if (t && t.status === 'adding') await sb('PATCH', `talents?id=eq.${r.talent_id}`, { status: 'failed', updated_at: now() });
  }
}
return [{ json: { runs_marked_failed: runs.length } }];
