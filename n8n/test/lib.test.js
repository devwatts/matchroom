// Failure tests for the shared n8n helpers (n8n/src/lib.js), run with: node n8n/test/lib.test.js
// lib.js is loaded exactly as build.py prepends it to a Code node, with this.helpers.httpRequest replaced by a
// fake network that injects the failures (lost responses, 429, malformed JSON, big datasets, reordered answers).
const fs = require('fs'),
  path = require('path'),
  assert = require('assert');
const LIB = fs.readFileSync(path.join(__dirname, '../src/lib.js'), 'utf8');
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

// run `body` with lib.js in scope; `route(opts)` plays the network and returns a value or throws
async function withLib(route, body) {
  const calls = [];
  const helpers = {
    httpRequest: async opts => {
      calls.push(opts);
      return route(opts, calls);
    },
  };
  const env = {
    SUPABASE_URL: 'https://sb.test',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    APIFY_TOKEN: 't',
    OPENROUTER_API_KEY: 'o',
  };
  // no real waiting between retries
  const src = LIB.replace(
    'const sleep = ms => new Promise(r => setTimeout(r, ms));',
    'const sleep = async () => {};',
  );
  const res = await new AsyncFn('$env', src + '\n' + body).call({ helpers }, env);
  return { res, calls };
}
const httpErr = (status, msg = 'fail') =>
  Object.assign(new Error(msg), { httpCode: String(status) });
const netErr = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const PROMPT = `{ model: 'm', system: 's', schema_name: 'x', properties: { a: { type: 'string' }, b: { type: 'string' } } }`;
const llmOk = content => ({ choices: [{ message: { content } }], usage: { total_tokens: 10 } });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Apify start is never retried when the response is lost (no second paid run)', async () => {
  let starts = 0;
  await assert.rejects(
    withLib(o => {
      if (o.method === 'POST' && o.url.includes('/acts/')) {
        starts++;
        throw netErr();
      }
      if (o.url.includes('apify_run_to_reuse')) return null;
      return [];
    }, `await apify('linkedin-job-search', {q:1}, { step: 'discover', log: async () => {}, note: async () => {} }, 'tal');`),
  );
  assert.strictEqual(starts, 1);
});

test('Apify run id is saved before polling, and a dataset bigger than one page is read in full', async () => {
  const notes = [];
  const N = 2500;
  const { res, calls } = await withLib(
    o => {
      if (o.url.includes('apify_run_to_reuse')) return null;
      if (o.method === 'POST' && o.url.includes('/acts/'))
        return { data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' } };
      if (o.url.includes('/actor-runs/run1'))
        return { data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } };
      if (o.url.includes('/datasets/ds1/items')) {
        const off = Number(/offset=(\d+)/.exec(o.url)[1]),
          lim = Number(/limit=(\d+)/.exec(o.url)[1]);
        return Array.from({ length: Math.max(0, Math.min(lim, N - off)) }, (_, i) => ({
          i: off + i,
        }));
      }
      throw new Error('unexpected ' + o.url);
    },
    `const notes = []; const ctx = { step: 'discover', log: async () => {}, note: async c => notes.push({ ...c, at: Date.now() }) };
      const r = await apify('linkedin-job-search', {q:1}, ctx, 'tal'); return { n: r.items.length, uniq: new Set(r.items.map(x => x.i)).size, notes };`,
  );
  assert.strictEqual(res.n, N);
  assert.strictEqual(res.uniq, N);
  assert.strictEqual(res.notes[0].apify_run_id, 'run1');
  const firstPoll = calls.findIndex(c => c.url.includes('/actor-runs/'));
  assert.ok(firstPoll > 0, 'polled after start');
  assert.strictEqual(calls.filter(c => c.url.includes('/items')).length, 3); // 1000 + 1000 + 500
});

test('After a failed save, the next attempt reuses the finished Apify run instead of starting a new one', async () => {
  let starts = 0;
  const { res } = await withLib(o => {
    if (o.url.includes('apify_run_to_reuse'))
      return { apify_run_id: 'old', apify_dataset_id: 'dsold' };
    if (o.method === 'POST' && o.url.includes('/acts/')) {
      starts++;
      return { data: { id: 'new', status: 'SUCCEEDED', defaultDatasetId: 'dsnew' } };
    }
    if (o.url.includes('/actor-runs/old'))
      return { data: { id: 'old', status: 'SUCCEEDED', defaultDatasetId: 'dsold' } };
    if (o.url.includes('/datasets/dsold/items'))
      return o.url.includes('offset=0') ? [{ a: 1 }, { a: 2 }] : [];
    throw new Error('unexpected ' + o.url);
  }, `const r = await apify('linkedin-job-search', {q:1}, { step: 'discover', log: async () => {}, note: async () => {} }, 'tal'); return r;`);
  assert.strictEqual(starts, 0);
  assert.strictEqual(res.datasetId, 'dsold');
  assert.strictEqual(res.items.length, 2);
});

test('A reusable run that had failed on Apify is ignored and a fresh run is started', async () => {
  let starts = 0;
  await withLib(o => {
    if (o.url.includes('apify_run_to_reuse')) return { apify_run_id: 'old' };
    if (o.url.includes('/actor-runs/old'))
      return { data: { id: 'old', status: 'FAILED', defaultDatasetId: 'dsold' } };
    if (o.method === 'POST' && o.url.includes('/acts/')) {
      starts++;
      return { data: { id: 'new', status: 'SUCCEEDED', defaultDatasetId: 'dsnew' } };
    }
    if (o.url.includes('/datasets/dsnew/items')) return [];
    throw new Error('unexpected ' + o.url);
  }, `await apify('linkedin-job-search', {q:1}, { step: 'discover', log: async () => {}, note: async () => {} }, 'tal');`);
  assert.strictEqual(starts, 1);
});

