// W2 step 3 (Filter): read each new posting once, 5 at a time, saving after every batch so a crash
// loses at most one batch (the next run reads only what is still unread). Then add new skill terms to
// the skill dictionary, judge the talent's new skills against their work history, and check companies
// for startup stage.
const { talent_id, run_id } = $input.first().json;
await runStep(run_id, 'filter', async ctx => {
  const todo = await rpc('jobs_to_read', { p_talent: talent_id });
  await ctx.log(`Reading ${todo.length} postings, 5 at a time`, true);
  let saved = 0,
    failed = 0,
    done = 0;
  const jobText = j =>
    `Title: ${py(j.title)}\nCompany: ${py(j.company_name)} (${py(j.employee_count)} employees)\nCompany description: ${j.company_description || ''}\nLinkedIn level: ${j.experience_level || 'not given'}\n\n${j.description || ''}`;
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    const res = await Promise.allSettled(batch.map(j => llm(PROMPTS.job, jobText(j))));
    const facts = [];
    res.forEach((r, k) => {
      const j = batch[k];
      if (r.status !== 'fulfilled') {
        failed++;
        return;
      }
      const o = r.value.out;
      facts.push({
        job_id: j.job_id,
        content_hash: j.content_hash,
        prompt_version: PROMPTS.job.version,
        model: PROMPTS.job.model,
        agency: o.agency,
        agency_quote: o.agency_quote,
        named_employer: o.named_employer,
        role_family: o.title_family,
        level: o.level,
        level_quote: o.level_quote,
        above_senior: o.above_senior,
        experience_paths: o.experience_paths,
        sponsorship: o.sponsorship,
        sponsorship_quote: o.sponsorship_quote,
        must_have_skills: o.must_have_skills,
        nice_to_have_skills: o.nice_to_have_skills,
        required_industries: o.required_industries || [],
        required_industry_quote: o.required_industry_quote,
        funding_quote: o.funding_quote,
        work_countries: o.work_countries || [],
        work_location_quote: o.work_location_quote || '',
        industry_requirement_strength: o.industry_requirement_strength || null,
        industry_alternatives: o.industry_alternatives || [],
        raw_response: o,
      });
    });
    if (facts.length)
      await sb(
        'POST',
        'job_facts?on_conflict=job_id,content_hash,prompt_version,model',
        facts,
        'resolution=ignore-duplicates',
      );
    saved += facts.length;
    done += batch.length;
    await ctx.progress(`Reading ${done} of ${todo.length} postings…`, {
      read: saved,
      failed,
      total: todo.length,
    });
  }
  await ctx.log(
    `Read ${saved} of ${todo.length}${failed ? ` · ${failed} couldn't be read, will retry next run` : ''}`,
  );

  // skill dictionary: each new term is read once and kept (standard name, what it counts as, too general or not)
  const terms = (await rpc('skill_terms_missing', { p_talent: talent_id })).map(r => r.term);
  let added = 0;
  if (terms.length) {
    await ctx.log(`Adding ${terms.length} new skill terms to the skill dictionary`, true);
    const batches = [];
    for (let i = 0; i < terms.length; i += 50) batches.push(terms.slice(i, i + 50));
    for (let w = 0; w < batches.length; w += 6) {
      const known = (await rpc('skill_terms_known', { p_limit: 400 })).map(r => r.canonical);
      const res = await Promise.allSettled(
        batches
          .slice(w, w + 6)
          .map(b =>
            llm(
              PROMPTS.skills,
              'Existing standard names: ' + known.join(', ') + '\n\nTerms:\n' + b.join('\n'),
            ).then(({ out }) => byName(b, out.terms, 'term')),
          ),
      );
      for (const r of res) {
        if (r.status === 'fulfilled')
          added += await rpc('save_skill_terms', {
            p_items: r.value,
            p_prompt_version: PROMPTS.skills.version,
            p_model: PROMPTS.skills.model,
          });
        else
          await ctx.log(
            `A skill dictionary batch failed (${r.reason.message}); those terms match by name until the next run`,
          );
      }
    }
  }

  // skill judgment: each skill this talent's jobs ask for is judged once against the work history
  // (has / implied / weak / none), in batches that see the answers already given, so related skills agree
  const toJudge = await rpc('talent_skills_to_judge', { p_talent: talent_id });
  let judged = 0;
  if (toJudge.length) {
    await ctx.log(
      `Checking ${toJudge.length} skills against ${(await one(`talents?id=eq.${talent_id}&select=name`)).name || 'the talent'}'s work history`,
      true,
    );
    const prof = (await one(`talents?id=eq.${talent_id}&select=profile_raw`)).profile_raw;
    const { text } = talentText(prof);
    const earlier =
      (await sb(
        'GET',
        `talent_skill_evidence_current?talent_id=eq.${talent_id}&select=display,status`,
      )) || [];
    const shown = earlier.map(e => `- ${e.display}: ${e.status}`);
    const today = new Date().toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const batches = [];
    for (let i = 0; i < toJudge.length; i += 40) batches.push(toJudge.slice(i, i + 40));
    const waves = shown.length ? [] : [batches.slice(0, 1)];
    for (let i = shown.length ? 0 : 1; i < batches.length; i += 6)
      waves.push(batches.slice(i, i + 6));
    for (const wave of waves) {
      const prior = shown.length
        ? `\n\nEarlier answers for this candidate:\n${shown.join('\n')}`
        : '';
      const res = await Promise.allSettled(
        wave.map(b =>
          llm(
            PROMPTS.evidence,
            `Today: ${today}\n\nCandidate:\n${text}${prior}\n\nSkills:\n${b.map(x => `- ${x.display}`).join('\n')}`,
          ).then(({ out }) =>
            byName(
              b.map(x => x.display),
              out.skills,
              'skill',
            ).map(o => {
              const m = b.find(x => x.display === o.skill);
              return {
                skill: m.skill,
                display: m.display,
                status: o.status,
                evidence: o.evidence,
              };
            }),
          ),
        ),
      );
      for (const r of res) {
        if (r.status !== 'fulfilled') {
          await ctx.log(
            `A skill check batch failed (${r.reason.message}); those skills are checked next run`,
          );
          continue;
        }
        judged += await rpc('save_talent_skill_evidence', {
          p_talent: talent_id,
          p_items: r.value,
          p_prompt_version: PROMPTS.evidence.version,
          p_model: PROMPTS.evidence.model,
        });
        r.value.forEach(x => shown.push(`- ${x.display}: ${x.status}`));
      }
    }
  }

  const comps = await rpc('companies_to_enrich', { p_talent: talent_id });
  let enriched = 0,
    compFailed = false;
  if (comps.length) {
    await ctx.log(`Checking ${comps.length} new companies`, true);
    try {
      const { items } = await apify(
        'linkedin-company',
        { companies: comps.map(c => c.linkedin_url) },
        ctx,
        talent_id,
      );
      enriched = await rpc('save_company_details', { p_items: items });
      await ctx.note({ saved: true });
    } catch (e) {
      compFailed = true;
      await ctx.log(
        `Company check failed (${e.message}); stage stays unknown for now, retried next run`,
      );
    }
  }
  const verified = await rpc('apply_funding_quotes', { p_talent: talent_id });
  await ctx.log(
    `Skill terms added: ${added} · skills checked: ${judged} · companies updated: ${enriched} · funding rounds found in postings: ${verified}`,
  );
  return {
    summary: `${saved} postings read${failed ? ` · ${failed} couldn't be read, retrying next run` : ''} · ${compFailed ? `company check failed for ${comps.length}, retrying next run` : `${comps.length} new companies checked`}`,
    details: [
      `Postings already read before (same text): skipped`,
      `Skill dictionary: ${added} new terms`,
      `Skills checked against the work history: ${judged}`,
      `Startup stage: ${verified} from funding rounds quoted in postings, the rest inferred from company data`,
    ],
    counts: {
      read: saved,
      failed,
      total: todo.length,
      companies: comps.length,
      companies_updated: enriched,
      companies_failed: compFailed ? comps.length : 0,
      partial: failed > 0 || compFailed,
      verified_stages: verified,
      skill_terms_added: added,
      skills_judged: judged,
    },
  };
});
return [{ json: { talent_id, run_id } }];
