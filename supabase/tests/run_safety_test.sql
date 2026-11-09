-- Failure tests for run start, stuck runs, duplicate discovery and Apify reuse (migration 0010).
-- Runs inside one transaction and rolls back: psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/run_safety_test.sql
begin;
create temp table t_result (name text, ok boolean, detail text);

insert into talents (id, linkedin_url, name, status, match_days)
values ('00000000-0000-0000-0000-0000000000a1', 'test://run-safety', 'Test Talent', 'adding', 7);
insert into talent_settings (talent_id) values ('00000000-0000-0000-0000-0000000000a1');

-- 7. n8n crashed mid-step: a run started 40 minutes ago with a step stuck on "running"
insert into pipeline_runs (id, talent_id, trigger, status, started_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'onboarding', 'running', now() - interval '40 minutes');
insert into pipeline_run_steps (pipeline_run_id, step, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'enrich', 'finished'), ('00000000-0000-0000-0000-0000000000b1', 'discover', 'running'),
  ('00000000-0000-0000-0000-0000000000b1', 'filter', 'waiting'), ('00000000-0000-0000-0000-0000000000b1', 'match', 'waiting');

do $$
declare r1 uuid; r2 uuid; st text; tstat text; steps text;
begin
  -- the next start cleans up the crashed run and starts a new one
  r1 := start_run('00000000-0000-0000-0000-0000000000a1', 'onboarding', 'exec-1', 'week');
  select status into st from pipeline_runs where id = '00000000-0000-0000-0000-0000000000b1';
  select string_agg(step || ':' || status, ',' order by step) into steps from pipeline_run_steps where pipeline_run_id = '00000000-0000-0000-0000-0000000000b1';
  select status into tstat from talents where id = '00000000-0000-0000-0000-0000000000a1';
  insert into t_result values ('7. crashed run marked failed, running step failed, waiting steps skipped',
    st = 'failed' and steps = 'discover:failed,enrich:finished,filter:skipped,match:skipped', st || ' ' || steps);
  insert into t_result values ('7. talent left on "adding" by the crashed first run is set to failed', tstat = 'failed', tstat);
  insert into t_result values ('new run created with its four steps in one go', r1 is not null and
    (select count(*) from pipeline_run_steps where pipeline_run_id = r1 and status = 'waiting') = 4, coalesce(r1::text, 'null'));

  -- 8. a second start while that run is going is refused (Retry button during the daily run)
  r2 := start_run('00000000-0000-0000-0000-0000000000a1', 'daily', 'exec-2');
  insert into t_result values ('8. second run for the same talent refused while one is running', r2 is null, coalesce(r2::text, 'null'));
  -- even a direct insert that skips start_run is refused by the index
  begin
    insert into pipeline_runs (talent_id, trigger) values ('00000000-0000-0000-0000-0000000000a1', 'daily');
    insert into t_result values ('8. direct duplicate insert refused by unique index', false, 'inserted');
  exception when unique_violation then
    insert into t_result values ('8. direct duplicate insert refused by unique index', true, 'unique_violation');
  end;
  -- a re-score (recruiter changed settings) is still allowed alongside
  insert into pipeline_runs (talent_id, trigger) values ('00000000-0000-0000-0000-0000000000a1', 'rescore');
  insert into t_result values ('re-score allowed while a run is going', true, '');

  -- once the run finishes, a daily run can start, with enrich skipped
  update pipeline_runs set status = 'finished' where id = r1;
  r2 := start_run('00000000-0000-0000-0000-0000000000a1', 'daily', 'exec-3');
  insert into t_result values ('daily run starts after the first finished, enrich skipped', r2 is not null and
    (select status from pipeline_run_steps where pipeline_run_id = r2 and step = 'enrich') = 'skipped', coalesce(r2::text, 'null'));
end $$;

-- 9. the same LinkedIn job discovered several times (twice in one batch, then again in a later run)
do $$
declare item jsonb; run1 uuid; run2 uuid; c1 jsonb; c2 jsonb; nj int; ntj int;
begin
  select raw into item from jobs where raw is not null and raw->>'id' is not null limit 1;
  select id into run1 from pipeline_runs where talent_id = '00000000-0000-0000-0000-0000000000a1' and status = 'running' and trigger = 'daily';
  c1 := ingest_jobs('00000000-0000-0000-0000-0000000000a1', run1, jsonb_build_array(item, item));
  update pipeline_runs set status = 'finished' where id = run1;
  run2 := start_run('00000000-0000-0000-0000-0000000000a1', 'daily', 'exec-4');
  c2 := ingest_jobs('00000000-0000-0000-0000-0000000000a1', run2, jsonb_build_array(item));
  select count(*) into nj from jobs where linkedin_job_id = item->>'id';
  select count(*) into ntj from talent_jobs where talent_id = '00000000-0000-0000-0000-0000000000a1' and job_id = item->>'id';
  insert into t_result values ('9. duplicate discovery: one job row, one talent-job link', nj = 1 and ntj = 1, format('jobs=%s links=%s', nj, ntj));
  insert into t_result values ('9. counts: first run 1 unique/1 new, second run 0 new/1 seen before',
    (c1->>'unique')::int = 1 and (c1->>'new')::int = 1 and (c2->>'new')::int = 0 and (c2->>'seen_before')::int = 1, c1::text || ' ' || c2::text);
end $$;

-- 2/10. scraping succeeded, saving failed: the next attempt finds the Apify run to reuse; not once saved
do $$
declare rid uuid; got jsonb;
begin
  select id into rid from pipeline_runs where talent_id = '00000000-0000-0000-0000-0000000000a1' and status = 'running' and trigger = 'daily';
  update pipeline_run_steps set status = 'failed', counts = '{"apify_run_id": "run9", "apify_dataset_id": "ds9", "apify_input_hash": "h1"}'
  where pipeline_run_id = rid and step = 'discover';
  got := apify_run_to_reuse('00000000-0000-0000-0000-0000000000a1', 'discover', 'h1');
  insert into t_result values ('10. failed-after-scrape step offers its Apify run for reuse', got->>'apify_run_id' = 'run9', coalesce(got::text, 'null'));
  got := apify_run_to_reuse('00000000-0000-0000-0000-0000000000a1', 'discover', 'other-input');
  insert into t_result values ('10. a different search does not reuse it', got is null, coalesce(got::text, 'null'));
  update pipeline_run_steps set counts = counts || '{"saved": true}' where pipeline_run_id = rid and step = 'discover';
  got := apify_run_to_reuse('00000000-0000-0000-0000-0000000000a1', 'discover', 'h1');
  insert into t_result values ('10. once the results were saved, it is not reused', got is null, coalesce(got::text, 'null'));
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from t_result;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from t_result;
rollback;
