// ---- shared helpers (prepended to every Code node by n8n/build.py) ----
const ENV = $env;
const SB = ENV.SUPABASE_URL,
  SBK = ENV.SUPABASE_SERVICE_ROLE_KEY;
const H = this.helpers;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();

// Retries network errors, 429 and 5xx; never 4xx. Pass retry: false for a request that must not run twice
// (starting an Apify actor: if the run starts but the response is lost, a retry would pay for a second run).
async function http(opts, tries = 3) {
  const { retry, ...o } = opts;
  if (retry === false) tries = 1;
  let err;
  for (let a = 0; a < tries; a++) {
    try {
      return await H.httpRequest({ json: true, timeout: 120000, ...o });
    } catch (e) {
      const rb =
        (e.response && (e.response.body || e.response.data)) ||
        (e.cause && e.cause.response && (e.cause.response.data || e.cause.response.body)) ||
        e.description;
      const body = rb ? (typeof rb === 'string' ? rb : JSON.stringify(rb)).slice(0, 300) : '';
      const status = e.httpCode || (e.response && e.response.status);
      err = Object.assign(new Error(`${e.message}${body ? ' ' + body : ''}`), {
        status: status ? Number(status) : null,
      });
      if (status && Number(status) >= 400 && Number(status) < 500 && Number(status) !== 429)
        break; // don't retry client errors
      await sleep(2000 * (a + 1));
    }
  }
  throw err;
}
const sb = (method, path, body, prefer) =>
  http({
    method,
    url: `${SB}/rest/v1/${path}`,
    body,
    headers: {
      apikey: SBK,
      Authorization: `Bearer ${SBK}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
  });
const rpc = (fn, args) => sb('POST', `rpc/${fn}`, args || {});
const one = async path => (await sb('GET', path))[0];

async function stepPatch(run, step, patch) {
  await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${run}&step=eq.${step}`, patch);
}

// Runs one pipeline step: marks it running, keeps a timestamped log, records the result or the error.
// Counts are merged, so the Apify run id saved mid-step survives later progress updates.
async function runStep(run, step, fn) {
  const log = [],
    counts = {};
  const ctx = {
    run,
    step,
    log: async (msg, flush = false) => {
      log.push({ at: now(), msg });
      if (flush) await stepPatch(run, step, { log });
    },
    progress: async (summary, c) => {
      Object.assign(counts, c || {});
      await stepPatch(run, step, { summary, log, counts });
    },
    note: async c => {
      Object.assign(counts, c);
      await stepPatch(run, step, { counts });
    },
  };
  await stepPatch(run, step, { status: 'running', started_at: now(), log });
  try {
    const res = await fn(ctx);
    await stepPatch(run, step, {
      status: 'finished',
      finished_at: now(),
      log,
      summary: res.summary,
      details: res.details || [],
      counts: { ...counts, ...(res.counts || {}) },
    });
    return res;
  } catch (e) {
    const msg = e.userMessage || e.message;
    log.push({ at: now(), msg: 'ERROR ' + msg });
    await stepPatch(run, step, {
      status: 'failed',
      finished_at: now(),
      log,
      error: msg,
      summary: 'Failed · ' + msg,
    });
    await sb('PATCH', `pipeline_run_steps?pipeline_run_id=eq.${run}&status=eq.waiting`, {
      status: 'skipped',
      summary: 'Not run',
    });
    await sb('PATCH', `pipeline_runs?id=eq.${run}`, {
      status: 'failed',
      error: msg,
      finished_at: now(),
    });
    throw e;
  }
}

// Apify. The run id is saved on the step as soon as the run starts. If an earlier attempt for this talent
// scraped the same input but failed before saving (within 6 hours), that run's dataset is loaded instead of
// paying for a new scrape. Call ctx.note({ saved: true }) once the items are stored.
const hashOf = s => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
};
async function apify(actor, input, ctx, talentId) {
  const tok = ENV.APIFY_TOKEN,
    base = 'https://api.apify.com/v2';
  const inputHash = hashOf(actor + JSON.stringify(input));
  const getRun = async id =>
    (
      await http({
        method: 'GET',
        url: `${base}/actor-runs/${id}?token=${tok}&waitForFinish=60`,
        timeout: 90000,
      })
    ).data;
  let run = null;
  const prev = talentId
    ? await rpc('apify_run_to_reuse', {
        p_talent: talentId,
        p_step: ctx.step,
        p_input_hash: inputHash,
      })
    : null;
  if (prev && prev.apify_run_id) {
    try {
      run = await getRun(prev.apify_run_id);
    } catch (e) {
      run = null;
    }
    if (run && ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) run = null;
    if (run)
      await ctx.log(`Reusing the LinkedIn results from the earlier attempt (${actor})`, true);
  }
  if (!run)
    run = (
      await http({
        method: 'POST',
        url: `${base}/acts/harvestapi~${actor}/runs?token=${tok}&waitForFinish=60`,
        body: input,
        timeout: 90000,
        retry: false,
      })
    ).data;
  await ctx.note({
    apify_run_id: run.id,
    apify_dataset_id: run.defaultDatasetId,
    apify_input_hash: inputHash,
  });
  const t0 = Date.now();
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() - t0 > 12 * 60 * 1000) throw new Error(`${actor} took longer than 12 minutes`);
    await ctx.log(
      `Waiting for LinkedIn results (${Math.round((Date.now() - t0) / 1000)}s)`,
      true,
    );
    run = await getRun(run.id);
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`${actor} ended with status ${run.status}`);
  // page through the dataset so no item is dropped, however many there are
  const items = [],
    page = 1000;
  for (let offset = 0; ; offset += page) {
    const chunk = await http({
      method: 'GET',
      url: `${base}/datasets/${run.defaultDatasetId}/items?token=${tok}&clean=true&format=json&offset=${offset}&limit=${page}`,
      timeout: 120000,
    });
    items.push(...chunk);
    if (chunk.length < page) break;
  }
  return { items, datasetId: run.defaultDatasetId };
}

