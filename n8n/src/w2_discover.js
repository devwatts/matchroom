// W2 step 2 (Discover): search New York jobs for the talent and save them in one batch.
const { talent_id, run_id } = $input.first().json;
await runStep(run_id, 'discover', async ctx => {
  const run = await one(`pipeline_runs?id=eq.${run_id}`);
  const st = await one(`talent_settings?talent_id=eq.${talent_id}`);
  const tf = await one(`talent_facts?talent_id=eq.${talent_id}&order=created_at.desc&limit=1`);
  // how far back to look: first run uses the setting; daily runs 24h; after a gap, a catch-up window with a bigger cap
  let windowUsed = '24h', cap = 25, recovery = false;
  if (run.trigger === 'onboarding') windowUsed = st.first_search_window;
  else {
    const last = await one(`pipeline_runs?talent_id=eq.${talent_id}&status=eq.finished&id=neq.${run_id}&order=finished_at.desc&limit=1`);
    const hours = last ? (Date.now() - new Date(last.finished_at).getTime()) / 3600000 : 1e9;
    if (hours > 30) { recovery = true; cap = 100; windowUsed = hours > 8 * 24 ? 'month' : 'week'; }
  }
  const lvl = st.level_override || LEVELS[Math.min(LEVELS.indexOf(tf.level), LEVELS.indexOf(yearsLevel(Number(tf.years_computed))) + 1)];
  const levels = [lvl, ...(LEVELS.indexOf(lvl) > 0 ? [LEVELS[LEVELS.indexOf(lvl) - 1]] : [])];
  const titles = st.search_titles || [];
  if (!titles.length) throw Object.assign(new Error('no search titles'), { userMessage: 'This talent has no search titles. Add some under Matching rules.' });
  const input = { jobTitles: titles, locations: ['New York'], sortBy: 'date', maxItems: cap, experienceLevel: levels };
  if (windowUsed !== 'any') input.postedLimit = windowUsed;
  await ctx.log(`Searching ${titles.length} titles · window: ${windowUsed === '24h' ? 'last 24 hours' : windowUsed === 'any' ? 'any time' : 'past ' + windowUsed}${recovery ? ' (catching up after a gap)' : ''}`, true);
  const { items, datasetId } = await apify('linkedin-job-search', input, ctx);
  await stepPatch(run_id, 'discover', { counts: { apify_dataset_id: datasetId } });   // lets a failed save be re-loaded without re-scraping
  await ctx.log(`${items.length} results from LinkedIn`);
  const c = await rpc('ingest_jobs', { p_talent: talent_id, p_run: run_id, p_items: items });
  await sb('PATCH', `pipeline_runs?id=eq.${run_id}`, { posted_window_used: windowUsed, recovery_mode: recovery });
  await ctx.log(`Saved ${c.unique} jobs · ${c.new} new for this talent`);
  return {
    summary: `${c.unique} jobs found · ${c.new} new · ${c.seen_before} seen before`,
    details: [`Searched: ${titles.join(', ')}`, `Window: ${windowUsed === '24h' ? 'last 24 hours' : windowUsed === 'any' ? 'any time' : 'past ' + windowUsed}, up to ${cap} jobs per title, newest first`,
              `Level filter: ${levels.join(' and ')}`, 'Repeat finds only update "last seen" and are not counted again'],
    counts: { ...c, apify_dataset_id: datasetId, window: windowUsed, recovery },
  };
});
return [{ json: { talent_id, run_id } }];
