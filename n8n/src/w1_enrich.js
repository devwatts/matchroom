// W1 step 1 (Enrich): scrape the LinkedIn profile, read it once, save default settings.
const { talent_id, run_id } = $input.first().json;
try {
  await runStep(run_id, 'enrich', async ctx => {
    const talent = await one(`talents?id=eq.${talent_id}&select=linkedin_url,match_days`);
    await ctx.log(
      `Scraping profile ${talent.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}`,
      true,
    );
    const { items } = await apify(
      'linkedin-profile-scraper',
      { profileScraperMode: 'Profile details no email ($4 per 1k)', urls: [talent.linkedin_url] },
      ctx,
      talent_id,
    );
    const p = items && items[0];
    if (!p || !(p.experience || p.headline || p.firstName)) {
      const e = new Error('no profile data');
      e.userMessage =
        "The profile is private or doesn't exist: LinkedIn returned no data for this link.";
      throw e;
    }
    await ctx.log(`Profile received · ${(p.experience || []).length} positions`, true);
    const { years, text, studyCount } = talentText(p);
    // "unchanged" is judged on the text the model reads, not the raw scrape (logo URLs change on every scrape)
    const saved = await rpc('save_profile', {
      p_talent: talent_id,
      p_profile: p,
      p_read_text: text,
    });
    await ctx.note({ saved: true });
    await ctx.log(
      `Years computed from dates: ${years}${studyCount ? ` · ${studyCount} position${studyCount > 1 ? 's' : ''} during studies not counted` : ''}`,
    );
    let fact;
    if (saved.fact_exists) {
      fact = await one(
        `talent_facts?talent_id=eq.${talent_id}&profile_hash=eq.${saved.hash}&order=created_at.desc&limit=1`,
      );
      await ctx.log('Profile unchanged since the last read · using the stored read');
    } else {
      const { out } = await llm(PROMPTS.talent, text);
      fact = (
        await sb(
          'POST',
          'talent_facts?on_conflict=talent_id,profile_hash,prompt_version,model',
          {
            talent_id,
            profile_hash: saved.hash,
            prompt_version: PROMPTS.talent.version,
            model: PROMPTS.talent.model,
            years_computed: years,
            level: out.level,
            level_evidence: out.level_evidence,
            role_family: out.title_family,
            plain_title: out.plain_current_title,
            search_titles: searchTitles(out),
            skills: out.skills,
            industries: out.industries || [],
            raw_response: out,
          },
          'return=representation,resolution=merge-duplicates',
        )
      )[0]; // safe to retry after a lost response
      await ctx.log(`Profile read · level ${out.level} · ${out.title_family.replace(/_/g, ' ')}`);
    }
    // defaults: search titles and skills, unless the recruiter already set them
    const st = await one(`talent_settings?talent_id=eq.${talent_id}`);
    const skills = [];
    for (const s of fact.skills || [])
      if (!skills.some(x => x.name.toLowerCase() === s.name.toLowerCase()))
        skills.push({ name: s.name, source: s.evidence === 'work_history' ? 'work' : 'listed' });
    for (const s of p.skills || [])
      if (s.name && !skills.some(x => x.name.toLowerCase() === s.name.toLowerCase()))
        skills.push({ name: s.name, source: 'listed' });
    const patch = {};
    if (!st.search_titles || !st.search_titles.length) patch.search_titles = fact.search_titles;
    if (!st.skills || !st.skills.length) patch.skills = skills;
    if (Object.keys(patch).length)
      await sb('PATCH', `talent_settings?talent_id=eq.${talent_id}`, {
        ...patch,
        updated_at: now(),
      });
    await sb('PATCH', `talents?id=eq.${talent_id}`, {
      status: 'active',
      match_until: new Date(Date.now() + talent.match_days * 86400000).toISOString(),
      updated_at: now(),
    });
    await ctx.log('Saved default settings');
    return {
      summary: `${(p.experience || []).length} positions · ${years} years · ${fact.role_family.replace(/_/g, ' ')}, ${fact.level}`,
      details: [
        `Search titles: ${(patch.search_titles || st.search_titles).join(', ')}`,
        `${skills.length} skills, ${skills.filter(s => s.source === 'work').length} used at work`,
        `Industries worked in: ${(fact.industries || []).map(x => x.replace(/_/g, ' ')).join(', ') || 'not clear'}`,
      ],
      counts: { positions: (p.experience || []).length, skills: skills.length },
    };
  });
} catch (e) {
  await sb('PATCH', `talents?id=eq.${talent_id}`, { status: 'failed', updated_at: now() }); // shows Retry in the frontend
  throw e;
}
return [{ json: { talent_id, run_id } }];
