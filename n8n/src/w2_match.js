// W2 step 4 (Match): score every job in SQL (no model call), then summarise the run.
const { talent_id, run_id } = $input.first().json;
await runStep(run_id, 'match', async ctx => {
  const st = await one(`talent_settings?talent_id=eq.${talent_id}&select=min_score,version`);
  await ctx.log(`Scoring with settings v${st.version}`, true);
  const n = await rpc('score_talent', { p_talent: talent_id, p_run: run_id });
  const s = await rpc('run_summary', { p_run: run_id });
  const fc = s.filter_counts || {};
  // add the agency and filter results to the Filter step's details
  const filt = await one(
    `pipeline_run_steps?pipeline_run_id=eq.${run_id}&step=eq.filter&select=details,summary`,
  );
  const extra = [
    `Agency posts removed: ${s.agency}${s.agency_examples.length ? ' (' + s.agency_examples.slice(0, 4).join(', ') + ')' : ''}`,
    `Held for a quick check: ${s.held}`,
    ...Object.entries(fc).map(([g, c]) => `${g[0].toUpperCase() + g.slice(1)}: ${c}`),
  ];
  await stepPatch(run_id, 'filter', {
    details: [...(filt.details || []), ...extra],
    summary: `${filt.summary} · ${s.agency} agency posts · ${s.held} held for a check`,
  });
  await ctx.log(`${n} jobs scored · ${s.shown} at ${st.min_score} or above`);
  return {
    summary: `${s.scored} scored · ${s.shown} matched at ${st.min_score} or above`,
    details: s.top.length
      ? s.top.map(t => `${t.title} at ${t.company} · ${t.score}`)
      : ['No job reached the minimum score this run'],
    counts: s,
  };
});
// the run is finished only once every step is: none still waiting, running or failed
const open_ = await sb(
  'GET',
  `pipeline_run_steps?pipeline_run_id=eq.${run_id}&status=in.(waiting,running,failed)&select=step,status`,
);
if (open_.length) {
  const msg = `Run ended with unfinished steps: ${open_.map(x => `${x.step} ${x.status}`).join(', ')}`;
  await sb('PATCH', `pipeline_runs?id=eq.${run_id}&status=eq.running`, {
    status: 'failed',
    error: msg,
    finished_at: now(),
  });
  throw new Error(msg);
}
await sb('PATCH', `pipeline_runs?id=eq.${run_id}&status=eq.running`, {
  status: 'finished',
  finished_at: now(),
});
return [{ json: { talent_id, run_id } }];