test('OpenRouter 429 is retried and then succeeds', async () => {
  let n = 0;
  const { res } = await withLib(() => {
    n++;
    if (n <= 2) throw httpErr(429, 'rate limited');
    return llmOk('{"a":"1","b":"2"}');
  }, `return (await llm(${PROMPT}, 'hi')).out;`);
  assert.deepStrictEqual(res, { a: '1', b: '2' });
  assert.strictEqual(n, 3);
});

test('Malformed JSON and an answer missing a schema field are retried', async () => {
  const answers = ['{"a": "1", ', '{"a":"1"}', '{"a":"1","b":"2"}'];
  let n = 0;
  const { res } = await withLib(
    () => llmOk(answers[n++]),
    `return (await llm(${PROMPT}, 'hi')).out;`,
  );
  assert.deepStrictEqual(res, { a: '1', b: '2' });
  assert.strictEqual(n, 3);
});

test('Malformed output every time fails loudly instead of saving garbage', async () => {
  await assert.rejects(
    withLib(() => llmOk('not json'), `return (await llm(${PROMPT}, 'hi')).out;`),
  );
});

test('A 400 from OpenRouter is not retried', async () => {
  let n = 0;
  await assert.rejects(
    withLib(() => {
      n++;
      throw httpErr(400, 'bad request');
    }, `return (await llm(${PROMPT}, 'hi')).out;`),
  );
  assert.strictEqual(n, 1);
});

test('Supabase 5xx and network errors are retried; 4xx are not', async () => {
  let n = 0;
  const { res } = await withLib(() => {
    n++;
    if (n === 1) throw netErr();
    if (n === 2) throw httpErr(503);
    return [{ ok: 1 }];
  }, `return await one('jobs?select=x');`);
  assert.deepStrictEqual(res, { ok: 1 });
  assert.strictEqual(n, 3);
  n = 0;
  await assert.rejects(
    withLib(() => {
      n++;
      throw httpErr(409, 'duplicate key');
    }, `await sb('POST', 'jobs', {});`),
  );
  assert.strictEqual(n, 1);
});

test('Model answers are paired by name, not position (reordered, renamed and extra answers)', async () => {
  const { res } = await withLib(
    () => null,
    `return byName(['SQL', 'Go', 'Docker'],
      [{ skill: 'docker', status: 'has' }, { skill: 'Kotlin', status: 'has' }, { skill: 'sql ', status: 'none' }, { skill: 'SQL', status: 'has' }], 'skill');`,
  );
  assert.deepStrictEqual(res, [
    { skill: 'Docker', status: 'has' },
    { skill: 'SQL', status: 'none' },
  ]); // Go unanswered -> retried next run
});

test('runStep keeps counts saved mid-step (Apify run id) in the final counts, and marks failures', async () => {
  const patches = [];
  const { res } = await withLib(
    o => {
      if (o.method === 'PATCH') patches.push({ url: o.url, body: o.body });
      return [];
    },
    `await runStep('r1', 'discover', async ctx => { await ctx.note({ apify_run_id: 'run1' }); await ctx.progress('half', { read: 3 }); return { summary: 'ok', counts: { saved: true } }; });
     try { await runStep('r1', 'filter', async () => { throw new Error('boom'); }); } catch (e) {} return true;`,
  );
  const fin = patches.find(p => p.body.status === 'finished');
  assert.deepStrictEqual(fin.body.counts, { apify_run_id: 'run1', read: 3, saved: true });
  assert.ok(patches.some(p => p.body.status === 'failed' && p.url.includes('step=eq.filter')));
  assert.ok(patches.some(p => p.body.status === 'skipped' && p.url.includes('status=eq.waiting')));
  assert.ok(
    patches.some(p => p.url.includes('pipeline_runs?id=eq.r1') && p.body.status === 'failed'),
  );
});

test('Profile read text ignores rotating logo URLs but changes when the profile really changes', async () => {
  const PROFILE = fs.readFileSync(path.join(__dirname, '../src/profile.js'), 'utf8');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/profile.json'), 'utf8'));
  const textOf = async p =>
    (await withLib(() => [], PROFILE + `\nreturn talentText(${JSON.stringify(p)}).text;`)).res;
  const rescraped = JSON.parse(JSON.stringify(base).replace(/t=[A-Z]+/g, 't=ZZZ9')); // LinkedIn rotated the logo tokens
  const edited = JSON.parse(JSON.stringify(base));
  edited.experience[0].description += ' Led a team of three.';
  assert.notStrictEqual(JSON.stringify(rescraped), JSON.stringify(base));
  assert.strictEqual(await textOf(rescraped), await textOf(base));
  assert.notStrictEqual(await textOf(edited), await textOf(base));
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('PASS', name);
    } catch (e) {
      fail++;
      console.log('FAIL', name, '\n   ', e.message);
    }
  }
  console.log(`${tests.length - fail}/${tests.length} passed`);
  process.exit(fail ? 1 : 0);
})();
