// W2 step 3 (Filter): read each new posting once (5 at a time), then check companies for startup stage.
const { talent_id, run_id } = $input.first().json;
await runStep(run_id, 'filter', async ctx => {
  const todo = await rpc('jobs_to_read', { p_talent: talent_id });
  await ctx.log(`Reading ${todo.length} postings, 5 at a time`, true);
  const facts = []; let failed = 0, done = 0;
  const jobText = j => `Title: ${py(j.title)}\nCompany: ${py(j.company_name)} (${py(j.employee_count)} employees)\nCompany description: ${j.company_description || ''}\nLinkedIn level: ${j.experience_level || 'not given'}\n\n${j.description || ''}`;
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    const res = await Promise.allSettled(batch.map(j => llm(PROMPTS.job, jobText(j))));
    res.forEach((r, k) => {
      const j = batch[k];
      if (r.status !== 'fulfilled') { failed++; return; }
      const o = r.value.out;
      facts.push({ job_id: j.job_id, content_hash: j.content_hash, prompt_version: PROMPTS.job.version, model: PROMPTS.job.model,
        agency: o.agency, agency_quote: o.agency_quote, named_employer: o.named_employer, role_family: o.title_family, level: o.level,
        level_quote: o.level_quote, experience_paths: o.experience_paths, sponsorship: o.sponsorship, sponsorship_quote: o.sponsorship_quote,
        must_have_skills: o.must_have_skills, nice_to_have_skills: o.nice_to_have_skills, required_industries: o.required_industries || [],
        required_industry_quote: o.required_industry_quote, funding_quote: o.funding_quote, raw_response: o });
    });
    done += batch.length;
    await ctx.progress(`Reading ${done} of ${todo.length} postings…`, { read: done - failed, failed, total: todo.length });
  }
  if (facts.length) await sb('POST', 'job_facts?on_conflict=job_id,content_hash,prompt_version,model', facts, 'resolution=ignore-duplicates');
  await ctx.log(`Read ${facts.length} of ${todo.length}${failed ? ` · ${failed} couldn't be read, will retry next run` : ''}`);
  const comps = await rpc('companies_to_enrich', { p_talent: talent_id });
  let enriched = 0;
  if (comps.length) {
    await ctx.log(`Checking ${comps.length} new companies`, true);
    try {
      const { items } = await apify('linkedin-company', { companies: comps.map(c => c.linkedin_url) }, ctx);
      enriched = await rpc('save_company_details', { p_items: items });
    } catch (e) { await ctx.log(`Company check failed (${e.message}); stage stays unknown for now`); }
  }
  const verified = await rpc('apply_funding_quotes', { p_talent: talent_id });
  await ctx.log(`Companies updated: ${enriched} · funding rounds found in postings: ${verified}`);
  return {
    summary: `${facts.length} postings read${failed ? ` · ${failed} couldn't be read, retrying next run` : ''} · ${comps.length} new companies checked`,
    details: [`Postings already read before (same text): skipped`, `Startup stage: ${verified} from funding rounds quoted in postings, the rest inferred from company data`],
    counts: { read: facts.length, failed, total: todo.length, companies: comps.length, verified_stages: verified },
  };
});
return [{ json: { talent_id, run_id } }];