// OpenRouter: pinned model and provider, fixed seed, strict schema. Same settings as the tested reads.
// The seed makes answers more repeatable, not guaranteed identical; repeatability comes from storing each read
// (with prompt version and model) and reusing it, never asking twice for the same text.
async function llm(prompt, user) {
  const schema = {
    type: 'object',
    properties: prompt.properties,
    required: Object.keys(prompt.properties),
    additionalProperties: false,
  };
  const body = {
    model: prompt.model,
    seed: 42,
    reasoning: { effort: 'low' },
    max_tokens: prompt.max_tokens || 2000,
    provider: { order: ['Azure'], allow_fallbacks: false, require_parameters: true },
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: prompt.schema_name, strict: true, schema },
    },
  };
  let err;
  for (let a = 0; a < 3; a++) {
    try {
      const d = await http(
        {
          method: 'POST',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          body,
          timeout: 240000,
          headers: {
            Authorization: `Bearer ${ENV.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
        1,
      );
      const out = JSON.parse(d.choices[0].message.content); // throws on malformed JSON -> retried
      const missing = Object.keys(prompt.properties).filter(k => !(k in out));
      if (missing.length) throw new Error(`model answer is missing ${missing.join(', ')}`);
      return { out, usage: d.usage || {} };
    } catch (e) {
      err = e;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) break; // a bad request won't get better
      await sleep(3000 * (a + 1));
    }
  }
  throw err;
}

// Pair model answers with what was asked by name, never by position: each asked name takes the answer whose
// `field` names it (ignoring case and spacing), written back with the exact asked spelling. Answers naming
// nothing that was asked are dropped; asked names with no answer are simply not saved and are retried next run.
function byName(asked, answers, field) {
  const key = x =>
    String(x || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const want = new Map(asked.map(a => [key(a), a]));
  const out = [];
  for (const ans of answers || []) {
    const k = key(ans[field]);
    if (want.has(k)) {
      out.push({ ...ans, [field]: want.get(k) });
      want.delete(k);
    }
  }
  return out;
}

const LEVELS = ['internship', 'entry', 'associate', 'mid-senior', 'director', 'executive'];
const yearsLevel = y =>
  y < 1 ? 'entry' : y < 3 ? 'associate' : y < 10 ? 'mid-senior' : 'director';
const py = x => (x === undefined || x === null ? 'None' : x); // prompts were tested with Python's text formatting
const pyNum = v => (Number.isInteger(v) ? `${v}.0` : `${v}`);
