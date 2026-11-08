// ---- shared helpers (prepended to every Code node by n8n/build.py) ----
const ENV = $env;
const SB = ENV.SUPABASE_URL, SBK = ENV.SUPABASE_SERVICE_ROLE_KEY;
const H = this.helpers;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();

async function http(opts, tries = 3) {
  let err;
  for (let a = 0; a < tries; a++) {
    try { return await H.httpRequest({ json: true, timeout: 120000, ...opts }); }
    catch (e) {
      const rb = (e.response && (e.response.body || e.response.data)) || (e.cause && e.cause.response && (e.cause.response.data || e.cause.response.body)) || e.description;
      const body = rb ? (typeof rb === 'string' ? rb : JSON.stringify(rb)).slice(0, 300) : '';
      err = new Error(`${e.message}${body ? ' ' + body : ''}`);
      const status = e.httpCode || (e.response && e.response.status);
      if (status && Number(status) >= 400 && Number(status) < 500 && Number(status) !== 429) break;  // don't retry client errors
      await sleep(2000 * (a + 1));
    }
  }
  throw err;
}
const sb = (method, path, body, prefer) => http({
  method, url: `${SB}/rest/v1/${path}`, body,
  headers: { apikey: SBK, Authorization: `Bearer ${SBK}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
});
const rpc = (fn, args) => sb('POST', `rpc/${fn}`, args || {});
const one = async (path) => (await sb('GET', path))[0];

async function stepPatch(run, step, patch) { await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${run}&step=eq.${step}`, patch); }

// Runs one pipeline step: marks it running, keeps a timestamped log, records the result or the error.
async function runStep(run, step, fn) {
  const log = [];
  const ctx = {
    log: async (msg, flush = false) => { log.push({ at: now(), msg }); if (flush) await stepPatch(run, step, { log }); },
    progress: async (summary, counts) => stepPatch(run, step, { summary, log, ...(counts ? { counts } : {}) }),
  };
  await stepPatch(run, step, { status: 'running', started_at: now(), log });
  try {
    const res = await fn(ctx);
    await stepPatch(run, step, { status: 'finished', finished_at: now(), log, summary: res.summary, details: res.details || [], counts: res.counts || {} });
    return res;
  } catch (e) {
    const msg = e.userMessage || e.message;
    log.push({ at: now(), msg: 'ERROR ' + msg });
    await stepPatch(run, step, { status: 'failed', finished_at: now(), log, error: msg, summary: 'Failed · ' + msg });
    await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${run}&status=eq.waiting`, { status: 'skipped', summary: 'Not run' });
    await sb('PATCH', `pipeline_runs?id=eq.${run}`, { status: 'failed', error: msg, finished_at: now() });
    throw e;
  }
}

// Apify: start the run, wait for it, then fetch its dataset (the dataset id is kept so a failed save can re-load it).
async function apify(actor, input, ctx) {
  const tok = ENV.APIFY_TOKEN;
  let run = (await http({ method: 'POST', url: `https://api.apify.com/v2/acts/harvestapi~${actor}/runs?token=${tok}&waitForFinish=60`, body: input, timeout: 90000 })).data;
  const t0 = Date.now();
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() - t0 > 12 * 60 * 1000) throw new Error(`${actor} took longer than 12 minutes`);
    if (ctx) await ctx.log(`Waiting for LinkedIn results (${Math.round((Date.now() - t0) / 1000)}s)`, true);
    run = (await http({ method: 'GET', url: `https://api.apify.com/v2/actor-runs/${run.id}?token=${tok}&waitForFinish=60`, timeout: 90000 })).data;
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`${actor} ended with status ${run.status}`);
  const items = await http({ method: 'GET', url: `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${tok}&clean=true&format=json`, timeout: 120000 });
  return { items, datasetId: run.defaultDatasetId };
}

// OpenRouter: pinned model and provider, fixed seed, strict schema. Same settings as the tested reads.
async function llm(prompt, user) {
  const schema = { type: 'object', properties: prompt.properties, required: Object.keys(prompt.properties), additionalProperties: false };
  const body = {
    model: prompt.model, seed: 42, reasoning: { effort: 'low' }, max_tokens: 2000,
    provider: { order: ['Azure'], allow_fallbacks: false, require_parameters: true },
    messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: prompt.schema_name, strict: true, schema } },
  };
  let err;
  for (let a = 0; a < 3; a++) {
    try {
      const d = await http({ method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions', body, timeout: 240000,
                             headers: { Authorization: `Bearer ${ENV.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' } }, 1);
      return { out: JSON.parse(d.choices[0].message.content), usage: d.usage || {} };
    } catch (e) { err = e; await sleep(3000 * (a + 1)); }
  }
  throw err;
}

const LEVELS = ['internship', 'entry', 'associate', 'mid-senior', 'director', 'executive'];
const yearsLevel = y => y < 1 ? 'entry' : y < 3 ? 'associate' : y < 10 ? 'mid-senior' : 'director';
const py = x => (x === undefined || x === null) ? 'None' : x;   // prompts were tested with Python's text formatting
const pyNum = v => Number.isInteger(v) ? `${v}.0` : `${v}`;
