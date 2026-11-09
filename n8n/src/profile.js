// ---- profile helpers for the Enrich step (prepended by n8n/build.py) ----
// Years of experience are computed from position dates, never asked of the model.
// Positions held while studying count for skills but not for years or industries. A position is
// "during studies" when it is an internship, or when it is not marked full-time, lies entirely inside
// an education period and starts before the first substantial job (full-time, or longer than 12 months).
const MON = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
const NOW = [new Date().getUTCFullYear(), new Date().getUTCMonth() + 1];
const SUBSTANTIAL_MONTHS = 12;
const ym = (d, endOfYear = false) =>
  !d || d.text === 'Present' || !('year' in d) || d.year == null
    ? NOW
    : [d.year, MON[d.month] || (endOfYear ? 12 : 1)];
const months = ([y, m]) => y * 12 + m;
function mergedYears(ps) {
  const iv = ps
    .map(([a, b]) => [months(a), months(b)])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let total = 0,
    cur = null;
  for (const [a, b] of iv) {
    if (cur && a <= cur[1] + 1) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return Math.round((total / 12) * 100) / 100;
}
function studyFlags(p) {
  const exp = p.experience || [];
  const type = e => (e.employmentType || '').toLowerCase();
  const span = e => [months(ym(e.startDate)), months(ym(e.endDate))];
  const study = (p.education || [])
    .filter(e => e.startDate && e.startDate.year && e.endDate && e.endDate.year)
    .map(e => [months(ym(e.startDate)), months(ym(e.endDate, true))]);
  const substantial = exp.filter(
    e =>
      type(e) !== 'internship' &&
      (type(e) === 'full-time' || span(e)[1] - span(e)[0] + 1 > SUBSTANTIAL_MONTHS),
  );
  const careerStart = substantial.length
    ? Math.min(...substantial.map(e => span(e)[0]))
    : Infinity;
  return exp.map(e => {
    if (type(e) === 'internship') return true;
    if (type(e) === 'full-time') return false;
    const [a, b] = span(e);
    return a < careerStart && study.some(([s, t]) => a >= s && b <= t);
  });
}
function talentText(p) {
  const exp = p.experience || [];
  const flags = studyFlags(p);
  const years = mergedYears(
    exp.filter((e, i) => !flags[i]).map(e => [ym(e.startDate), ym(e.endDate)]),
  );
  const pos = exp
    .map(
      (e, i) =>
        `- ${py(e.position)} at ${py(e.companyName)} (${py(e.employmentType)}), ${py((e.startDate || {}).text)} to ${py((e.endDate || {}).text)}${flags[i] ? ' [during studies]' : ''}: ${(e.description || '').slice(0, 900)}`,
    )
    .join('\n');
  const cur = ((p.currentPosition || [{}])[0] || {}).position || '';
  return {
    years,
    studyCount: flags.filter(Boolean).length,
    text: `Current title: ${cur}\nFull-time years (computed): ${pyNum(years)}\nPositions:\n${pos}\nListed skills: ${(p.skills || []).map(s => py(s.name)).join(', ')}`,
  };
}
const BAD =
  /\b(co-?founder|founder|ceo|cto|coo|cfo|cmo|cpo|chief\s+\w+\s+officer|owner|president)\b/gi;
function searchTitles(t) {
  const out = [];
  for (const raw of [t.plain_current_title, ...(t.related_titles || [])]) {
    const x = (raw || '')
      .replace(BAD, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[\s\-&,/|]+|[\s\-&,/|]+$/g, '');
    if (x.split(' ').length >= 2 && !out.some(o => o.toLowerCase() === x.toLowerCase()))
      out.push(x);
  }
  return out.slice(0, 4);
}
