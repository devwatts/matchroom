-- 0010_run_safety.sql
-- Pipeline runs are started in one transaction, and only one full run per talent can be running at a time.
--  * The run and its steps used to be two separate requests, so a crash in between left a run with no steps.
--  * Nothing stopped two runs for one talent (the Retry button during the daily run, or a webhook retried by
--    the caller): both would scrape, read and score the same jobs. A partial unique index now refuses the second.
--  * Runs left "running" by a crashed n8n are cleaned up when the talent's next run starts (not only by the daily
--    job), and a talent whose first run died is no longer left on "adding".

begin;

-- clean up first, so the new index can be created on existing data
update pipeline_run_steps s set status = 'failed', error = 'Run stopped without finishing.', finished_at = now()
from pipeline_runs r where s.pipeline_run_id = r.id and r.status = 'running' and s.status in ('running', 'waiting')
  and exists (select 1 from pipeline_runs r2 where r2.talent_id = r.talent_id and r2.status = 'running'
                and r2.trigger <> 'rescore' and r2.started_at > r.started_at);
update pipeline_runs r set status = 'failed', error = 'Run stopped without finishing.', finished_at = now()
where status = 'running' and trigger <> 'rescore'
  and exists (select 1 from pipeline_runs r2 where r2.talent_id = r.talent_id and r2.status = 'running'
                and r2.trigger <> 'rescore' and r2.started_at > r.started_at);

create unique index if not exists pipeline_runs_one_running
  on pipeline_runs (talent_id) where status = 'running' and trigger <> 'rescore';

drop function if exists mark_stale_runs();

-- runs that stopped without finishing: all of them (p_talent null, daily job) or one talent's
create or replace function mark_stale_runs(p_talent uuid default null, p_minutes int default 30)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  with stale as (
    select id, talent_id, trigger from pipeline_runs
    where status = 'running' and started_at < now() - make_interval(mins => p_minutes)
      and (p_talent is null or talent_id = p_talent)
    for update skip locked
  ), steps as (
    update pipeline_run_steps s set status = case when s.status = 'running' then 'failed' else 'skipped' end,
           error = case when s.status = 'running' then 'Run stopped without finishing (n8n stopped or timed out).' end,
           summary = case when s.status = 'running' then 'Failed · run stopped without finishing' else 'Not run' end,
           finished_at = now()
    from stale where s.pipeline_run_id = stale.id and s.status in ('running', 'waiting')
  ), talents_fix as (
    update talents t set status = 'failed', updated_at = now()
    from stale where stale.talent_id = t.id and stale.trigger = 'onboarding' and t.status = 'adding'
  )
  update pipeline_runs r set status = 'failed', error = 'Run stopped without finishing (n8n stopped or timed out).', finished_at = now()
  from stale where r.id = stale.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Start a run and its steps together. Returns the run id, or null when this talent already has a run going.
create or replace function start_run(p_talent uuid, p_trigger text, p_execution text, p_window text default null)
returns uuid language plpgsql set search_path = public as $$
declare rid uuid;
begin
  perform mark_stale_runs(p_talent);
  begin
    insert into pipeline_runs (talent_id, trigger, n8n_execution_id, posted_window_used)
    values (p_talent, p_trigger, p_execution, p_window) returning id into rid;
  exception when unique_violation then
    return null;
  end;
  insert into pipeline_run_steps (pipeline_run_id, step, status, summary)
  select rid, s, case when s = 'enrich' and p_trigger = 'daily' then 'skipped' else 'waiting' end,
         case when s = 'enrich' and p_trigger = 'daily' then 'Skipped · profile was read when the talent was added' end
  from unnest(array['enrich', 'discover', 'filter', 'match']) s;
  return rid;
end $$;

-- An Apify run that finished but whose results were never saved (the step failed after scraping), so the next
-- run can load that dataset instead of paying for the same search again. Same talent, same actor, same input.
create or replace function apify_run_to_reuse(p_talent uuid, p_step text, p_input_hash text, p_hours int default 6)
returns jsonb language sql stable set search_path = public as $$
  select s.counts from pipeline_run_steps s join pipeline_runs r on r.id = s.pipeline_run_id
  where r.talent_id = p_talent and s.step = p_step and s.status = 'failed'
    and s.counts ? 'apify_run_id' and s.counts->>'apify_input_hash' = p_input_hash and not (s.counts ? 'saved')
    and r.started_at > now() - make_interval(hours => p_hours)
  order by r.started_at desc limit 1
$$;

do $$
declare f text;
begin
  foreach f in array array['mark_stale_runs(uuid,int)', 'start_run(uuid,text,text,text)', 'apify_run_to_reuse(uuid,text,text,int)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
commit;
