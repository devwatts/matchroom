// W1 step 1 (Enrich): scrape the LinkedIn profile, read it once, save default settings.
const { talent_id, run_id } = $input.first().json;
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const NOW = [new Date().getUTCFullYear(), new Date().getUTCMonth() + 1];
const ym = d => (!d || d.text === 'Present' || !('year' in d) || d.year == null) ? NOW : [d.year, MON[d.month] || 1];
function mergedYears(ps) {
  const iv = ps.map(([a, b]) => [a[0] * 12 + a[1], b[0] * 12 + b[1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let total = 0, cur = null;
  for (const [a, b] of iv) { if (cur && a <= cur[1] + 1) cur[1] = Math.max(cur[1], b); else { if (cur) total += cur[1] - cur[0] + 1; cur = [a, b]; } }
  if (cur) total += cur[1] - cur[0] + 1;
  return Math.round(total / 12 * 100) / 100;
}
function talentText(p) {
  const exp = p.experience || [];
  const years = mergedYears(exp.filter(e => (e.employmentType || '').toLowerCase() !== 'internship').map(e => [ym(e.startDate), ym(e.endDate)]));
  const pos = exp.map(e => `- ${py(e.position)} at ${py(e.companyName)} (${py(e.employmentType)}), ${py((e.startDate || {}).text)} to ${py((e.endDate || {}).text)}: ${(e.description || '').slice(0, 900)}`).join('\n');
  const cur = ((p.currentPosition || [{}])[0] || {}).position || '';
  return { years, text: `Current title: ${cur}\nFull-time years (computed): ${pyNum(years)}\nPositions:\n${pos}\nListed skills: ${(p.skills || []).map(s => py(s.name)).join(', ')}` };
}
const BAD = /\b(co-?founder|founder|ceo|cto|coo|cfo|cmo|cpo|chief\s+\w+\s+officer|owner|president)\b/gi;
function searchTitles(t) {
  const out = [];
  for (const raw of [t.plain_current_title, ...(t.related_titles || [])]) {
    const x = (raw || '').replace(BAD, '').replace(/\s+/g, ' ').trim().replace(/^[\s\-&,/|]+|[\s\-&,/|]+$/g, '');
    if (x.split(' ').length >= 2 && !out.some(o => o.toLowerCase() === x.toLowerCase())) out.push(x);
  }
  return out.slice(0, 4);
}

try {
await runStep(run_id, 'enrich', async ctx => {
  const talent = await one(`talents?id=eq.${talent_id}&select=linkedin_url,match_days`);
  await ctx.log(`Scraping profile ${talent.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}`, true);
  const { items } = await apify('linkedin-profile-scraper', { profileScraperMode: 'Profile details no email ($4 per 1k)', urls: [talent.linkedin_url] }, ctx);
  const p = items && items[0];
  if (!p || !(p.experience || p.headline || p.firstName)) {
    const e = new Error('no profile data'); e.userMessage = "The profile is private or doesn't exist: LinkedIn returned no data for this link."; throw e;
  }
  await ctx.log(`Profile received · ${(p.experience || []).length} positions`, true);
  const saved = await rpc('save_profile', { p_talent: talent_id, p_profile: p });
  const { years, text } = talentText(p);
  await ctx.log(`Years computed from dates: ${years}`);
  let fact;
  if (saved.fact_exists) {
    fact = await one(`talent_facts?talent_id=eq.${talent_id}&profile_hash=eq.${saved.hash}&order=created_at.desc&limit=1`);
    await ctx.log('Profile unchanged since the last read · using the stored read');
  } else {
    const { out } = await llm(PROMPTS.talent, text);
    fact = (await sb('POST', 'talent_facts', {
      talent_id, profile_hash: saved.hash, prompt_version: PROMPTS.talent.version, model: PROMPTS.talent.model, years_computed: years,
      level: out.level, level_evidence: out.level_evidence, role_family: out.title_family, plain_title: out.plain_current_title,
      search_titles: searchTitles(out), skills: out.skills, industries: out.industries || [], raw_response: out,
    }, 'return=representation'))[0];
    await ctx.log(`Profile read · level ${out.level} · ${out.title_family.replace(/_/g, ' ')}`);
  }
  // defaults: search titles and skills, unless the recruiter already set them
  const st = await one(`talent_settings?talent_id=eq.${talent_id}`);
  const skills = [];
  for (const s of fact.skills || []) if (!skills.some(x => x.name.toLowerCase() === s.name.toLowerCase())) skills.push({ name: s.name, source: s.evidence === 'work_history' ? 'work' : 'listed' });
  for (const s of p.skills || []) if (s.name && !skills.some(x => x.name.toLowerCase() === s.name.toLowerCase())) skills.push({ name: s.name, source: 'listed' });
  const patch = {};
  if (!st.search_titles || !st.search_titles.length) patch.search_titles = fact.search_titles;
  if (!st.skills || !st.skills.length) patch.skills = skills;
  if (Object.keys(patch).length) await sb('PATCH', `talent_settings?talent_id=eq.${talent_id}`, { ...patch, updated_at: now() });
  await sb('PATCH', `talents?id=eq.${talent_id}`, { status: 'active', match_until: new Date(Date.now() + talent.match_days * 86400000).toISOString(), updated_at: now() });
  await ctx.log('Saved default settings');
  return {
    summary: `${(p.experience || []).length} positions · ${years} years · ${fact.role_family.replace(/_/g, ' ')}, ${fact.level}`,
    details: [`Search titles: ${(patch.search_titles || st.search_titles).join(', ')}`,
              `${skills.length} skills, ${skills.filter(s => s.source === 'work').length} used at work`,
              `Industries worked in: ${(fact.industries || []).map(x => x.replace(/_/g, ' ')).join(', ') || 'not clear'}`],
    counts: { positions: (p.experience || []).length, skills: skills.length },
  };
});
} catch (e) {
  await sb('PATCH', `talents?id=eq.${talent_id}`, { status: 'failed', updated_at: now() });   // shows Retry in the frontend
  throw e;
}
return [{ json: { talent_id, run_id } }];
